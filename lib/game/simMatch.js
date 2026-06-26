/*
 * simMatch.js — the headless match-result simulator (the bridge between game
 * logic and the existing animation).
 *
 * GIVEN two lineups + a seed, it GENERATES a deterministic event list and stats
 * in EXACTLY the shape components/MatchPitch.jsx + public/admin/replay-sim.js
 * already consume — so a simulated match plays in the same renderer as a real
 * one. It is illustrative, not a physics engine: a seeded statistical model.
 *
 * Determinism: same seed (+ same lineups) → identical output. We reuse the
 * engine's mulberry32/hashRng so there's one source of randomness across the
 * project. No I/O, no React, no DOM — safe to run inside a serverless request.
 *
 * Output: { events:[{side,min,kind,player,note}], stats:[{key,home,away}],
 *           score:{home,away}, homeLineup, awayLineup, simVersion }
 */

import { mulberry32 } from "@/public/admin/replay-sim";
import { strengthOf, expectedShape, lineOf } from "@/lib/game/ratings";

export const SIM_VERSION = "m2.1";

// Knuth Poisson sampling driven by our seeded PRNG.
function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// Pick an index from `weights` proportional to weight, using one rng draw.
function weightedPick(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// A minute string in the engine's format ("23'", "90+2'").
function minuteLabel(m) {
  if (m <= 90) return m + "'";
  return "90+" + (m - 90) + "'";
}

// Choose a scorer/booked player from a lineup, weighted by role + rating.
function pickPlayer(rng, players, roleWeight) {
  if (!players.length) return null;
  const weights = players.map((p) => {
    const line = lineOf(p && p.pos);
    const base = roleWeight[line] != null ? roleWeight[line] : 0.3;
    const r = Math.max(30, Number(p && p.rating) || 60);
    return base * (r / 70);
  });
  return players[weightedPick(rng, weights)] || players[0];
}

const SCORER_WEIGHT = { FW: 1.0, MF: 0.45, DF: 0.12, GK: 0.01 };
const BOOK_WEIGHT = { FW: 0.4, MF: 0.8, DF: 1.0, GK: 0.1 };

// Distinct seeded minutes in [lo, hi], sorted ascending.
function spreadMinutes(rng, n, lo, hi) {
  const used = new Set();
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard++;
    const m = lo + Math.floor(rng() * (hi - lo + 1));
    if (used.has(m)) continue;
    used.add(m);
    out.push(m);
  }
  out.sort((a, b) => a - b);
  return out;
}

/*
 * lineupInput: { name, formation, color, tactics, players:[{name, pos, rating}] }
 * Returns the frozen result object.
 */
export function simulateMatch({ home, away, seed }) {
  const s = (seed >>> 0) || 1;
  const rng = mulberry32(s);

  const hStr = strengthOf(home);
  const aStr = strengthOf(away);
  const shape = expectedShape(hStr, aStr);

  // --- goals -------------------------------------------------------------
  const goalsH = Math.min(7, poisson(rng, shape.xgHome));
  const goalsA = Math.min(7, poisson(rng, shape.xgAway));

  const events = [];
  const addGoals = (side, n, lineup) => {
    const players = (lineup && lineup.players) || [];
    const mins = spreadMinutes(rng, n, 2, 92);
    mins.forEach((m) => {
      const isPen = rng() < 0.12;
      const scorer = pickPlayer(rng, players, SCORER_WEIGHT);
      events.push({
        side,
        min: minuteLabel(m),
        kind: isPen ? "pengoal" : "goal",
        player: (scorer && (scorer.name || scorer.short)) || "—",
      });
    });
  };
  addGoals("home", goalsH, home);
  addGoals("away", goalsA, away);

  // --- cards (from a fouls estimate) ------------------------------------
  const foulsH = 7 + Math.round(rng() * 8 * shape.chaos);
  const foulsA = 7 + Math.round(rng() * 8 * shape.chaos);
  const addCards = (side, fouls, lineup) => {
    const players = (lineup && lineup.players) || [];
    const yellows = Math.min(5, Math.round(fouls * 0.18 + rng() * 1.5));
    const mins = spreadMinutes(rng, yellows, 12, 90);
    mins.forEach((m, i) => {
      const booked = pickPlayer(rng, players, BOOK_WEIGHT);
      // A small chance the last booking of a busy game is a red.
      const red = i === mins.length - 1 && yellows >= 3 && rng() < 0.12;
      events.push({
        side, min: minuteLabel(m), kind: red ? "red" : "yellow",
        player: (booked && (booked.name || booked.short)) || "—",
      });
    });
  };
  addCards("home", foulsH, home);
  addCards("away", foulsA, away);

  // --- substitutions ----------------------------------------------------
  const addSubs = (side, lineup) => {
    const players = (lineup && lineup.players) || [];
    const n = 2 + (rng() < 0.6 ? 1 : 0);
    const mins = spreadMinutes(rng, n, 58, 88);
    mins.forEach((m) => {
      const off = players[Math.floor(rng() * players.length)] || {};
      events.push({
        side, min: minuteLabel(m), kind: "sub",
        player: "Sub " + (1 + Math.floor(rng() * 9)),
        note: off.name || off.short || "",
      });
    });
  };
  addSubs("home", home);
  addSubs("away", away);

  // Sort chronologically (the renderer also re-sorts via prepEvents).
  events.sort((a, b) => parseMin(a.min) - parseMin(b.min));

  // --- stats (drives possession/shot weighting in the animation) --------
  const sotH = Math.max(goalsH, Math.round(shape.shotsHome * 0.35));
  const sotA = Math.max(goalsA, Math.round(shape.shotsAway * 0.35));
  const stats = [
    { key: "possession", home: shape.possHome, away: 100 - shape.possHome },
    { key: "shots", home: shape.shotsHome, away: shape.shotsAway },
    { key: "sot", home: sotH, away: sotA },
    { key: "xg", home: round1(shape.xgHome), away: round1(shape.xgAway) },
    { key: "corners", home: 2 + Math.round(rng() * 8), away: 2 + Math.round(rng() * 8) },
    { key: "fouls", home: foulsH, away: foulsA },
  ];

  return {
    events,
    stats,
    score: { home: goalsH, away: goalsA },
    homeLineup: { name: home.name, formation: home.formation, color: home.color },
    awayLineup: { name: away.name, formation: away.formation, color: away.color },
    simVersion: SIM_VERSION,
  };
}

function parseMin(str) {
  const m = String(str || "").replace(/'/g, "").trim().match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return 0;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) * 0.01 : 0);
}
function round1(n) { return Math.round(n * 10) / 10; }
