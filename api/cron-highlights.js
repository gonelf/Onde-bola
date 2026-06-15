/*
 * /api/cron-highlights — background sweep that collects video highlights for
 * recently finished matches and stores them in KV, so the detail modal (and the
 * /api/highlights feed) can serve them instantly instead of fetching FotMob on
 * demand.
 *
 * What it does, per run:
 *   1. Scan FotMob's day feed (the same `data/matches` source as /api/fixtures)
 *      for today and yesterday (UTC).
 *   2. Keep finished matches in the major competitions.
 *   3. For each, resolve a highlights link from FotMob's match details — its own
 *      clip URL when present (often a YouTube / social link) — and always attach
 *      a keyless YouTube search link as a fallback.
 *   4. Store the result in KV:
 *        hl:<fmid>      -> one match's highlight object   (90d TTL)
 *        hl:day:<date>  -> { fmid: obj } map for the feed  (90d TTL)
 *
 * Why an EXTERNAL trigger: Vercel's free (Hobby) plan only allows a *daily*
 * cron, which is too coarse for highlights that appear minutes after full time.
 * So this endpoint is meant to be poked by an external scheduler (GitHub
 * Actions, cron-job.org, EasyCron…) every ~30 min. Hit:
 *     GET /api/cron-highlights            [?date=YYYY-MM-DD] [&days=2] [&debug=1]
 * If CRON_SECRET is set, send it as `Authorization: Bearer <secret>` or `?key=`.
 *
 * Unofficial source: every field is parsed defensively and any failure degrades
 * to an empty value rather than throwing. Disable with FOTMOB_DISABLED=1.
 *
 * Env: CRON_SECRET (optional), FOTMOB_DISABLED=1, MAJOR_LEAGUE_IDS (optional),
 *      HL_DETAIL_LIMIT (optional, default 40),
 *      KV_REST_API_URL / KV_REST_API_TOKEN (required to store anything).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// How long a collected highlight stays in KV. Finished matches are immutable, so
// 90 days is just housekeeping to keep the store from growing forever.
const HL_TTL = "7776000";
// Cap the number of FotMob match-detail fetches per run so a single invocation
// stays well within the function time budget. Split work with ?date= if needed.
const DETAIL_LIMIT = Math.max(1, Number(process.env.HL_DETAIL_LIMIT) || 40);

// Major competitions only (FotMob league ids) — same default set as /api/fixtures.
// Override with MAJOR_LEAGUE_IDS (CSV); set it empty to sweep everything.
const MAJOR = new Set(
  (process.env.MAJOR_LEAGUE_IDS != null
    ? process.env.MAJOR_LEAGUE_IDS
    : "47,87,54,55,53,61,57,48,42,73,10216,9134,130,268,77,76,50,44,45")
    .split(",").map((s) => s.trim()).filter(Boolean)
);

const TEAM_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
const LEAGUE_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (e) { return null; }
}

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

// --- small helpers (mirrors /api/matchdetails so this stays self-contained) ---
const str = (x) => (x == null ? "" : String(x)).trim();
const textOf = (x) => {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x).trim();
  return str(x.text || x.name || x.value || x.title || x.long || x.short);
};
const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch (e) { return fallback; } };

// Run an async fn over a list with bounded concurrency so one slow upstream call
// doesn't serialize the whole run, while never hammering FotMob in parallel.
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

// FotMob's utcTime is usually ISO, but be defensive about epoch ms.
function isoTime(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? new Date(v).toISOString() : null;
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();
  const n = Number(v);
  return !isNaN(n) && n > 0 ? new Date(n).toISOString() : null;
}

// Pull the finished, major-competition matches out of a day feed.
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

// Extract FotMob's own highlights clip URL from a match-details object. Same
// shape-tolerant logic as /api/matchdetails. Returns { url, source } or null.
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

// Build the stored highlight record for a match, fetching FotMob details only
// when we don't already have a real clip URL (keeps upstream calls minimal).
async function resolveHighlight(m, prev, budget) {
  const youtube = youtubeSearch(m);
  let url = (prev && /^https?:\/\//.test(str(prev.url))) ? prev.url : "";
  let source = (prev && prev.source) || "";

  if (!url && budget.left > 0) {
    budget.left -= 1;
    let data = await getJson(`${BASE}/data/matchDetails?matchId=${m.fmid}`);
    if (!data || (!data.content && !data.general)) {
      data = await getJson(`${BASE}/matchDetails?matchId=${m.fmid}`);
    }
    const hl = data ? highlightFrom(data) : null;
    if (hl) { url = hl.url; source = hl.source; }
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
    youtube: youtube,
    updatedAt: new Date().toISOString(),
  };
}

function authorized(req) {
  if (!SECRET) return true; // open if no secret configured
  const auth = str((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const bearer = auth.replace(/^Bearer\s+/i, "");
  const key = str((req.query || {}).key);
  return bearer === SECRET || key === SECRET;
}

function ymd(date) { return date.replace(/-/g, ""); }

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  if (DISABLED) { res.status(200).json({ ok: false, disabled: true }); return; }
  if (!KV_URL || !KV_TOKEN) {
    res.status(200).json({ ok: false, error: "KV not configured — nothing to persist" });
    return;
  }

  const q = req.query || {};
  const debug = (q.debug === "1" || q.debug === "true");

  // Which days to sweep: an explicit ?date=, or the last `days` (default 2 =
  // today + yesterday, UTC). Late-night finishes are why yesterday is included.
  let dates;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str(q.date))) {
    dates = [str(q.date)];
  } else {
    const days = Math.min(7, Math.max(1, Number(q.days) || 2));
    dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
  }

  const budget = { left: DETAIL_LIMIT };
  const summary = { ok: true, dates: dates, finished: 0, withUrl: 0, stored: 0, detailFetches: 0, days: {} };

  for (const date of dates) {
    let data = await getJson(`${BASE}/data/matches?date=${ymd(date)}&timezone=UTC`);
    if (!leaguesOf(data).length) {
      data = await getJson(`${BASE}/matches?date=${ymd(date)}&timezone=UTC`);
    }
    const matches = data ? finishedMatches(data, date) : [];
    summary.finished += matches.length;

    // Load the existing day map so we keep clips found on earlier runs and avoid
    // re-fetching details for matches we've already resolved.
    const dayKey = `hl:day:${date}`;
    const prevRaw = await kv(["GET", dayKey]);
    const dayMap = safe(() => JSON.parse(prevRaw), {}) || {};

    const resolved = await mapPool(matches, 6, (m) =>
      resolveHighlight(m, dayMap[m.fmid], budget));

    let dayWithUrl = 0;
    for (const rec of resolved) {
      dayMap[rec.fmid] = rec;
      if (rec.url) dayWithUrl += 1;
      // Per-match record so /api/matchdetails can merge a clip FotMob's live
      // payload didn't include yet.
      await kv(["SET", `hl:${rec.fmid}`, JSON.stringify(rec), "EX", HL_TTL]);
    }
    await kv(["SET", dayKey, JSON.stringify(dayMap), "EX", HL_TTL]);

    summary.stored += resolved.length;
    summary.withUrl += dayWithUrl;
    summary.days[date] = { finished: matches.length, withUrl: dayWithUrl };
  }

  summary.detailFetches = DETAIL_LIMIT - budget.left;
  if (debug) summary._note = "withUrl counts matches with a real FotMob clip; the rest carry a YouTube fallback.";
  res.status(200).json(summary);
};
