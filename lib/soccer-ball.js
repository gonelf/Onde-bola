/*
 * Classic soccer-ball icon geometry in a 0..100 box (centre 50,50): one central
 * black pentagon, five black pentagons near the rim, and radial seams between
 * them on a white ball. Shared by the React <SoccerBall> component and the canvas
 * video recorder so the ball looks IDENTICAL everywhere — no OS emoji font, which
 * is what made the ⚽ render blue on Windows (Segoe UI Emoji) vs white on Apple.
 */

const D2R = Math.PI / 180;
function penta(cx, cy, r, rotDeg) {
  const pts = [];
  for (let k = 0; k < 5; k++) {
    const a = (rotDeg + k * 72) * D2R;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// Central pentagon (vertex up), 5 rim pentagons beyond each edge, seams out to
// the rim between them.
export const BALL_CENTER = penta(50, 50, 13, -90);
export const BALL_OUTER = [-54, 18, 90, 162, 234].map((ang) =>
  penta(50 + 34 * Math.cos(ang * D2R), 50 + 34 * Math.sin(ang * D2R), 10, ang));
export const BALL_SEAMS = [-90, -18, 54, 126, 198].map((ang) => {
  const a = ang * D2R;
  return [[50 + 13 * Math.cos(a), 50 + 13 * Math.sin(a)], [50 + 45 * Math.cos(a), 50 + 45 * Math.sin(a)]];
});

export const BALL_INK = "#16181d";

// Draw the ball centred at (cx,cy) with pixel radius r on a 2D canvas.
export function drawSoccerBall(ctx, cx, cy, r) {
  const s = r / 47;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-50, -50);
  ctx.beginPath(); ctx.arc(50, 50, 46, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.lineJoin = "round"; ctx.lineWidth = 2.2; ctx.strokeStyle = BALL_INK; ctx.stroke();
  ctx.lineWidth = 2.4; ctx.lineCap = "round";
  BALL_SEAMS.forEach((seg) => { ctx.beginPath(); ctx.moveTo(seg[0][0], seg[0][1]); ctx.lineTo(seg[1][0], seg[1][1]); ctx.stroke(); });
  ctx.fillStyle = BALL_INK;
  const poly = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); };
  poly(BALL_CENTER); BALL_OUTER.forEach(poly);
  ctx.restore();
}
