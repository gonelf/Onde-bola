/*
 * replay-sim.js — the match-replay simulation engine, shared by:
 *   • the production match-detail modal (components/GamesBrowser.jsx), and
 *   • the admin Animation Lab (public/admin/replay.html).
 *
 * Framework-free, no DOM, no React: every position is a pure function of the
 * clock (+ a seed), so playback is deterministic and scrubbing stays in sync.
 * It lives under /public so the static admin page can `import` it as an ES
 * module over HTTP, while the React side imports it via the "@/..." alias — one
 * source of truth for both. It's an illustrative simulation inferred from
 * possession / shots / formation, NOT real tracking data.
 *
 * The tunables (pass cadence, formation movement, per-player jitter) live in a
 * config object; DEFAULT_CONFIG holds the production values. The admin lab
 * passes its own config so the animation can be tuned live, then exported back
 * into DEFAULT_CONFIG.
 */

export const DEFAULT_CONFIG = {
  passMin: 1.5,      // one pass roughly every N simulated minutes
  attackPush: 13,    // how far the attacking line pushes up (pitch %)
  defendDrop: 7,     // how far the defending line drops back (pitch %)
  lateral: 0.22,     // lateral slide toward the ball's vertical position
  ballFollow: 0.05,  // pull of each player toward the ball's x
  jitterAmp: 0.8,    // amplitude of per-player idle movement (pitch %)
  jitterSpeed: 1.0,  // speed of that idle movement
};

// Parse an event minute string ("45'", "90+3'") into a comparable number, with
// stoppage time as a fraction (90+3 → 90.03) so it sorts after 90 but before 91.
export function minOf(ev) {
  const s = String((ev && ev.min) || "").replace(/'/g, "").trim();
  const m = s.match(/^(\d+)(?:\s*\+\s*(\d+))?/);
  if (!m) return 0;
  return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) * 0.01 : 0);
}

// A loose numeric parse for stat strings ("60%", "1.85", "12").
export const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.]/g, ""));
  return isFinite(n) ? n : 0;
};

// Normalise a raw event list: attach a numeric minute and sort chronologically.
export function prepEvents(raw) {
  const a = (raw || []).map((e) => Object.assign({}, e, { _m: minOf(e) }));
  a.sort((x, y) => x._m - y._m);
  return a;
}

// The match length to animate over (≥ 90, rounded up past any stoppage event).
export function maxMinute(events) {
  let m = 90;
  (events || []).forEach((e) => { if (e._m > m) m = e._m; });
  return Math.ceil(m);
}

// Running scoreline at a clock minute, from the revealed goal events.
export function runningScore(events, clock) {
  let hs = 0, as = 0;
  (events || []).forEach((ev) => {
    if (ev._m > clock + 1e-9) return;
    if (ev.kind === "goal" || ev.kind === "pengoal" || ev.kind === "owngoal") {
      const scoresHome = ev.kind === "owngoal" ? (ev.side === "away") : (ev.side === "home");
      if (scoresHome) hs++; else as++;
    }
  });
  return { hs, as };
}

// Map an event kind to the marker style used on the pitch.
export function markerType(kind) {
  if (kind === "goal" || kind === "pengoal" || kind === "owngoal") return "goal";
  if (kind === "red") return "red";
  if (kind === "yellow") return "yellow";
  if (kind === "sub") return "sub";
  return "other";
}

export const MARKER_GLYPH = { goal: "⚽", sub: "↔", red: "", yellow: "", other: "" };

// How long (real ms) to hold the match clock while an event's on-pitch scene
// plays. Must match the CSS scene durations in assets/replay.css.
export const SCENE_MS = { goal: 2000, card: 2600, sub: 2000 };
export function sceneMs(ev) {
  const k = markerType(ev && ev.kind);
  if (k === "goal") return SCENE_MS.goal;
  if (k === "sub") return SCENE_MS.sub;
  if (k === "yellow" || k === "red") return SCENE_MS.card;
  return 0; // no scene → no hold
}

// FotMob events carry no pitch coordinates, so we infer a plausible spot from
// the kind and side for an FM-style top-down view. Coordinate space: x 0% = the
// home goal (left), x 100% = the away goal (right); home attacks right, away
// attacks left. A deterministic per-index jitter keeps stacked events apart.
export function pitchPos(ev, idx) {
  const home = ev.side !== "away";
  const j = ((idx * 41) % 30) - 15; // -15..14, stable per index
  const kind = ev.kind;
  if (kind === "goal" || kind === "pengoal") return { x: home ? 94 : 6, y: 50 + j * 0.4 };
  if (kind === "owngoal") return { x: home ? 6 : 94, y: 50 + j * 0.4 }; // own net
  if (kind === "sub") return { x: home ? 24 : 76, y: idx % 2 ? 8 : 92 }; // touchline
  return { x: home ? 36 : 64, y: 50 + j }; // cards etc., in the offending half
}

// Seeded PRNG (mulberry32) and a stable 0..1 hash for a (seed, index) pair.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashRng(seed, i) {
  let t = (seed + Math.imul(i, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Home possession as a 0.15..0.85 fraction from the stats array.
export function possShare(stats) {
  const s = (stats || []).find((x) => x.key === "possession");
  if (!s) return 0.5;
  const n = num(s.home);
  return n > 0 ? Math.min(0.85, Math.max(0.15, n / 100)) : 0.5;
}

// A team's formation as outfield line counts. Accepts a lineup side object
// ({ formation, rows }) or a plain "4-3-3" string. Falls back to 4-3-3.
export function formationArr(side) {
  const str = side && typeof side === "object" ? side.formation : side;
  const f = String(str || "").split(/[-–]/).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  if (f.length) return f;
  if (side && typeof side === "object" && Array.isArray(side.rows) && side.rows.length > 1) {
    const r = side.rows.slice(1).map((row) => (Array.isArray(row) ? row.length : 0)).filter((n) => n > 0);
    if (r.length) return r;
  }
  return [4, 3, 3];
}

// Resting positions for a team's 11 (GK first), in pitch %. Home keeps to the
// left half and attacks right; away mirrors.
export function teamBase(formation, home) {
  const lines = formation && formation.length ? formation : [4, 3, 3];
  const pts = [{ bx: home ? 4 : 96, by: 50 }]; // GK
  const L = lines.length;
  lines.forEach((cnt, li) => {
    const depth = (li + 1) / (L + 1); // own goal → midfield
    const x = home ? 9 + depth * 39 : 91 - depth * 39;
    for (let p = 0; p < cnt; p++) {
      const y = cnt === 1 ? 50 : 13 + (p / (cnt - 1)) * 74;
      pts.push({ bx: x, by: y });
    }
  });
  return pts;
}

// A spot in `team`'s attacking half for a possession phase.
export function attackSpot(team, rng) {
  const home = team === "home";
  return { x: home ? 52 + rng() * 36 : 48 - rng() * 36, y: 14 + rng() * 72 };
}

// Build the ball's path for the whole match: the key events are anchors (the
// ball passes through each), with possession phases woven in between — weighted
// toward the side with more possession / shots — and a kickoff reset at centre
// after every goal. Returns { wp, wHome }.
export function buildWaypoints(events, possHome, shotsHome, shotsAway, maxMin, rng) {
  const anchors = [{ m: 0, x: 50, y: 50, team: null }];
  events.forEach((ev, i) => {
    const p = pitchPos(ev, i);
    anchors.push({ m: ev._m, x: p.x, y: p.y, team: ev.side !== "away" ? "home" : "away" });
    if (ev.kind === "goal" || ev.kind === "pengoal" || ev.kind === "owngoal") {
      anchors.push({ m: Math.min(ev._m + 0.4, maxMin), x: 50, y: 50, team: null });
    }
  });
  anchors.push({ m: maxMin, x: 50, y: 50, team: null });
  anchors.sort((a, b) => a.m - b.m);

  const shotTot = shotsHome + shotsAway || 1;
  const wHome = possHome * 0.6 + (shotsHome / shotTot) * 0.4;
  const wp = [];
  for (let i = 0; i < anchors.length; i++) {
    wp.push(anchors[i]);
    const a = anchors[i], b = anchors[i + 1];
    if (!b) break;
    const gap = b.m - a.m;
    const n = Math.max(0, Math.min(6, Math.round(gap / 4) - 1));
    for (let k = 1; k <= n; k++) {
      const m = a.m + gap * (k / (n + 1));
      const team = rng() < wHome ? "home" : "away";
      const sp = attackSpot(team, rng);
      wp.push({ m, x: sp.x, y: sp.y, team });
    }
  }
  wp.sort((a, b) => a.m - b.m);
  return { wp, wHome };
}

// Convenience: build the deterministic possession model for a match from its
// events + stats. Returns { wp, wHome, seed }.
export function buildSim(events, stats, maxMin, seedOverride) {
  const sr = (stats || []).find((x) => x.key === "shots") || {};
  const sh = num(sr.home) || 1, sa = num(sr.away) || 1;
  const poss = possShare(stats);
  const seed = seedOverride || ((events.length * 131 + Math.round(maxMin) * 7 +
    (events[0] ? Math.round(events[0]._m * 13) : 0)) >>> 0) || 1;
  const built = buildWaypoints(events, poss, sh, sa, maxMin, mulberry32(seed));
  return { wp: built.wp, wHome: built.wHome, seed };
}

// Ball position and the team currently attacking, at a given clock minute.
export function simState(wp, clock) {
  if (!wp.length) return { ball: { x: 50, y: 50 }, atk: null };
  if (clock <= wp[0].m) return { ball: { x: wp[0].x, y: wp[0].y }, atk: wp[0].team };
  for (let i = 0; i < wp.length - 1; i++) {
    const a = wp[i], b = wp[i + 1];
    if (clock <= b.m) {
      const g = b.m - a.m;
      const f = g > 0 ? (clock - a.m) / g : 1;
      const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // easeInOut
      return { ball: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, atk: b.team || a.team };
    }
  }
  const l = wp[wp.length - 1];
  return { ball: { x: l.x, y: l.y }, atk: l.team };
}

// Place the ball by passing it between actual players: the holder for each pass
// is a player on whichever side is attacking (possession-weighted when nobody
// is), and the ball travels from this holder to the next. Near a real event it
// converges onto that event's spot so shots/goals land where the marker is.
export function passBall(clock, wp, wHome, seed, players, events, maxMin, cfg) {
  const c = cfg || DEFAULT_CONFIG;
  const holderPos = (pi) => {
    const tp = Math.max(0, Math.min(maxMin, pi * c.passMin));
    let team = simState(wp, tp).atk;
    if (!team) team = hashRng(seed, pi * 2 + 1) < wHome ? "home" : "away";
    const arr = players[team];
    const n = arr.length;
    if (n <= 1) return arr[0] || { x: 50, y: 50 };
    const idx = 1 + Math.floor(hashRng(seed, pi * 7 + (team === "home" ? 3 : 11)) * (n - 1));
    return arr[Math.min(idx, n - 1)] || arr[0];
  };
  const p = Math.floor(clock / c.passMin);
  const f0 = (clock - p * c.passMin) / c.passMin;
  const f = f0 < 0.5 ? 2 * f0 * f0 : 1 - Math.pow(-2 * f0 + 2, 2) / 2; // easeInOut
  const A = holderPos(p), B = holderPos(p + 1);
  let x = A.x + (B.x - A.x) * f;
  let y = A.y + (B.y - A.y) * f;
  let ev = null, evi = -1, best = 1.0;
  for (let i = 0; i < events.length; i++) {
    const dd = Math.abs(events[i]._m - clock);
    if (dd < best) { best = dd; ev = events[i]; evi = i; }
  }
  if (ev) { const ep = pitchPos(ev, evi); const w = 1 - best; x += (ep.x - x) * w; y += (ep.y - y) * w; }
  return { x, y };
}

// Shift a team's resting shape toward the current phase: the attacking side
// pushes up, the defending side drops, both slide laterally to follow the ball,
// plus a little per-player idle movement so the shape is never frozen.
export function placePlayers(base, home, atk, ball, clock, cfg) {
  const c = cfg || DEFAULT_CONFIG;
  const dir = home ? 1 : -1;
  const attacking = atk === (home ? "home" : "away");
  return base.map((p, idx) => {
    if (idx === 0) return { x: p.bx, y: 50 + (ball.y - 50) * 0.12 }; // GK
    let x = p.bx;
    let y = p.by;
    if (atk) x += attacking ? dir * c.attackPush : -dir * c.defendDrop;
    y += (ball.y - 50) * c.lateral;
    x += (ball.x - x) * c.ballFollow;
    x += Math.cos(clock * c.jitterSpeed * 0.9 + idx * 1.3) * c.jitterAmp;
    y += Math.sin(clock * c.jitterSpeed + idx) * c.jitterAmp * 1.15;
    return { x: Math.max(3, Math.min(97, x)), y: Math.max(5, Math.min(95, y)) };
  });
}
