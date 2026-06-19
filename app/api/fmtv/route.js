/*
 * /api/fmtv — FotMob TV broadcaster source (free, unofficial).
 *
 * FotMob exposes `GET /api/data/tvlistings?countryCode=XX`, which returns a
 * whole region's broadcast listings keyed by matchId, with each listing already
 * carrying the team names (program) and the channel (station). So one call per
 * country yields a full day's listings with no matchId mapping needed — we query
 * a Portugal-first set of countries, merge by match, and return a per-match map
 * the client merges into every fixture.
 *
 * Unofficial (no documented auth, but still SofaScore-style ToS risk): every
 * failure degrades to an empty result and never breaks the page. Disable with
 * FOTMOB_DISABLED=1.
 *
 * Query: ?date=YYYY-MM-DD [&debug=1]
 * Returns: { matches: [ { h, a, home, away, kickoff, rows: [{channel, country}] } ] }
 *   h/a are normalized (for merging); home/away keep FotMob's display casing and
 *   kickoff is an ISO timestamp, so the client can also use this feed as a
 *   fixtures source when TheSportsDB's day feed is unavailable.
 *
 * Env: FOTMOB_COUNTRIES (CSV, default "PT,GB,ES,BR,US,FR,DE,IT,NL"),
 *      FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

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

// Mirror of the client's teamMatch (lib/app-data.js) so the per-match debug view
// reflects how listings actually merge onto a card \u2014 connective/filler tokens
// ("and"/"&"/"e") must not block a match (the "Bosnia & Herzegovina" case).
const TEAM_STOPWORDS = new Set(["and", "e", "y", "und", "i", "de", "the", "of"]);
const teamTokens = (s) => norm(s).split(" ").filter((t) => t && !TEAM_STOPWORDS.has(t));
function teamMatch(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  const ta = teamTokens(a), tb = teamTokens(b);
  if (ta.length < 2 || tb.length < 2) return false;
  const short = ta.length <= tb.length ? ta : tb;
  const longSet = new Set(ta.length <= tb.length ? tb : ta);
  return short.every((t) => longSet.has(t));
}

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

export async function GET(request) {
  const swr = "public, s-maxage=900, stale-while-revalidate=1800";

  if (DISABLED) {
    return Response.json({ matches: [], disabled: true }, { headers: { "Cache-Control": swr } });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Pass ?date=YYYY-MM-DD" }, {
      status: 400, headers: { "Cache-Control": swr },
    });
  }
  const debug = (searchParams.get("debug") === "1" || searchParams.get("debug") === "true");

  const cacheKey = `fm:day:${date}:${COUNTRIES.join(",")}`;
  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      return Response.json(JSON.parse(cached), {
        headers: { "X-Cache": "HIT", "Cache-Control": swr },
      });
    }
  }

  // Day window in UTC ms, used to keep only this date's matches (FotMob's feed
  // is a forward-looking window with no date param). Padded ±12h so timezone
  // differences vs. TheSportsDB's date grouping don't drop legit same-day games.
  const midnight = Date.parse(date + "T00:00:00Z");
  const dayStart = midnight - 12 * 3600000;
  const dayEnd = midnight + 86400000 + 12 * 3600000;

  const dbg = { countries: {}, sampleListing: null, droppedNoTeams: 0, droppedDate: 0, kept: 0 };
  // Keyed by FotMob's matchId (the listings-map key), which is GLOBAL and
  // identical across every country's feed. Keying by team name instead would
  // fragment a match whenever a country spells/localizes the pairing
  // differently (e.g. Portugal's "Bósnia e Herzegovina" vs the UK's "Bosnia &
  // Herzegovina"), so that country's listing — Sport TV 5 — would land in a
  // separate bucket the English-named fixture never merges. cand holds each
  // country's team names so we can pick an English-market label for merging.
  const byMatch = {}; // id -> { id, when, channels: {country:{ch:true}}, cand: {country:{home,away}} }

  const results = await Promise.all(COUNTRIES.map(async (code) => {
    const data = await getJson(`${BASE}/data/tvlistings?countryCode=${code}`);
    return [code, data];
  }));

  const rawMaps = {}; // debug only: country -> raw listings map, for the id probe

  for (const [code, data] of results) {
    const map = listingsMap(data);
    const keys = Object.keys(map || {});
    if (debug) { dbg.countries[code] = { ok: !!data, matchKeys: keys.length }; rawMaps[code] = map; }
    const country = CODE_TO_COUNTRY[code] || code;

    for (const id of keys) {
      const listings = map[id];
      if (!Array.isArray(listings) || !listings.length) continue;
      if (debug && !dbg.sampleListing) dbg.sampleListing = listings[0];

      const withProgram = listings.find((l) => l && l.program) || listings[0];
      const [h, a] = teamsOf(withProgram && withProgram.program);
      if (!h || !a) { if (debug) dbg.droppedNoTeams++; continue; }

      // Date filter. A match can carry several listings (the live broadcast plus
      // repeats on other days). Checking only listings[0] dropped the whole
      // match for a country whose first array entry was an out-of-window repeat
      // — e.g. Portugal's Sport TV listing for one game while the live one
      // aired. Keep the match if ANY listing falls in the day window.
      const times = listings
        .map((l) => parseMsDate(l && (l.startTime || l.matchTime)))
        .filter((n) => n > 0);
      if (times.length && !times.some((n) => n >= dayStart && n < dayEnd)) {
        if (debug) dbg.droppedDate++; continue;
      }
      const when = times.find((n) => n >= dayStart && n < dayEnd) || times[0] || 0;
      if (debug) dbg.kept++;

      if (!byMatch[id]) {
        byMatch[id] = { id, when: when || 0, channels: {}, cand: {} };
      } else if (when && !byMatch[id].when) {
        byMatch[id].when = when; // fill kickoff from whichever country carried it
      }
      byMatch[id].cand[country] = { home: h, away: a };
      const bucket = byMatch[id].channels;
      if (!bucket[country]) bucket[country] = {};
      for (const l of listings) {
        const ch = nameOf(l && l.station);
        if (ch) bucket[country][ch] = true;
      }
    }
  }

  // Pick the team names the client merges on. The fixtures feed (/api/fixtures)
  // is English, so prefer English-market labels; fall back to any country.
  const NAME_PREF = ["GB", "IE", "US", "AU", "CA"];
  const namePriority = [
    ...NAME_PREF.filter((c) => COUNTRIES.includes(c)),
    ...COUNTRIES.filter((c) => !NAME_PREF.includes(c)),
  ].map((code) => CODE_TO_COUNTRY[code] || code);

  function pickNames(cand) {
    for (const country of namePriority) {
      if (cand[country]) return cand[country];
    }
    const first = Object.keys(cand)[0];
    return first ? cand[first] : { home: "", away: "" };
  }

  const matches = Object.values(byMatch).map((m) => {
    const { home, away } = pickNames(m.cand);
    const rows = [];
    for (const country of Object.keys(m.channels)) {
      for (const channel of Object.keys(m.channels[country])) rows.push({ channel, country });
    }
    return {
      id: String(m.id), h: norm(home), a: norm(away), home, away,
      kickoff: m.when ? new Date(m.when).toISOString() : null,
      rows,
    };
  }).filter((m) => m.home && m.away && m.rows.length);

  // Per-match debug: when a home/away pair is supplied, report exactly which
  // countries/channels FotMob returned for THAT match (so the admin page can
  // answer "is Sport TV 5 there for Switzerland vs Bosnia, and did it merge?").
  // `matched` uses the same teamMatch the client merge uses; `nearMisses` lists
  // entries where only one side matched — i.e. a team-name mismatch that would
  // silently drop a country's listing.
  if (debug) {
    const qHome = searchParams.get("home");
    const qAway = searchParams.get("away");
    if (qHome && qAway) {
      const byCountry = (rows) => {
        const o = {};
        for (const r of rows) (o[r.country] = o[r.country] || []).push(r.channel);
        return o;
      };
      const matched = [], nearMisses = [];
      for (const m of matches) {
        const hOk = teamMatch(qHome, m.home), aOk = teamMatch(qAway, m.away);
        if (hOk && aOk) matched.push({ id: m.id, home: m.home, away: m.away, byCountry: byCountry(m.rows) });
        else if (hOk || aOk) {
          nearMisses.push({ home: m.home, away: m.away, matched: hOk ? "home" : "away", byCountry: byCountry(m.rows) });
        }
      }

      // Raw probe: for each matched id, dump what EACH country's raw feed
      // contains for that id (station + startTime), BEFORE the date filter. This
      // tells us whether (e.g.) Portugal genuinely omits the match, or lists it
      // with a repeat first that the date filter dropped.
      const rawById = {};
      matched.forEach((mm) => {
        const per = {};
        for (const code of Object.keys(rawMaps)) {
          const arr = rawMaps[code] && rawMaps[code][mm.id];
          if (Array.isArray(arr)) {
            per[code] = arr.map((l) => ({
              station: nameOf(l && l.station),
              start: (l && (l.startTime || l.matchTime)) || null,
            }));
          }
        }
        rawById[mm.id] = per;
      });

      dbg.match = { query: { home: qHome, away: qAway }, matched, nearMisses, rawById };
    }

    // Channel scan: list every merged match carrying a channel whose name
    // contains `chan` (e.g. "sport tv"), with its id and (possibly localized)
    // team names. Reveals whether FotMob's PT feed has a match under a name our
    // join misses — e.g. a "Suíça vs Canadá / Sport TV 5" the English fixture
    // never reaches. Independent of home/away, so it catches hidden duplicates.
    const chan = searchParams.get("chan");
    if (chan) {
      const needle = chan.toLowerCase();
      const hits = [];
      for (const m of matches) {
        const rows = m.rows.filter((r) => r.channel.toLowerCase().indexOf(needle) >= 0);
        if (rows.length) {
          hits.push({ id: m.id, home: m.home, away: m.away,
            channels: rows.map((r) => r.country + ": " + r.channel) });
        }
      }
      dbg.channelScan = { needle: chan, count: hits.length, hits: hits.slice(0, 80) };
    }
  }

  const payload = debug ? { matches, _debug: dbg } : { matches };
  if (!debug) {
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", matches.length ? "1800" : "600"]);
  }

  return Response.json(payload, {
    headers: { "X-Cache": debug ? "BYPASS" : "MISS", "Cache-Control": swr },
  });
}
