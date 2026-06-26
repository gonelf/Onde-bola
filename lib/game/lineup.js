/*
 * lineup.js — build the simulator's lineup input from a club + its players.
 *
 * autoLineup picks a best-XI for the club's formation: top-rated GK, then the
 * required defenders / midfielders / forwards, backfilling from the best
 * remaining players when a line is short. Returns the shape simMatch expects:
 *   { name, formation, color, tactics, players:[{ name, pos, rating }] }
 */

import { lineOf } from "@/lib/game/ratings";

function counts(formation) {
  const parts = String(formation || "4-3-3")
    .split(/[-–]/).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  const def = parts[0] || 4;
  const fwd = parts[parts.length - 1] || 3;
  const mid = parts.slice(1, -1).reduce((a, b) => a + b, 0) || (10 - def - fwd);
  return { GK: 1, DF: def, MF: Math.max(1, mid), FW: Math.max(1, fwd) };
}

export function autoLineup(club, playerRows, tactics) {
  const formation = (club && club.baseFormation) || "4-3-3";
  const need = counts(formation);

  const byLine = { GK: [], DF: [], MF: [], FW: [] };
  (playerRows || []).forEach((p) => {
    byLine[lineOf(p.position)].push({ name: p.name || p.shortName || "—", pos: p.position || "MF", rating: p.rating || 60 });
  });
  Object.keys(byLine).forEach((k) => byLine[k].sort((a, b) => b.rating - a.rating));

  const picked = [];
  const pool = [];
  ["GK", "DF", "MF", "FW"].forEach((line) => {
    const want = need[line];
    const have = byLine[line];
    for (let i = 0; i < have.length; i++) {
      if (i < want) picked.push(have[i]);
      else pool.push(have[i]);
    }
    // Record shortfall by padding from pool later.
  });
  // Backfill to 11 from the best remaining outfielders.
  pool.sort((a, b) => b.rating - a.rating);
  while (picked.length < 11 && pool.length) picked.push(pool.shift());

  return {
    name: club.name,
    formation,
    color: club.kitColor || "#4a90d9",
    tactics: tactics || { mentality: 0, pressing: 0.5 },
    players: picked,
  };
}
