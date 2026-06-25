/*
 * demoData.js — generate a self-contained, fictional PT/UK-themed league for the
 * one-click demo seed. No FotMob, no external calls: deterministic clubs +
 * squads so the live game can be populated instantly (and reproducibly) even
 * where FotMob is blocked. Names are invented, not real clubs.
 */

import { mulberry32 } from "@/public/admin/replay-sim";

const CLUBS = [
  { name: "Lisboa United", short: "Lisboa", color: "#d2122e", strength: 80 },
  { name: "Porto Athletic", short: "Porto A.", color: "#1c3f94", strength: 79 },
  { name: "Braga Rovers", short: "Braga", color: "#b01030", strength: 74 },
  { name: "Sporting Cidade", short: "Cidade", color: "#1f7a3d", strength: 77 },
  { name: "London Albion", short: "Albion", color: "#0b4ea2", strength: 82 },
  { name: "Manchester Castle", short: "Castle", color: "#6f1d1b", strength: 81 },
  { name: "Mersey Town", short: "Mersey", color: "#c8102e", strength: 78 },
  { name: "Thames Wanderers", short: "Thames", color: "#102a54", strength: 73 },
];

const FIRST = ["João", "Diogo", "Rúben", "Tomás", "Harry", "Jack", "Callum", "Mason", "André", "Tiago", "Bruno", "Leo", "Finley", "Oscar", "Rafa", "Nuno"];
const LAST = ["Silva", "Costa", "Ferreira", "Pereira", "Smith", "Jones", "Walker", "Hughes", "Sousa", "Almeida", "Carter", "Reed", "Mendes", "Pinto", "Clarke", "Lopes"];

// A 4-4-2 squad of 16: 2 GK, 6 DF, 6 MF, 4 FW (one over the XI per line for a bench).
const SQUAD_SHAPE = [["GK", 2], ["DF", 6], ["MF", 6], ["FW", 4]];

function clampRating(n) { return Math.max(40, Math.min(99, Math.round(n))); }

function valueFor(rating, age) {
  const base = Math.pow(Math.max(0, rating - 45) / 10, 3) * 250000;
  const ageMod = age <= 27 ? 1 + (27 - age) * 0.03 : Math.max(0.25, 1 - (age - 27) * 0.08);
  return Math.round((base * ageMod) / 50000) * 50000;
}

function buildSquad(rng, strength) {
  const players = [];
  SQUAD_SHAPE.forEach(([pos, count]) => {
    for (let i = 0; i < count; i++) {
      const fn = FIRST[Math.floor(rng() * FIRST.length)];
      const ln = LAST[Math.floor(rng() * LAST.length)];
      // Starters (first in each line) a touch stronger than the bench.
      const starterBonus = i === 0 ? 4 : 0;
      const rating = clampRating(strength - 5 + starterBonus + (rng() - 0.5) * 12);
      const age = 18 + Math.floor(rng() * 17);
      players.push({
        name: `${fn} ${ln}`, shortName: ln, position: pos,
        rating, age, marketValue: valueFor(rating, age),
      });
    }
  });
  return players;
}

// Returns { seasonLabel, clubs:[{ name, shortName, kitColor, baseFormation, players:[...] }] }
export function buildDemoLeague(count) {
  const n = Math.max(4, Math.min(CLUBS.length, count || 8));
  const rng = mulberry32(0x0de70a11); // fixed seed → reproducible demo
  const clubs = CLUBS.slice(0, n).map((c) => ({
    name: c.name, shortName: c.short, kitColor: c.color, baseFormation: "4-4-2",
    players: buildSquad(rng, c.strength),
  }));
  return { seasonLabel: "Demo League", clubs };
}
