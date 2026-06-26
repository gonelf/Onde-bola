/*
 * fotmobSquad.js — pull real clubs + squads from FotMob for ingestion.
 *
 * Scope is deliberately limited to PORTUGAL + UK leagues (the ALLOWED_LEAGUES
 * allowlist below) — the seeder refuses anything else, so the game only ever
 * imports those competitions.
 *
 * Two fetches, both defensive (same UA / AbortController / new-path-first,
 * old-path fallback pattern as app/api/fixtures): a league's team list, then
 * each team's squad. Everything degrades to empty rather than throwing, and raw
 * responses are KV-cached (squad:<id>) so re-seeding is cheap. Disable with
 * FOTMOB_DISABLED=1 like the rest of the FotMob surface.
 */

import { kv } from "@/lib/kv";

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TEAM_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

// The only competitions the game may import. FotMob league ids.
export const ALLOWED_LEAGUES = [
  { id: 47, name: "Premier League", country: "England", tier: 1, strength: 84 },
  { id: 48, name: "Championship", country: "England", tier: 2, strength: 74 },
  { id: 61, name: "Liga Portugal", country: "Portugal", tier: 1, strength: 78 },
  { id: 63, name: "Liga Portugal 2", country: "Portugal", tier: 2, strength: 68 },
];

export function leagueInfo(id) {
  return ALLOWED_LEAGUES.find((l) => String(l.id) === String(id)) || null;
}
export function isAllowedLeague(id) {
  return !!leagueInfo(id);
}

const str = (x) => (x == null ? "" : String(x)).trim();

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 7000);
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

// FotMob now serves under /api/data; fall back to the older path.
async function getData(path, query) {
  let data = await getJson(`${BASE}/data/${path}?${query}`);
  if (!data) data = await getJson(`${BASE}/${path}?${query}`);
  return data;
}

// Extract the list of teams in a league from the league-details payload. The
// league table is the most reliable source of the current member clubs.
function teamsFromLeague(data) {
  const out = [];
  const seen = new Set();
  const push = (id, name) => {
    const tid = str(id);
    if (!tid || seen.has(tid)) return;
    seen.add(tid);
    out.push({ fotmobTeamId: tid, name: str(name) });
  };
  const tables = (data && data.table) || [];
  const arr = Array.isArray(tables) ? tables : [tables];
  arr.forEach((t) => {
    const data2 = (t && t.data) || t || {};
    const rows = (data2.table && (data2.table.all || data2.table)) ||
      data2.all || [];
    (Array.isArray(rows) ? rows : []).forEach((row) => push(row.id, row.name));
  });
  return out;
}

// Pull one team's squad. Returns { name, crest, kitColor, players:[...] } or null.
export async function fetchSquad(fotmobTeamId, { useCache = true } = {}) {
  if (DISABLED) return null;
  const id = str(fotmobTeamId);
  if (!id) return null;

  const cacheKey = `squad:${id}`;
  if (useCache) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) { try { return JSON.parse(cached); } catch (e) { /* fall through */ } }
  }

  const data = await getData("teams", `id=${encodeURIComponent(id)}`);
  if (!data) return null;

  const details = data.details || {};
  const name = str(details.name || (data.overview && data.overview.teamName));
  const kitColor = str((details.color) || (data.overview && data.overview.teamColors &&
    data.overview.teamColors.color)) || "#4a90d9";

  // The squad lives under `squad` as groups (Goalkeepers/Defenders/...), each
  // with a `members` array. Shapes shift, so we parse very defensively.
  const players = [];
  const groups = data.squad || details.squad || [];
  const groupArr = Array.isArray(groups) ? groups : [];
  groupArr.forEach((g) => {
    const role = str(g && (g.title || g.label));
    const members = (g && (g.members || g.players || g.member)) || [];
    (Array.isArray(members) ? members : []).forEach((m) => {
      const nm = str(m && (m.name || m.fullName));
      if (!nm) return;
      players.push({
        fotmobPlayerId: str(m.id),
        name: nm,
        pos: str(m.role || m.position || m.positionLabel || roleToPos(role)),
        rating: numOrNull(m.rating || (m.stats && m.stats.rating)),
        age: numOrNull(m.age),
      });
    });
  });

  // Newer payloads put a flat array under squad[].members keyed differently; if
  // we found nothing, try a flat `squad.members` / `players` shape.
  if (!players.length) {
    const flat = (data.squad && data.squad.players) || details.players || [];
    (Array.isArray(flat) ? flat : []).forEach((m) => {
      const nm = str(m && (m.name || m.fullName));
      if (nm) players.push({ fotmobPlayerId: str(m.id), name: nm, pos: str(m.position), rating: numOrNull(m.rating), age: numOrNull(m.age) });
    });
  }

  const result = { fotmobTeamId: id, name, crest: TEAM_LOGO(id), kitColor, players };
  if (useCache) { try { await kv(["SET", cacheKey, JSON.stringify(result), "EX", 86400]); } catch (e) { /* best effort */ } }
  return result;
}

// All clubs in an allowed league, each with its squad. Sequential with a small
// gap to stay polite to the upstream; caller bounds this by maxDuration.
export async function fetchLeagueSquads(leagueId, { limit = 24 } = {}) {
  if (DISABLED) return { league: leagueInfo(leagueId), clubs: [] };
  const info = leagueInfo(leagueId);
  if (!info) return { league: null, clubs: [] };

  const data = await getData("leagues", `id=${encodeURIComponent(leagueId)}`);
  const teams = teamsFromLeague(data).slice(0, limit);
  const clubs = [];
  for (const t of teams) {
    const squad = await fetchSquad(t.fotmobTeamId);
    if (squad && squad.players.length) {
      clubs.push(Object.assign({}, squad, { name: squad.name || t.name }));
    }
  }
  return { league: info, clubs };
}

function roleToPos(groupTitle) {
  const g = String(groupTitle || "").toLowerCase();
  if (g.startsWith("goal")) return "GK";
  if (g.startsWith("def")) return "DF";
  if (g.startsWith("mid")) return "MF";
  if (g.startsWith("att") || g.startsWith("for")) return "FW";
  return "MF";
}
function numOrNull(v) { const n = parseFloat(v); return isFinite(n) ? n : null; }
