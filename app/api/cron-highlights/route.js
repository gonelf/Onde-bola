/*
 * /api/cron-highlights — background sweep that collects video highlights for
 * recently finished matches and stores them in KV, so the detail modal (and the
 * /api/highlights feed) can serve them instantly instead of fetching FotMob on
 * demand. Ported from api/cron-highlights.js.
 *
 * Per run: scan FotMob's day feed for today + yesterday (UTC), keep finished
 * major-competition matches, resolve a highlights link (FotMob's own clip, an
 * embeddable YouTube id via the clip or the Data API when YOUTUBE_API_KEY is
 * set, plus a keyless search fallback), and store:
 *   hl:<fmid>      -> one match's highlight object   (90d TTL)
 *   hl:day:<date>  -> { fmid: obj } map for the feed  (90d TTL)
 *
 * Meant to be poked by an external scheduler (~every 30 min). If CRON_SECRET is
 * set, send it as `Authorization: Bearer <secret>` or `?key=`.
 *
 * Env: CRON_SECRET, FOTMOB_DISABLED=1, MAJOR_LEAGUE_IDS, HL_DETAIL_LIMIT (40),
 *      YOUTUBE_API_KEY, HL_YT_LIMIT (25), KV_REST_API_URL / KV_REST_API_TOKEN.
 */

import { kv, kvConfigured } from "@/lib/kv";

export const dynamic = "force-dynamic";

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const HL_TTL = "7776000";
const DETAIL_LIMIT = Math.max(1, Number(process.env.HL_DETAIL_LIMIT) || 40);

const YT_KEY = process.env.YOUTUBE_API_KEY || "";
const YT_LIMIT = Math.max(0, Number(process.env.HL_YT_LIMIT) || 25);

const MAJOR = new Set(
  (process.env.MAJOR_LEAGUE_IDS != null
    ? process.env.MAJOR_LEAGUE_IDS
    : "47,87,54,55,53,61,57,48,42,73,10216,9134,130,268,77,76,50,44,45")
    .split(",").map((s) => s.trim()).filter(Boolean)
);

const TEAM_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
const LEAGUE_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 5000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA, Accept: "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.fotmob.com/",
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const str = (x) => (x == null ? "" : String(x)).trim();
const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch (e) { return fallback; } };

// Run an async fn over a list with bounded concurrency.
async function mapPool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function leaguesOf(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.leagues)) return data.leagues;
  if (data.matches && Array.isArray(data.matches.leagues)) return data.matches.leagues;
  return [];
}

function isoTime(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? new Date(v).toISOString() : null;
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();
  const n = Number(v);
  return !isNaN(n) && n > 0 ? new Date(n).toISOString() : null;
}

function finishedMatches(data, date) {
  const out = [];
  leaguesOf(data).forEach((lg) => {
    if (!lg) return;
    if (MAJOR.size && !MAJOR.has(String(lg.id)) && !MAJOR.has(String(lg.primaryId))) return;
    const comp = lg.name || lg.leagueName || "Football";
    const leagueId = lg.primaryId != null ? lg.primaryId : lg.id;
    (lg.matches || []).forEach((m) => {
      const status = (m && m.status) || {};
      if (!m || !status.finished) return;
      const home = m.home || {}, away = m.away || {};
      if (m.id == null || !home.name || !away.name) return;
      const hs = typeof home.score === "number" ? home.score : null;
      const as = typeof away.score === "number" ? away.score : null;
      out.push({
        fmid: String(m.id),
        home: home.name,
        away: away.name,
        homeBadge: home.id != null ? TEAM_LOGO(home.id) : "",
        awayBadge: away.id != null ? TEAM_LOGO(away.id) : "",
        competition: comp,
        leagueId: leagueId != null ? leagueId : null,
        leagueBadgeUrl: leagueId != null ? LEAGUE_LOGO(leagueId) : "",
        date: date,
        kickoff: isoTime(status.utcTime) || isoTime(m.timeTS) || (date + "T12:00:00Z"),
        score: hs != null && as != null ? hs + "-" + as : null,
      });
    });
  });
  return out;
}

function highlightFrom(data) {
  return safe(function () {
    const content = data.content || {};
    const mf = content.matchFacts || {};
    const h = mf.highlights || content.highlights ||
      (mf.matchInfo && mf.matchInfo.highlights);
    let url = str(h && (h.url || h.source || h.videoUrl || h.link));
    if (!url && typeof h === "string") url = str(h);
    return /^https?:\/\//.test(url)
      ? { url: url, source: str(h && (h.source || h.provider)) }
      : null;
  }, null);
}

function youtubeSearch(m) {
  const q = encodeURIComponent(m.home + " vs " + m.away + " " +
    (m.competition || "") + " highlights");
  return "https://www.youtube.com/results?search_query=" + q;
}

function youtubeId(u) {
  const s = str(u);
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

function providerOf(u, source) {
  const s = str(u);
  if (youtubeId(s)) return "youtube";
  const host = safe(function () { return new URL(s).hostname.replace(/^www\./, ""); }, "");
  if (/twitter\.com|x\.com|t\.co/.test(host)) return "x";
  if (/streamable\.com/.test(host)) return "streamable";
  return host || str(source) || "";
}

async function ytSearchId(query) {
  if (!YT_KEY) return "";
  const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video" +
    "&maxResults=1&videoEmbeddable=true&safeSearch=none" +
    "&q=" + encodeURIComponent(query) + "&key=" + YT_KEY;
  const data = await getJson(url, 6000);
  return safe(function () { return str(data.items[0].id.videoId); }, "");
}

async function resolveHighlight(m, prev, budget) {
  const youtube = youtubeSearch(m);
  let url = (prev && /^https?:\/\//.test(str(prev.url))) ? prev.url : "";
  let source = (prev && prev.source) || "";

  if (!url && budget.detail > 0) {
    budget.detail -= 1;
    let data = await getJson(`${BASE}/data/matchDetails?matchId=${m.fmid}`);
    if (!data || (!data.content && !data.general)) {
      data = await getJson(`${BASE}/matchDetails?matchId=${m.fmid}`);
    }
    const hl = data ? highlightFrom(data) : null;
    if (hl) { url = hl.url; source = hl.source; }
  }

  let ytId = youtubeId(url) || (prev && str(prev.youtubeId)) || "";
  if (!ytId && YT_KEY && budget.yt > 0) {
    budget.yt -= 1;
    ytId = await ytSearchId(m.home + " vs " + m.away + " " +
      (m.competition || "") + " highlights");
  }

  return {
    fmid: m.fmid,
    home: m.home,
    away: m.away,
    homeBadge: m.homeBadge,
    awayBadge: m.awayBadge,
    competition: m.competition,
    leagueId: m.leagueId,
    leagueBadgeUrl: m.leagueBadgeUrl,
    date: m.date,
    kickoff: m.kickoff,
    score: m.score,
    status: "FT",
    url: url,
    source: source,
    provider: url ? providerOf(url, source) : "",
    youtubeId: ytId,
    youtube: youtube,
    updatedAt: new Date().toISOString(),
  };
}

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  return bearer === SECRET || key === SECRET;
}

function ymd(date) { return date.replace(/-/g, ""); }

export async function GET(request) {
  const noStore = { "Cache-Control": "no-store" };
  const { searchParams } = new URL(request.url);

  if (!authorized(request, searchParams.get("key") || "")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore });
  }
  if (DISABLED) return Response.json({ ok: false, disabled: true }, { headers: noStore });
  if (!kvConfigured) {
    return Response.json({ ok: false, error: "KV not configured — nothing to persist" }, { headers: noStore });
  }

  const debug = (searchParams.get("debug") === "1" || searchParams.get("debug") === "true");

  let dates;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str(searchParams.get("date")))) {
    dates = [str(searchParams.get("date"))];
  } else {
    const days = Math.min(7, Math.max(1, Number(searchParams.get("days")) || 2));
    dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
  }

  const budget = { detail: DETAIL_LIMIT, yt: YT_LIMIT };
  const summary = { ok: true, dates: dates, finished: 0, withUrl: 0, withVideo: 0,
    stored: 0, detailFetches: 0, ytSearches: 0, days: {} };

  for (const date of dates) {
    let data = await getJson(`${BASE}/data/matches?date=${ymd(date)}&timezone=UTC`);
    if (!leaguesOf(data).length) {
      data = await getJson(`${BASE}/matches?date=${ymd(date)}&timezone=UTC`);
    }
    const matches = data ? finishedMatches(data, date) : [];
    summary.finished += matches.length;

    const dayKey = `hl:day:${date}`;
    const prevRaw = await kv(["GET", dayKey]);
    const dayMap = safe(() => JSON.parse(prevRaw), {}) || {};

    const resolved = await mapPool(matches, 6, (m) =>
      resolveHighlight(m, dayMap[m.fmid], budget));

    let dayWithUrl = 0, dayWithVideo = 0;
    const providers = {};
    for (const rec of resolved) {
      dayMap[rec.fmid] = rec;
      if (rec.url) dayWithUrl += 1;
      if (rec.youtubeId) dayWithVideo += 1;
      if (rec.provider) providers[rec.provider] = (providers[rec.provider] || 0) + 1;
      await kv(["SET", `hl:${rec.fmid}`, JSON.stringify(rec), "EX", HL_TTL]);
    }
    await kv(["SET", dayKey, JSON.stringify(dayMap), "EX", HL_TTL]);

    summary.stored += resolved.length;
    summary.withUrl += dayWithUrl;
    summary.withVideo += dayWithVideo;
    summary.days[date] = { finished: matches.length, withUrl: dayWithUrl,
      withVideo: dayWithVideo, providers: providers };
  }

  summary.detailFetches = DETAIL_LIMIT - budget.detail;
  summary.ytSearches = YT_LIMIT - budget.yt;
  if (debug) summary._note = "withUrl = matches with a FotMob clip; withVideo = matches with an embeddable YouTube id " +
    "(from the clip or a Data API search); the rest carry a keyless YouTube search link.";
  return Response.json(summary, { headers: noStore });
}
