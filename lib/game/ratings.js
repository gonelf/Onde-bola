/*
 * ratings.js — squad strength model for the match simulator.
 *
 * Turns a lineup ({ formation, players:[{ pos, rating }] }) into attack /
 * midfield / defence scalars (≈40..99, the player-rating scale), then folds in
 * formation + tactic modifiers. simMatch.js converts the two sides' strengths
 * into expected goals / possession / shots.
 *
 * Pure, deterministic, no I/O. Position labels are the loose FotMob-style
 * strings we store on players (GK, CB, LB, DM, CM, AM, LW, ST, …); we classify
 * each into a coarse line.
 */

// Coarse line for a position label.
export function lineOf(pos) {
  const p = String(pos || "").toUpperCase();
  if (!p || p === "GK") return p === "GK" ? "GK" : "MF";
  if (/\b(GK)\b/.test(p) || p === "G") return "GK";
  if (/(CB|LB|RB|WB|LWB|RWB|DF|D)\b/.test(p) || p === "DEF") return "DF";
  if (/(ST|CF|LW|RW|FW|F|SS)\b/.test(p) || p === "ATT") return "FW";
  // DM/CM/AM/M and anything else → midfield.
  return "MF";
}

// Mean of an array, or a fallback when empty.
function mean(arr, fallback) {
  if (!arr.length) return fallback;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Formation shape modifiers: more defenders → sturdier + less threat, more
// forwards → the inverse. Read off the formation string's line counts.
function formationMod(formation) {
  const parts = String(formation || "4-3-3")
    .split(/[-–]/).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  const def = parts[0] || 4;
  const fwd = parts[parts.length - 1] || 3;
  return {
    attack: 1 + (fwd - 3) * 0.04, // 3 fwd neutral; 2 → -4%, 4 → +4%
    defence: 1 + (def - 4) * 0.04, // 4 def neutral; 5 → +4%, 3 → -4%
  };
}

// Tactic modifiers. mentality: -1 defensive … +1 attacking; pressing 0..1.
function tacticMod(tactics) {
  const t = tactics || {};
  const mentality = clamp(num(t.mentality, 0), -1, 1);
  const pressing = clamp(num(t.pressing, 0.5), 0, 1);
  return {
    attack: 1 + mentality * 0.1 + (pressing - 0.5) * 0.06,
    defence: 1 - mentality * 0.08 + (pressing - 0.5) * 0.04,
    // Pressing raises the tempo → more shots and fouls for BOTH sides.
    chaos: 0.9 + pressing * 0.3,
  };
}

function num(v, d) { const n = parseFloat(v); return isFinite(n) ? n : d; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Strength of one lineup. Returns { attack, midfield, defence, overall, chaos }.
export function strengthOf(lineup) {
  const players = (lineup && lineup.players) || [];
  const byLine = { GK: [], DF: [], MF: [], FW: [] };
  players.forEach((p) => {
    const r = clamp(num(p && p.rating, 60), 30, 99);
    byLine[lineOf(p && p.pos)].push(r);
  });

  const gk = mean(byLine.GK, 62);
  const def = mean(byLine.DF, 60);
  const mid = mean(byLine.MF, 60);
  const fwd = mean(byLine.FW, 60);

  const fMod = formationMod(lineup && lineup.formation);
  const tMod = tacticMod(lineup && lineup.tactics);

  // GK contributes a third of the defensive solidity.
  const defence = (def * 0.66 + gk * 0.34) * fMod.defence * tMod.defence;
  const midfield = mid;
  const attack = (fwd * 0.7 + mid * 0.3) * fMod.attack * tMod.attack;
  const overall = (defence + midfield + attack) / 3;

  return { attack, midfield, defence, overall, chaos: tMod.chaos };
}

// Expected match shape from two strengths. Home edge baked in. Returns the
// aggregate numbers simMatch turns into stats[] + the goal Poisson means.
export function expectedShape(home, away) {
  const HOME_ADV = 1.12;
  // Goals: a base rate scaled by attack-vs-defence ratio (defence ~70 neutral).
  const xgHome = clamp(1.35 * HOME_ADV * (home.attack / 72) * (70 / away.defence), 0.2, 4.2);
  const xgAway = clamp(1.15 * (away.attack / 72) * (70 / home.defence), 0.15, 3.8);

  // Possession from the midfield (+ a little overall) differential.
  const mh = home.midfield * 1.04 + home.overall * 0.2;
  const ma = away.midfield + away.overall * 0.2;
  const possHome = clamp(Math.round((mh / (mh + ma)) * 100), 35, 65);

  const chaos = (home.chaos + away.chaos) / 2;
  const shotsHome = Math.max(2, Math.round(xgHome * 8.5 * chaos));
  const shotsAway = Math.max(2, Math.round(xgAway * 8.5 * chaos));

  return { xgHome, xgAway, possHome, shotsHome, shotsAway, chaos };
}
