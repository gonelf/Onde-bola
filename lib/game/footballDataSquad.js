/*
 * footballDataSquad.js — real squads from football-data.org (free tier).
 *
 * One call per competition returns every team WITH its current squad (real
 * player names + positions + birth dates) — the most complete free roster
 * source, but no ratings (those come from FotMob in the merge). Free tier covers
 * Premier League (PL), Championship (ELC) and Primeira Liga (PPL); other tiers
 * aren't available, so this source simply returns empty for them.
 *
 * Needs a free token in FOOTBALL_DATA_TOKEN; without it the source is skipped.
 * Returns the common club shape the ingest merger consumes.
 */

const TOKEN = process.env.FOOTBALL_DATA_TOKEN || "";
const BASE = "https://api.football-data.org/v4";

// Our ALLOWED_LEAGUES (FotMob) id → football-data.org competition code.
const FD_CODE = { 47: "PL", 48: "ELC", 61: "PPL" };

export function footballDataConfigured() { return !!TOKEN; }
export function fdCodeFor(leagueId) { return FD_CODE[leagueId] || null; }

const str = (x) => (x == null ? "" : String(x)).trim();

function coarsePos(s) {
  const p = String(s || "").toLowerCase();
  if (p.includes("keeper")) return "GK";
  if (p.includes("back") || p.includes("defen")) return "DF";
  if (p.includes("midfield")) return "MF";
  if (p.includes("forward") || p.includes("winger") || p.includes("striker") ||
      p.includes("attack") || p.includes("offence") || p.includes("offens")) return "FW";
  return "MF";
}

function ageFrom(dob) {
  const m = String(dob || "").match(/^(\d{4})-/);
  if (!m) return null;
  const age = 2025 - parseInt(m[1], 10); // fixed reference → deterministic
  return age > 14 && age < 45 ? age : null;
}

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 9000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "X-Auth-Token": TOKEN, Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// First colour word out of "Red / White" → a usable hex-ish hint (we keep the
// word; the merger prefers a real hex from FotMob/TheSportsDB anyway).
function firstColor(clubColors) {
  const c = str(clubColors).split("/")[0].trim();
  return c || "";
}

// Returns { clubs:[{ srcId, name, crest, kitColorWord, players:[{name,pos,age,rating:null}] }], source } | { clubs:[] }
export async function fetchLeagueSquadsFD(leagueId) {
  const code = FD_CODE[leagueId];
  if (!TOKEN || !code) return { clubs: [], source: "footballdata" };

  const data = await getJson(`${BASE}/competitions/${code}/teams`, 12000);
  const teams = (data && Array.isArray(data.teams)) ? data.teams : [];
  const clubs = teams.map((t) => {
    const squad = Array.isArray(t.squad) ? t.squad : [];
    const players = squad.map((p) => ({
      name: str(p.name), pos: coarsePos(p.position), age: ageFrom(p.dateOfBirth), rating: null,
    })).filter((p) => p.name);
    return {
      srcId: "fd:" + str(t.id),
      name: str(t.shortName) || str(t.name),
      fullName: str(t.name),
      crest: str(t.crest) || null,
      kitColorWord: firstColor(t.clubColors),
      players,
    };
  }).filter((c) => c.name);

  return { clubs, source: "footballdata" };
}
