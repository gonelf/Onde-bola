/*
 * Classic soccer-ball icon (inline SVG) — a platform-independent replacement for
 * the ⚽ emoji, which renders blue on Windows (Segoe UI Emoji). Shares geometry
 * with the canvas recorder via lib/soccer-ball. No hooks, so it works in both
 * server and client components.
 */

import { BALL_CENTER, BALL_OUTER, BALL_SEAMS, BALL_INK } from "@/lib/soccer-ball";

const fmt = (a) => a.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

export default function SoccerBall({ className, style }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle cx="50" cy="50" r="46" fill="#fff" stroke={BALL_INK} strokeWidth="2.2" />
      <g stroke={BALL_INK} strokeWidth="2.4" strokeLinecap="round">
        {BALL_SEAMS.map((s, i) => (
          <line key={i} x1={s[0][0].toFixed(1)} y1={s[0][1].toFixed(1)} x2={s[1][0].toFixed(1)} y2={s[1][1].toFixed(1)} />
        ))}
      </g>
      <polygon points={fmt(BALL_CENTER)} fill={BALL_INK} />
      {BALL_OUTER.map((p, i) => <polygon key={i} points={fmt(p)} fill={BALL_INK} />)}
    </svg>
  );
}
