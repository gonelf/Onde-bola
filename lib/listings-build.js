/*
 * Shared builder for the accumulated daily TV-listings store (tv:rich:<date>).
 *
 * Used by both /api/cron-listings (scheduled sweep over a window of days) and
 * /api/listings (on-visit background revalidation of a single date). One run for
 * one date: pull the day's MAJOR-league fixtures, join FotMob listings by match
 * id, fill gaps from SofaScore (Portugal-first, budgeted), and MERGE into the
 * previous stored result so coverage only grows. Everything is best-effort and
 * degrades to a no-op; it never throws.
 */

import { kv } from "@/lib/kv";
import { loadOverrides } from "@/lib/overrides";
import { canonicalChannelName } from "@/lib/broadcasters";

export const FM_DISABLED = process.env.FOTMOB_DISABLED === "1";
export const SOFA_DISABLED = process.env.SOFASCORE_DISABLED === "1";

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

export const RICH_TTL = "1209600";              // 14 days
export const DEFAULT_SOFA_BUDGET = Math.max(0, Number(process.env.LISTINGS_SOFA_BUDGET) || 40);

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
const sofaChannelCache = {}; // code -> { id -> name }, per-instance + KV backed
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
// Per-id name fallback for channels the country's popular-channels batch didn't
// include — e.g. Sport TV 5, which isn't in Portugal's "popular" list, so it
// would otherwise resolve to nothing and be dropped. Cached 7 days (incl. empty).
async function resolveChannelName(id) {
  const key = `sofa:ch:${id}`;
  const cached = await kv(["GET", key]);
  if (cached !== null && cached !== undefined) return cached || null;
  const data = await getJson(`${SOFA}/tv/channel/${id}`);
  const ch = data && (data.tvChannel || data.channel || data);
  const name = (ch && ch.name) || "";
  await kv(["SET", key, name, "EX", "604800"]);
  return name || null;
}
async function sofaChannelsForEvent(eventId, idBudget) {
  const cc = await getJson(`${SOFA}/tv/event/${eventId}/country-channels`);
  const countryChannels = (cc && cc.countryChannels) || {};
  const PREFERRED = ["PT", "GB", "ES", "BR", "FR", "IT", "DE", "NL", "US", "IE"];
  const codes = Object.keys(countryChannels).sort((a, b) => {
    const ia = PREFERRED.indexOf(a), ib = PREFERRED.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  // Resolve leftover ids per-id, preferred markets (Portugal) first, bounded.
  let budget = idBudget != null ? idBudget : 40;
  const out = {};
  for (const code of codes) {
    const arr = countryChannels[code] || [];
    if (!arr.length) continue;
    const names = await sofaCountryChannels(code);
    const country = CODE_TO_COUNTRY[code] || code;
    for (const item of arr) {
      let name = (item && typeof item === "object" && item.name) ? item.name : names[item];
      if (!name && budget > 0 && (typeof item === "number" || /^\d+$/.test(String(item)))) {
        budget -= 1;
        name = await resolveChannelName(item);
      }
      if (!name) continue;
      (out[country] = out[country] || []).push(name);
    }
  }
  return out;
}

function ymd(date) { return date.replace(/-/g, ""); }

/*
 * Build (and persist) the merged store for ONE date. Merges into whatever is
 * already in tv:rich:<date>, so repeated runs accumulate. Returns a small
 * summary. Never throws — any upstream failure just yields fewer channels.
 */
export async function buildListingsForDate(date, opts) {
  const options = opts || {};
  const budget = { sofa: options.sofaBudget != null ? options.sofaBudget : DEFAULT_SOFA_BUDGET };
  const summary = { date, fixtures: 0, withFotmob: 0, sofaFilled: 0, sofaLookups: 0, stored: 0 };
  if (FM_DISABLED) return summary;

  try {
    let fxData = await getJson(`${FM}/data/matches?date=${ymd(date)}&timezone=UTC`);
    if (!leaguesOf(fxData).length) fxData = await getJson(`${FM}/matches?date=${ymd(date)}&timezone=UTC`);
    const fixtures = fxData ? majorFixtures(fxData, date) : [];
    summary.fixtures = fixtures.length;
    if (!fixtures.length) return summary;

    const tvById = await fotmobTvByMatchId();
    const overrides = await loadOverrides();

    const richKey = `tv:rich:${date}`;
    const prevRaw = await kv(["GET", richKey]);
    let store = {};
    if (prevRaw) { try { store = JSON.parse(prevRaw) || {}; } catch (e) { store = {}; } }

    const add = (rec, country, rawChannel) => {
      // Canonicalise streaming-brand variants (e.g. "Amazon Prime Video" ->
      // "Prime Video") before dedup, so one service is stored once per country
      // no matter how each source spelled it.
      const channel = canonicalChannelName(rawChannel);
      if (!country || !channel) return;
      const k = country + "|" + channel;
      if (!rec._seen[k]) { rec._seen[k] = true; rec.rows.push({ channel, country }); }
    };

    let sofaIndex = null;
    for (const fx of fixtures) {
      const rec = store[fx.fmid] || { home: fx.home, away: fx.away,
        kickoff: fx.kickoff, leagueId: fx.leagueId, rows: [] };
      rec.home = fx.home; rec.away = fx.away; rec.kickoff = fx.kickoff;
      rec.leagueId = fx.leagueId;
      rec._seen = {};
      rec.rows.forEach((r) => { rec._seen[r.country + "|" + r.channel] = true; });

      const fm = tvById[fx.fmid];
      if (fm) {
        summary.withFotmob++;
        for (const country of Object.keys(fm)) {
          for (const ch of fm[country]) add(rec, country, ch);
        }
      }

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
            if (filled) summary.sofaFilled++;
          } catch (e) { /* best-effort */ }
        }
      }

      // Manual admin overrides — highest trust, always merged in.
      const ov = overrides[fx.fmid];
      if (ov && Array.isArray(ov.rows)) {
        for (const r of ov.rows) add(rec, r.country, r.channel);
      }

      delete rec._seen;
      if (rec.rows.length) store[fx.fmid] = rec;
    }

    await kv(["SET", richKey, JSON.stringify(store), "EX", RICH_TTL]);
    summary.stored = Object.keys(store).length;
  } catch (e) {
    summary.error = String((e && e.message) || e);
  }
  return summary;
}
