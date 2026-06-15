/*
 * /api/fixtures — the day's football fixtures from FotMob (free, unofficial).
 *
 * FotMob's `GET /api/data/matches?date=YYYYMMDD` returns every match for a date
 * grouped by league, each carrying team names + ids, league name + id, kickoff
 * (utcTime), score and live status. So one call yields the whole day's fixtures
 * with logos and live scores — no per-league fan-out, which is what made the old
 * TheSportsDB path get rate-limited. TheSportsDB is kept only for TV listings.
 *
 * Caching is long-term by design (the client asked for a DB-backed store so past
 * days never re-hit upstream):
 *   - past dates, and today once every match is finished -> cached permanently
 *     (results are final);
 *   - future dates -> 1h; today with unfinished matches -> 90s so live scores
 *     stay fresh.
 * Every successful fetch also writes a permanent `fx:bak:DATE` backup that is
 * served if a later upstream fetch fails or is blocked, so any date seen once
 * keeps rendering even when FotMob is down.
 *
 * Unofficial (SofaScore-style ToS risk): every failure degrades to the backup or
 * an empty list and never throws. Disable with FOTMOB_DISABLED=1.
 *
 * Query: ?date=YYYY-MM-DD [&debug=1]
 * Returns: { fixtures: [ { id, competition, home, away, homeBadge, awayBadge,
 *   kickoff, venue, leagueBadgeUrl, homeScore, awayScore, status, tv:[] } ] }
 *
 * Env: FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Major competitions only (FotMob league ids): top-5 leagues + Portugal/NL/EFL,
// UEFA club & national cups, MLS, Brasileirão, and the big internationals.
// Override with MAJOR_LEAGUE_IDS (CSV); set it empty to show everything.
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
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
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

// FotMob's utcTime is usually ISO, but be defensive about epoch ms / .NET dates.
function isoTime(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? new Date(v).toISOString() : null;
  const m = String(v).match(/\/Date\((-?\d+)\)\//);
  if (m) { const n = Number(m[1]); return n > 0 ? new Date(n).toISOString() : null; }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();
  const n = Number(v);
  return !isNaN(n) && n > 0 ? new Date(n).toISOString() : null;
}

function parseScore(status, home, away) {
  let h = typeof home.score === "number" ? String(home.score) : null;
  let a = typeof away.score === "number" ? String(away.score) : null;
  if ((h === null || a === null) && status && typeof status.scoreStr === "string") {
    const m = status.scoreStr.match(/(\d+)\s*-\s*(\d+)/);
    if (m) { h = m[1]; a = m[2]; }
  }
  return [h, a];
}

// Map FotMob's status object to a short string the client's statusOf() reads
// ("FT", "HT", a minute like "67'", or "" for not-started/unknown).
function statusStr(status) {
  if (!status) return "";
  if (status.finished) return "FT";
  if (status.cancelled || status.awarded) return "";
  if (status.started) {
    const reason = status.reason && (status.reason.short || status.reason.long);
    if (reason && /^(HT|half)/i.test(reason)) return "HT";
    const live = status.liveTime && (status.liveTime.short || status.liveTime.long);
    if (live) return String(live);
    return "LIVE";
  }
  return "";
}

// Surface an abnormal-state note (postponed / cancelled / abandoned / suspended)
// so the client can show *why* a match isn't a normal upcoming/live game. Normal
// states (scheduled, in-play, finished) return "" — there's nothing to flag.
function statusNote(status) {
  if (!status || status.finished) return "";
  const reason = status.reason && (status.reason.long || status.reason.short) || "";
  const abnormal = status.cancelled || status.awarded ||
    /postpon|abandon|cancel|suspend|await|delay/i.test(reason);
  return abnormal && reason ? String(reason) : "";
}

// FotMob roots the day's matches as { leagues: [ { name, id, matches: [...] } ] }.
function leaguesOf(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.leagues)) return data.leagues;
  if (data.matches && Array.isArray(data.matches.leagues)) return data.matches.leagues;
  return [];
}

function normalize(data, date, majorOnly) {
  const noon = new Date(date + "T12:00:00Z").toISOString();
  const out = [];
  leaguesOf(data).forEach((lg) => {
    if (!lg) return;
    const comp = lg.name || lg.leagueName || "Football";
    const leagueId = lg.primaryId != null ? lg.primaryId : lg.id;
    if (majorOnly && MAJOR.size &&
        !MAJOR.has(String(lg.id)) && !MAJOR.has(String(lg.primaryId))) return;
    (lg.matches || []).forEach((m) => {
      if (!m) return;
      const home = m.home || {}, away = m.away || {}, status = m.status || {};
      if (!home.name || !away.name) return;
      const [hs, as] = parseScore(status, home, away);
      out.push({
        id: "fm:" + (m.id != null ? m.id : home.name + away.name),
        fmid: m.id != null ? String(m.id) : "",
        competition: comp,
        home: home.name,
        away: away.name,
        homeBadge: home.id != null ? TEAM_LOGO(home.id) : "",
        awayBadge: away.id != null ? TEAM_LOGO(away.id) : "",
        kickoff: isoTime(status.utcTime) || isoTime(m.timeTS) || noon,
        venue: "",
        leagueId: leagueId != null ? leagueId : null,
        ccode: lg.ccode || "",
        leagueBadgeUrl: leagueId != null ? LEAGUE_LOGO(leagueId) : "",
        homeScore: hs,
        awayScore: as,
        status: statusStr(status),
        note: statusNote(status),
        tv: [],
      });
    });
  });
  return out;
}

module.exports = async (req, res) => {
  if (DISABLED) {
    res.setHeader("Cache-Control", "public, s-maxage=60");
    res.status(200).json({ fixtures: [], disabled: true });
    return;
  }

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Pass ?date=YYYY-MM-DD" });
    return;
  }
  const debug = (req.query.debug === "1" || req.query.debug === "true");
  const ymd = date.replace(/-/g, "");
  const cacheKey = `fx:day:${date}`;
  const bakKey = `fx:bak:${date}`;

  // Serve the fresh (TTL'd) cache first.
  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      res.status(200).json(JSON.parse(cached));
      return;
    }
  }

  // Fetch upstream. FotMob now serves under /api/data; fall back to the older path.
  let via = "data/matches";
  let data = await getJson(`${BASE}/data/matches?date=${ymd}&timezone=UTC`);
  if (!leaguesOf(data).length) {
    data = await getJson(`${BASE}/matches?date=${ymd}&timezone=UTC`);
    via = "matches";
  }
  // Major competitions only by default; ?all=1 (or empty MAJOR_LEAGUE_IDS)
  // returns everything.
  const showAll = (req.query.all === "1" || req.query.all === "true");
  const fixtures = data ? normalize(data, date, !showAll) : [];

  // On empty/failed upstream, serve the permanent backup so any previously-seen
  // date (and all past dates) keep rendering even when FotMob is blocked.
  if (!fixtures.length) {
    const bak = await kv(["GET", bakKey]);
    if (bak) {
      const payload = JSON.parse(bak);
      res.setHeader("X-Cache", "BACKUP");
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      res.status(200).json(debug ? Object.assign({}, payload, { _via: via, _backup: true }) : payload);
      return;
    }
  }

  const payload = { fixtures };
  if (debug) {
    const comps = {};
    fixtures.forEach((f) => { comps[f.competition] = (comps[f.competition] || 0) + 1; });
    payload._debug = { via, upstream: !!data, count: fixtures.length, majorOnly: !showAll, leagues: comps };
  }

  if (!debug && fixtures.length) {
    const today = new Date().toISOString().slice(0, 10);
    const unfinished = fixtures.some((f) => f.status !== "FT");
    let ttl;
    if (date < today) ttl = 0;                 // past day: final, keep forever
    else if (date > today) ttl = 3600;         // future day: lineups/times can shift
    else ttl = unfinished ? 90 : 0;            // today: short while in play, forever once done
    if (ttl > 0) await kv(["SET", cacheKey, JSON.stringify(payload), "EX", String(ttl)]);
    else await kv(["SET", cacheKey, JSON.stringify(payload)]); // permanent
    await kv(["SET", bakKey, JSON.stringify(payload)]);        // DB backup, permanent
  }

  res.setHeader("X-Cache", fixtures.length ? "MISS" : "EMPTY");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
  res.status(200).json(payload);
};
