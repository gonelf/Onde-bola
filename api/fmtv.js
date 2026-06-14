/*
 * /api/fmtv — FotMob TV broadcaster source (free, unofficial).
 *
 * FotMob exposes `GET /api/data/tvlistings?countryCode=XX`, which returns a
 * whole region's broadcast listings keyed by matchId, with each listing already
 * carrying the team names (program) and the channel (station). So one call per
 * country yields a full day's listings with no matchId mapping needed — we query
 * a Portugal-first set of countries, merge by match, and return the same shape
 * as /api/smtv so the client merges it identically.
 *
 * Unofficial (no documented auth, but still SofaScore-style ToS risk): every
 * failure degrades to an empty result and never breaks the page. Disable with
 * FOTMOB_DISABLED=1.
 *
 * Query: ?date=YYYY-MM-DD [&debug=1]
 * Returns: { matches: [ { h, a, rows: [{channel, country}] } ] }  (h/a normalized)
 *
 * Env: FOTMOB_COUNTRIES (CSV, default "PT,GB,ES,BR,US,FR,DE,IT,NL"),
 *      FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const COUNTRIES = (process.env.FOTMOB_COUNTRIES || "PT,GB,ES,BR,US,FR,DE,IT,NL")
  .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 16);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CODE_TO_COUNTRY = {
  PT: "Portugal", GB: "United Kingdom", IE: "Ireland", US: "United States",
  ES: "Spain", BR: "Brazil", FR: "France", DE: "Germany", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", AR: "Argentina", MX: "Mexico", CA: "Canada",
  AU: "Australia", SA: "Saudi Arabia", TR: "Turkey", GR: "Greece", CH: "Switzerland",
  AT: "Austria", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark",
};

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

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const nameOf = (x) => (typeof x === "string" ? x : (x && (x.name || x.title || x.shortName)) || "");

// FotMob serves .NET-style "/Date(1781798400000)/" timestamps (and a sentinel
// min-date for unset ones). Return epoch ms, or 0 if not parseable/usable.
function parseMsDate(v) {
  if (typeof v === "number") return v > 0 ? v : 0;
  if (typeof v === "string") {
    const m = v.match(/\/Date\((-?\d+)\)\//);
    if (m) { const n = Number(m[1]); return n > 0 ? n : 0; }
    const n = Number(v);
    if (!isNaN(n) && n > 0) return n;
  }
  return 0;
}

// Pull [home, away] out of a listing's program. FotMob's shape is
// program.teams = [{ name, isHome }, ...]; other shapes handled defensively.
function teamsOf(program) {
  if (!program) return [null, null];
  if (Array.isArray(program.teams)) {
    let home = null, away = null;
    program.teams.forEach((t) => {
      if (!t) return;
      if (t.isHome === true) home = nameOf(t);
      else if (away == null) away = nameOf(t);
    });
    if (home && away) return [home, away];
    if (program.teams.length >= 2) {
      const h2 = nameOf(program.teams[0]), a2 = nameOf(program.teams[1]);
      if (h2 && a2) return [h2, a2];
    }
  }
  const h = nameOf(program.homeTeam || program.home || program.homeTeamName);
  const a = nameOf(program.awayTeam || program.away || program.awayTeamName);
  if (h && a) return [h, a];
  const title = program.title || program.name || "";
  const parts = String(title).split(/\s+(?:vs\.?|v|-|–|—)\s+/i);
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return [parts[0].trim(), parts[1].trim()];
  }
  return [null, null];
}

// FotMob roots the response either as the matchId->listings map directly or
// under a wrapper key. Find the object whose values are arrays of listings.
function listingsMap(data) {
  if (!data || typeof data !== "object") return {};
  const looksLikeMap = (o) => o && typeof o === "object" &&
    Object.values(o).some((v) => Array.isArray(v));
  if (looksLikeMap(data) && !Array.isArray(data)) {
    // Avoid treating a wrapper with one array prop as the map if a better one exists.
    const inner = data.tvListings || data.listings || data.matches || data.payload;
    if (inner && looksLikeMap(inner)) return inner;
    return data;
  }
  return data.tvListings || data.listings || data.matches || data.payload || {};
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");

  if (DISABLED) { res.status(200).json({ matches: [], disabled: true }); return; }

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Pass ?date=YYYY-MM-DD" });
    return;
  }
  const debug = (req.query.debug === "1" || req.query.debug === "true");

  const cacheKey = `fm:day:${date}:${COUNTRIES.join(",")}`;
  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(JSON.parse(cached));
      return;
    }
  }

  // Day window in UTC ms, used to keep only this date's matches (FotMob's feed
  // is a forward-looking window with no date param). Padded ±12h so timezone
  // differences vs. TheSportsDB's date grouping don't drop legit same-day games.
  const midnight = Date.parse(date + "T00:00:00Z");
  const dayStart = midnight - 12 * 3600000;
  const dayEnd = midnight + 86400000 + 12 * 3600000;

  const dbg = { countries: {}, sampleListing: null, droppedNoTeams: 0, droppedDate: 0, kept: 0 };
  const byMatch = {}; // "h|a" -> { h, a, names: {country: Set} , when }

  const results = await Promise.all(COUNTRIES.map(async (code) => {
    const data = await getJson(`${BASE}/data/tvlistings?countryCode=${code}`);
    return [code, data];
  }));

  for (const [code, data] of results) {
    const map = listingsMap(data);
    const keys = Object.keys(map || {});
    if (debug) dbg.countries[code] = { ok: !!data, matchKeys: keys.length };
    const country = CODE_TO_COUNTRY[code] || code;

    for (const id of keys) {
      const listings = map[id];
      if (!Array.isArray(listings) || !listings.length) continue;
      if (debug && !dbg.sampleListing) dbg.sampleListing = listings[0];

      const withProgram = listings.find((l) => l && l.program) || listings[0];
      const [h, a] = teamsOf(withProgram && withProgram.program);
      if (!h || !a) { if (debug) dbg.droppedNoTeams++; continue; }

      // Date filter (when timestamps are present).
      const when = parseMsDate(listings[0] && (listings[0].startTime || listings[0].matchTime));
      if (when && (when < dayStart || when >= dayEnd)) { if (debug) dbg.droppedDate++; continue; }
      if (debug) dbg.kept++;

      const key = norm(h) + "|" + norm(a);
      if (!byMatch[key]) byMatch[key] = { h: norm(h), a: norm(a), names: {} };
      const bucket = byMatch[key].names;
      if (!bucket[country]) bucket[country] = {};
      for (const l of listings) {
        const ch = nameOf(l && l.station);
        if (ch) bucket[country][ch] = true;
      }
    }
  }

  const matches = Object.values(byMatch).map((m) => {
    const rows = [];
    for (const country of Object.keys(m.names)) {
      for (const channel of Object.keys(m.names[country])) rows.push({ channel, country });
    }
    return { h: m.h, a: m.a, rows };
  }).filter((m) => m.rows.length);

  const payload = debug ? { matches, _debug: dbg } : { matches };
  if (!debug) {
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", matches.length ? "1800" : "600"]);
  }

  res.setHeader("X-Cache", debug ? "BYPASS" : "MISS");
  res.status(200).json(payload);
};
