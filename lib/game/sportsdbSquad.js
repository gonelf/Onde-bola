/*
 * sportsdbSquad.js — squad ingestion via TheSportsDB (the alternative to
 * FotMob, whose squad/league endpoints are blocked from many server IPs).
 *
 * TheSportsDB's free tier reliably returns the CLUB LIST for a league
 * (search_all_teams.php) — real names, badges and kit colours — but not full
 * player rosters on the free key. So we take the real clubs and generate a
 * plausible squad per club (positions + names), leaving ratings null so the
 * shared deriveRatings step baselines them off the league strength. Each club
 * gets a small deterministic strength variation so the table isn't flat.
 *
 * Same defensive fetch (UA / AbortController / KV cache) as the rest of the app.
 * Key/base mirror app/api/tv (free key "123" unless THESPORTSDB_KEY is set).
 */

import { kv } from "@/lib/kv";
import { mulberry32 } from "@/public/admin/replay-sim";
import { leagueInfo } from "@/lib/game/fotmobSquad";

const KEY = process.env.THESPORTSDB_KEY || "123";
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// FotMob league id (our ALLOWED_LEAGUES) → TheSportsDB league name.
const TSDB_NAME = {
  47: "English Premier League",
  48: "English League Championship",
  61: "Portuguese Primeira Liga",
  63: "Portuguese Segunda Liga",
};

const str = (x) => (x == null ? "" : String(x)).trim();

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, Accept: "application/json, */*" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Name pools for generated squads (PT/UK flavoured, fictional players).
const FIRST = ["João", "Diogo", "Rúben", "Tomás", "André", "Tiago", "Bruno", "Nuno", "Rafael", "Gonçalo",
  "Harry", "Jack", "Callum", "Mason", "Oliver", "George", "Leo", "Finley", "Oscar", "Charlie"];
const LAST = ["Silva", "Costa", "Ferreira", "Pereira", "Sousa", "Almeida", "Mendes", "Pinto", "Lopes", "Carvalho",
  "Smith", "Jones", "Walker", "Hughes", "Carter", "Reed", "Clarke", "Wright", "Hall", "Green"];

// 18-man squad: 2 GK, 6 DF, 6 MF, 4 FW.
const SHAPE = [["GK", 2], ["DF", 6], ["MF", 6], ["FW", 4]];

function hash(s) {
  let h = 2166136261;
  const str2 = String(s);
  for (let i = 0; i < str2.length; i++) { h ^= str2.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function genSquad(externalId, teamName) {
  const rng = mulberry32(hash(externalId || teamName) || 1);
  const players = [];
  SHAPE.forEach(([pos, count]) => {
    for (let i = 0; i < count; i++) {
      const fn = FIRST[Math.floor(rng() * FIRST.length)];
      const ln = LAST[Math.floor(rng() * LAST.length)];
      players.push({ name: `${fn} ${ln}`, pos, rating: null, age: 18 + Math.floor(rng() * 17) });
    }
  });
  return players;
}

/*
 * Returns { league: leagueInfo, clubs:[{ externalId, name, crest, kitColor,
 * strength, players:[{name,pos,rating:null,age}] }] } — same overall contract
 * fetchLeagueSquads (FotMob) returns, so the seeder can use either.
 */
export async function fetchLeagueSquadsTSDB(leagueId, { limit = 30 } = {}) {
  const info = leagueInfo(leagueId);
  const name = TSDB_NAME[leagueId];
  if (!info || !name) return { league: info || null, clubs: [] };

  const cacheKey = `tsdbteams:${leagueId}`;
  let data = null;
  const cached = await kv(["GET", cacheKey]);
  if (cached) { try { data = JSON.parse(cached); } catch (e) { data = null; } }
  if (!data) {
    data = await getJson(`${BASE}/search_all_teams.php?l=${encodeURIComponent(name)}`);
    if (data && Array.isArray(data.teams)) {
      try { await kv(["SET", cacheKey, JSON.stringify(data), "EX", 604800]); } catch (e) { /* best effort */ }
    }
  }

  const teams = (data && Array.isArray(data.teams) ? data.teams : []).slice(0, limit);
  const clubs = teams.map((t) => {
    const externalId = "tsdb:" + str(t.idTeam);
    const teamName = str(t.strTeam);
    // Per-club strength: league baseline ± a deterministic nudge.
    const strength = Math.max(45, Math.min(92, info.strength - 6 + (hash(externalId) % 13)));
    return {
      externalId,
      name: teamName,
      crest: str(t.strBadge || t.strTeamBadge) || null,
      kitColor: str(t.strColour1) || "#4a90d9",
      strength,
      players: genSquad(externalId, teamName),
    };
  }).filter((c) => c.name);

  return { league: info, clubs };
}
