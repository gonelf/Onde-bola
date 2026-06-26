/*
 * deriveRatings.js — turn a raw FotMob squad into game-ready players.
 *
 * Maps FotMob's 0–10 season rating to our 40–99 integer scale when present;
 * when it's missing (common off-season, the main ingestion risk flagged in the
 * plan) we fall back to a league-tier + position baseline plus a small
 * deterministic per-player jitter, so a squad is never empty and still has
 * spread. `derived:true` marks an inferred rating. Also estimates a market
 * value from rating + age. Pure + deterministic (jitter is hashed from the
 * player id), so re-running ingestion is stable.
 */

import { hashRng } from "@/public/admin/replay-sim";

// Coarse position → baseline nudge (keepers/defenders a touch lower spread).
const POS_BASE = { GK: 0, DF: 0, MF: 1, FW: 1 };

function coarse(pos) {
  const p = String(pos || "").toUpperCase();
  if (p.includes("GK") || p === "G") return "GK";
  if (/(CB|LB|RB|WB|DF|D)\b/.test(p) || p === "DEF") return "DF";
  if (/(ST|CF|LW|RW|FW|F|SS)\b/.test(p) || p === "ATT" || p === "FOR") return "FW";
  return "MF";
}

// FotMob 0–10 rating → 40–99. 6.0 ≈ 60, 7.0 ≈ 74, 8.0 ≈ 88.
function fromFotmobRating(r) {
  return clampRating(Math.round(40 + (r - 5) * 14));
}

function clampRating(n) { return Math.max(40, Math.min(99, n)); }

// Value (in whole currency units) from rating + age. Peaks ~24–27, steep at the
// top of the rating curve.
function valueFor(rating, age) {
  const base = Math.pow(Math.max(0, rating - 45) / 10, 3) * 250000; // 45→0, 75→6.75M, 90→28M
  const a = Number(age) || 25;
  const ageMod = a <= 27 ? 1 + (27 - a) * 0.03 : Math.max(0.25, 1 - (a - 27) * 0.08);
  return Math.round((base * ageMod) / 50000) * 50000; // round to 50k
}

/*
 * squad: { players:[{ fotmobPlayerId, name, pos, rating, age }] }
 * leagueStrength: the league's baseline (ALLOWED_LEAGUES[].strength).
 * Returns players ready for the DB (rating 40–99, marketValue, derived flag).
 */
export function deriveSquad(squad, leagueStrength) {
  const base = Number(leagueStrength) || 70;
  const players = (squad && squad.players) || [];
  return players.map((p, i) => {
    const pos = coarse(p.pos);
    let rating, derived;
    if (p.rating != null && isFinite(p.rating) && p.rating > 0) {
      rating = fromFotmobRating(p.rating);
      derived = false;
    } else {
      // Baseline around the league strength, ± a deterministic spread by id.
      const seed = hashKey(p.fotmobPlayerId || p.name || String(i));
      const jitter = Math.round((hashRng(seed, 1) - 0.5) * 16); // ±8
      rating = clampRating(base - 4 + (POS_BASE[pos] || 0) + jitter);
      derived = true;
    }
    return {
      fotmobPlayerId: p.fotmobPlayerId || null,
      name: p.name,
      shortName: shortName(p.name),
      position: pos,
      rating,
      age: p.age != null ? Math.round(p.age) : null,
      marketValue: valueFor(rating, p.age),
      derived,
    };
  });
}

function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
}

function hashKey(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
