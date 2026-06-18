/*
 * /api/cron-listings — background sweep that builds a rich, accumulated TV
 * listings store for the upcoming days' MAJOR-league fixtures, so the app can
 * show complete broadcaster lists (incl. late-published ones like Portugal's
 * Sport TV 5) the live per-request sources don't yet carry.
 *
 * Why a cron: broadcasters publish listings piecemeal as kickoff nears, and no
 * single free source is complete — FotMob's per-country feed often omits a
 * market entirely for a given match (e.g. Portugal for Switzerland vs Bosnia),
 * while SofaScore has it. Running daily and MERGING into the previous result
 * means once a channel is seen it sticks, and coverage only grows. We scope to
 * major leagues (same MAJOR_LEAGUE_IDS as the rest of the app) to keep the
 * upstream cost bounded and skip lower-league noise.
 *
 * Per run, for each date in the window (today + N days):
 *   1. major fixtures from FotMob data/matches  (fmid, home, away, kickoff)
 *   2. FotMob tvlistings per country, JOINED TO FIXTURES BY MATCH ID (the
 *      tvlistings map key IS the global match id — no name matching needed)
 *   3. SofaScore per-match fill for fixtures still missing key markets (PT-first,
 *      budget-bounded), which is what surfaces Sport TV 5 when FotMob lacks it
 *   4. union into tv:rich:<date> (keyed by fmid), never dropping prior channels
 *
 * Stored: tv:rich:<date> -> { <fmid>: { home, away, kickoff, leagueId,
 *                                       rows:[{channel,country}] } }   (14d TTL)
 *
 * Pokeable by an external scheduler (or vercel.json crons). If CRON_SECRET is
 * set, send it as `Authorization: Bearer <secret>` or `?key=`.
 *
 * Env: CRON_SECRET, FOTMOB_DISABLED=1, SOFASCORE_DISABLED=1, MAJOR_LEAGUE_IDS,
 *      FOTMOB_COUNTRIES, LISTINGS_DAYS (default 3), LISTINGS_SOFA_BUDGET (40),
 *      KV_REST_API_URL / KV_REST_API_TOKEN.
 */

import { kv, kvConfigured } from "@/lib/kv";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FM_DISABLED = process.env.FOTMOB_DISABLED === "1";
const SOFA_DISABLED = process.env.SOFASCORE_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";
const FM = "https://www.fotmob.com/api";
const SOFA = "https://api.sofascore.com/api/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const COUNTRIES = (process.env.FOTMOB_COUNTRIES || "PT,GB,ES,BR,US,FR,DE,IT,NL")
  .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 16);
const CODE_TO_COUNTRY = {
  PT: "Portugal", GB: "United Kingdom", IE: "Ireland", US: "United States",
  ES: "Spain", BR: "Brazil", FR: "France", DE: "Germany", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", AR: "Argentina", MX: "Mexico", CA: "Canada",
  AU: "Australia", SA: "Saudi Arabia", TR: "Turkey", GR: "Greece", CH: "Switzerland",
  AT: "Austria", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark",
};
const MAJOR = new Set(
  (process.env.MAJOR_LEAGUE_IDS != null
    ? process.env.MAJOR_LEAGUE_IDS
    : "47,87,54,55,53,61,57,48,42,73,10216,9134,130,268,77,76,50,44,45")
    .split(",").map((s) => s.trim()).filter(Boolean)
);

const DAYS = Math.min(10, Math.max(1, Number(process.env.LISTINGS_DAYS) || 3));
const SOFA_BUDGET = Math.max(0, Number(process.env.LISTINGS_SOFA_BUDGET) || 40);
const RICH_TTL = "1209600"; // 14 days

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

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

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

// ---- FotMob fixtures (major only) --------------------------------------
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
function majorFixtures(data, date) {
  const noon = date + "T12:00:00Z";
  const out = [];
  leaguesOf(data).forEach((lg) => {
    if (!lg) return;
    if (MAJOR.size && !MAJOR.has(String(lg.id)) && !MAJOR.has(String(lg.primaryId))) return;
    const comp = lg.name || lg.leagueName || "Football";
    const leagueId = lg.primaryId != null ? lg.primaryId : lg.id;
    (lg.matches || []).forEach((m) => {
      if (!m || m.id == null) return;
      const home = m.home || {}, away = m.away || {}, status = m.status || {};
      if (!home.name || !away.name) return;
      out.push({
        fmid: String(m.id), home: home.name, away: away.name,
        competition: comp, leagueId: leagueId != null ? leagueId : null,
        kickoff: isoTime(status.utcTime) || isoTime(m.timeTS) || noon,
      });
    });
  });
  return out;
}

// ---- FotMob tvlistings: matchId -> { country -> Set(channel) } ----------
function listingsMap(data) {
  if (!data || typeof data !== "object") return {};
  const looksLikeMap = (o) => o && typeof o === "object" &&
    Object.values(o).some((v) => Array.isArray(v));
  if (looksLikeMap(data) && !Array.isArray(data)) {
    const inner = data.tvListings || data.listings || data.matches || data.payload;
    if (inner && looksLikeMap(inner)) return inner;
    return data;
  }
  return data.tvListings || data.listings || data.matches || data.payload || {};
}
async function fotmobTvByMatchId() {
  const byId = {}; // matchId -> { country -> Set(channel) }
  const results = await Promise.all(COUNTRIES.map(async (code) => {
    const data = await getJson(`${FM}/data/tvlistings?countryCode=${code}`);
    return [code, data];
  }));
  for (const [code, data] of results) {
    const map = listingsMap(data);
    const country = CODE_TO_COUNTRY[code] || code;
    for (const id of Object.keys(map || {})) {
      const listings = map[id];
      if (!Array.isArray(listings) || !listings.length) continue;
      let bucket = byId[id];
      if (!bucket) bucket = byId[id] = {};
      let set = bucket[country];
      if (!set) set = bucket[country] = new Set();
      for (const l of listings) { const ch = nameOf(l && l.station); if (ch) set.add(ch); }
    }
  }
  return byId;
}

// ---- SofaScore fill (PT-first, budgeted) --------------------------------
async function sofaDayIndex(date) {
  const key = `sofa:idx:${date}`;
  const cached = await kv(["GET", key]);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  const data = await getJson(`${SOFA}/sport/football/scheduled-events/${date}`);
  const events = (data && data.events) || [];
  const index = events.map((e) => [
    norm(e.homeTeam && e.homeTeam.name), norm(e.awayTeam && e.awayTeam.name), e.id,
  ]).filter((row) => row[0] && row[1] && row[2]);
  if (index.length) await kv(["SET", key, JSON.stringify(index), "EX", "3600"]);
  return index;
}
const sofaChannelCache = {}; // code -> { id -> name }, per-run + KV backed
async function sofaCountryChannels(code) {
  if (sofaChannelCache[code]) return sofaChannelCache[code];
  const key = `sofa:pop:${code}`;
  const cached = await kv(["GET", key]);
  if (cached) { try { return (sofaChannelCache[code] = JSON.parse(cached)); } catch (e) {} }
  const data = await getJson(`${SOFA}/tv/country/${code}/popular-channels`);
  const arr = data && (data.tvChannels || data.channels || data.popularChannels);
  const map = {};
  if (Array.isArray(arr)) arr.forEach((c) => { if (c && c.id != null && c.name) map[c.id] = c.name; });
  await kv(["SET", key, JSON.stringify(map), "EX", "604800"]);
  return (sofaChannelCache[code] = map);
}
// Resolve SofaScore channels for one event, preferred markets first. Returns
// { country -> [channel] }. Bounded so a busy match can't blow the budget.
async function sofaChannelsForEvent(eventId) {
  const cc = await getJson(`${SOFA}/tv/event/${eventId}/country-channels`);
  const countryChannels = (cc && cc.countryChannels) || {};
  const PREFERRED = ["PT", "GB", "ES", "BR", "FR", "IT", "DE", "NL", "US", "IE"];
  const codes = Object.keys(countryChannels).sort((a, b) => {
    const ia = PREFERRED.indexOf(a), ib = PREFERRED.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const out = {};
  for (const code of codes) {
    const arr = countryChannels[code] || [];
    if (!arr.length) continue;
    const names = await sofaCountryChannels(code);
    const country = CODE_TO_COUNTRY[code] || code;
    for (const item of arr) {
      let name = (item && typeof item === "object" && item.name) ? item.name : names[item];
      if (!name) continue;
      (out[country] = out[country] || []).push(name);
    }
  }
  return out;
}

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "") === SECRET || key === SECRET;
}
function ymd(date) { return date.replace(/-/g, ""); }

export async function GET(request) {
  const noStore = { "Cache-Control": "no-store" };
  const { searchParams } = new URL(request.url);

  if (!authorized(request, searchParams.get("key") || "")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore });
  }
  if (FM_DISABLED) return Response.json({ ok: false, disabled: true }, { headers: noStore });
  if (!kvConfigured) {
    return Response.json({ ok: false, error: "KV not configured — nothing to persist" }, { headers: noStore });
  }

  let dates;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.get("date")))) {
    dates = [String(searchParams.get("date"))];
  } else {
    const days = Math.min(10, Math.max(1, Number(searchParams.get("days")) || DAYS));
    dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
    }
  }

  const budget = { sofa: SOFA_BUDGET };
  const summary = { ok: true, dates, fixtures: 0, withFotmob: 0, sofaFilled: 0,
    sofaLookups: 0, stored: 0, days: {} };

  for (const date of dates) {
    let fxData = await getJson(`${FM}/data/matches?date=${ymd(date)}&timezone=UTC`);
    if (!leaguesOf(fxData).length) fxData = await getJson(`${FM}/matches?date=${ymd(date)}&timezone=UTC`);
    const fixtures = fxData ? majorFixtures(fxData, date) : [];

    const tvById = FM_DISABLED ? {} : await fotmobTvByMatchId();

    // Load the accumulated store and merge into it (union by country|channel).
    const richKey = `tv:rich:${date}`;
    const prevRaw = await kv(["GET", richKey]);
    let store = {};
    if (prevRaw) { try { store = JSON.parse(prevRaw) || {}; } catch (e) { store = {}; } }

    const add = (rec, country, channel) => {
      if (!country || !channel) return;
      const k = country + "|" + channel;
      if (!rec._seen[k]) { rec._seen[k] = true; rec.rows.push({ channel, country }); }
    };

    let dayFotmob = 0, dayFilled = 0, sofaIndex = null;

    for (const fx of fixtures) {
      const rec = store[fx.fmid] || { home: fx.home, away: fx.away,
        kickoff: fx.kickoff, leagueId: fx.leagueId, rows: [] };
      rec.home = fx.home; rec.away = fx.away; rec.kickoff = fx.kickoff;
      rec.leagueId = fx.leagueId;
      rec._seen = {};
      rec.rows.forEach((r) => { rec._seen[r.country + "|" + r.channel] = true; });

      // 1) FotMob, joined by match id.
      const fm = tvById[fx.fmid];
      if (fm) {
        dayFotmob++;
        for (const country of Object.keys(fm)) {
          for (const ch of fm[country]) add(rec, country, ch);
        }
      }

      // 2) SofaScore fill when Portugal is still missing (the gap we care about),
      //    budget-bounded. Builds the day index lazily so days with no fixtures
      //    never hit SofaScore.
      const hasPT = rec.rows.some((r) => r.country === "Portugal");
      if (!SOFA_DISABLED && !hasPT && budget.sofa > 0) {
        if (!sofaIndex) sofaIndex = await sofaDayIndex(date);
        const hit = sofaIndex.find((row) => teamMatch(fx.home, row[0]) && teamMatch(fx.away, row[1]));
        if (hit) {
          budget.sofa -= 1; summary.sofaLookups++;
          try {
            const byCountry = await sofaChannelsForEvent(hit[2]);
            let filled = false;
            for (const country of Object.keys(byCountry)) {
              for (const ch of byCountry[country]) { add(rec, country, ch); filled = true; }
            }
            if (filled) dayFilled++;
          } catch (e) { /* best-effort */ }
        }
      }

      delete rec._seen;
      if (rec.rows.length) store[fx.fmid] = rec;
    }

    await kv(["SET", richKey, JSON.stringify(store), "EX", RICH_TTL]);

    const stored = Object.keys(store).length;
    summary.fixtures += fixtures.length;
    summary.withFotmob += dayFotmob;
    summary.sofaFilled += dayFilled;
    summary.stored += stored;
    summary.days[date] = { fixtures: fixtures.length, withFotmob: dayFotmob,
      sofaFilled: dayFilled, stored };
  }

  return Response.json(summary, { headers: noStore });
}
