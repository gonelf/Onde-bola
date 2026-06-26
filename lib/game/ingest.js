/*
 * ingest.js — multi-source squad ingestion with FotMob as the source of truth.
 *
 * Fetches a league's clubs from every available source and MERGES them so each
 * club ends up with the best data any source can offer:
 *   • club identity / list  — FotMob, else Football-Data, else TheSportsDB
 *   • roster (real players)  — richest of Football-Data / FotMob / TheSportsDB
 *   • ratings               — FotMob (0–10), overlaid onto the chosen roster by
 *                             player name; missing ones baseline off league str.
 *   • crest / kit colour    — best hex/logo across sources
 *   • generated fallback    — only when no source has a usable squad
 *
 * Each source degrades to empty independently, so the merge works with whatever
 * is reachable (FotMob is often blocked from server IPs; the others fill in).
 * Output is the club shape deriveRatings + the seeder already consume, plus a
 * per-club `provenance` for the admin summary.
 */

import { fetchLeagueSquads as fetchFotmob, leagueInfo } from "@/lib/game/fotmobSquad";
import { fetchLeagueSquadsFD, footballDataConfigured } from "@/lib/game/footballDataSquad";
import { fetchLeagueSquadsTSDB } from "@/lib/game/sportsdbSquad";

const STOP = new Set(["fc", "cf", "afc", "sc", "cd", "ac", "ud", "sad", "club", "clube", "futebol",
  "de", "da", "do", "dos", "das", "the", "association", "football", "calcio", "1", "ii", "b"]);

function norm(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ").trim();
}
function key(name) { return norm(name).replace(/\s+/g, ""); }
function tokens(name) { return norm(name).split(" ").filter((w) => w.length >= 4); }

// Does b enrich a? Match on equal collapsed key, containment, or a shared
// distinctive token (e.g. "benfica", "wanderers").
function sameClub(a, b) {
  const ka = key(a), kb = key(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const ta = tokens(a), tb = new Set(tokens(b));
  return ta.some((t) => tb.has(t));
}

function isHex(c) { return /^#?[0-9a-fA-F]{6}$/.test(String(c || "")); }
function hex(c) { const s = String(c || ""); return s.startsWith("#") ? s : (isHex(s) ? "#" + s : null); }

// Overlay FotMob 0–10 ratings onto a roster by matching player names.
function overlayRatings(players, fotmobPlayers) {
  if (!fotmobPlayers || !fotmobPlayers.length) return players;
  const byKey = {};
  fotmobPlayers.forEach((p) => { if (p.rating != null) byKey[key(p.name)] = p.rating; });
  let hits = 0;
  const out = players.map((p) => {
    const r = byKey[key(p.name)];
    if (r != null) { hits++; return { ...p, rating: r }; }
    return p;
  });
  return out;
}

// Pick the richest real roster for a club from the matched source entries.
// Returns { players, generated, ratingSource }.
function chooseRoster(fd, fm, sd) {
  if (fd && fd.players && fd.players.length >= 11) return { players: fd.players, generated: false, via: "footballdata" };
  if (fm && fm.players && fm.players.length >= 11) return { players: fm.players, generated: false, via: "fotmob" };
  if (sd && sd.players && sd.players.length >= 11 && !sd.generated) return { players: sd.players, generated: false, via: "thesportsdb" };
  if (sd && sd.players && sd.players.length) return { players: sd.players, generated: !!sd.generated, via: "thesportsdb" };
  return { players: (fm && fm.players) || [], generated: true, via: "none" };
}

/*
 * ingestLeague(leagueId, { only }) — merge all sources for a league.
 * `only` forces a single source ("fotmob" | "footballdata" | "thesportsdb").
 * Returns { league, clubs:[ common shape + { provenance } ], sources, realRosters }.
 */
export async function ingestLeague(leagueId, { only } = {}) {
  const info = leagueInfo(leagueId);
  if (!info) return { league: null, clubs: [], sources: {}, realRosters: 0 };

  const want = (s) => !only || only === s;

  // Fetch each source independently; never let one failure sink the others.
  const [fmRes, fdRes, sdRes] = await Promise.all([
    want("fotmob") ? fetchFotmob(leagueId, { limit: 30 }).catch(() => null) : null,
    want("footballdata") && footballDataConfigured() ? fetchLeagueSquadsFD(leagueId).catch(() => null) : null,
    want("thesportsdb") ? fetchLeagueSquadsTSDB(leagueId, { limit: 30 }).catch(() => null) : null,
  ]);

  const fmClubs = (fmRes && fmRes.clubs) || [];
  const fdClubs = (fdRes && fdRes.clubs) || [];
  const sdClubs = (sdRes && sdRes.clubs) || [];
  const sources = { fotmob: fmClubs.length, footballdata: fdClubs.length, thesportsdb: sdClubs.length };

  // Establish the canonical club universe from the largest list, preferring
  // FotMob → Football-Data → TheSportsDB as the identity spine.
  const spine = [fmClubs, fdClubs, sdClubs].filter((a) => a.length)
    .sort((a, b) => b.length - a.length)[0] || [];
  // But keep FotMob's identity when it has a comparable count (source of truth).
  const universe = (fmClubs.length && fmClubs.length >= spine.length - 2) ? fmClubs : spine;

  const find = (list, name) => list.find((c) => sameClub(name, c.name || c.fullName || ""));

  let realRosters = 0;
  const clubs = universe.map((base) => {
    const name = base.name || base.fullName;
    const fm = find(fmClubs, name);
    const fd = find(fdClubs, name);
    const sd = find(sdClubs, name);

    const roster = chooseRoster(fd, fm, sd);
    let players = roster.players;
    // Overlay FotMob ratings when the chosen roster isn't already FotMob's.
    if (roster.via !== "fotmob" && fm) players = overlayRatings(players, fm.players);
    if (!roster.generated) realRosters++;

    const crest = (sd && sd.crest) || (fm && fm.crest) || (fd && fd.crest) || null;
    const kitColor = hex(fm && fm.kitColor) || hex(sd && sd.kitColor) || "#4a90d9";
    // External id for upsert: prefer FotMob, else FD, else TheSportsDB.
    const externalId = (fm && fm.fotmobTeamId) || (fd && fd.srcId) || (sd && sd.externalId) || null;
    const strength = (sd && sd.strength) || info.strength;

    return {
      externalId, name, crest, kitColor, strength, players,
      generated: roster.generated,
      provenance: { roster: roster.via, ratings: roster.via === "fotmob" ? "fotmob" : (fm ? "fotmob-overlay" : "baseline"),
        crest: (sd && sd.crest) ? "thesportsdb" : (fm && fm.crest ? "fotmob" : (fd && fd.crest ? "footballdata" : "none")) },
    };
  }).filter((c) => c.name && c.players.length);

  return { league: info, clubs, sources, realRosters };
}
