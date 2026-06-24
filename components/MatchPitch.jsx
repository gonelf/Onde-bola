"use client";

/*
 * MatchPitch — the top-down "FM-style" pitch, shared by the public match-replay
 * modal (components/GamesBrowser.jsx) and the admin Animation Lab
 * (app/(admin)/admin/replay). It renders the field, both teams' players, the
 * passed ball, the event markers and the goal flash for a single `clock` value.
 * All motion comes from the shared, deterministic engine (replay-sim.js), so the
 * pitch is a pure function of its props — the parent owns the clock and controls.
 *
 * Props:
 *   home / away : { name, formation, color }  (formation may be a "4-3-3" string
 *                 or a FotMob lineup-side object; color is the kit hex)
 *   events      : raw event list ({ side, min, kind, player, note })
 *   stats       : stat rows ({ key, home, away }) — drives possession/shot weighting
 *   config      : sim tunables (defaults to DEFAULT_CONFIG)
 *   clock       : current match minute to render
 *   showNumbers / showMarkers / showTrail : display toggles
 *   goalLabel   : text for the goal flash (localised by the caller)
 */

import { useMemo } from "react";
import {
  prepEvents, maxMinute, buildSim, formationArr, teamBase, simState,
  placePlayers, passBall, markerType, pitchPos, MARKER_GLYPH, DEFAULT_CONFIG,
} from "@/public/admin/replay-sim";

const TRAIL_N = 10;

export default function MatchPitch({
  home, away, events: rawEvents, stats, config, clock, seed,
  showNumbers = false, showMarkers = true, showTrail = false, goalLabel = "GOAL!",
}) {
  const cfg = config || DEFAULT_CONFIG;
  const events = useMemo(() => prepEvents(rawEvents), [rawEvents]);
  const maxMin = useMemo(() => maxMinute(events), [events]);
  const sim = useMemo(() => buildSim(events, stats, maxMin, seed), [events, stats, maxMin, seed]);
  const bases = useMemo(() => ({
    home: teamBase(formationArr(home && home.formation), true),
    away: teamBase(formationArr(away && away.formation), false),
  }), [home, away]);

  const homeColor = (home && home.color) || "#4a90d9";
  const awayColor = (away && away.color) || "#e8554e";

  // Players + ball at any clock — pure, so the trail can be sampled backwards.
  const stateAt = (c) => {
    const field = simState(sim.wp, c);
    const players = {
      home: placePlayers(bases.home, true, field.atk, field.ball, c, cfg),
      away: placePlayers(bases.away, false, field.atk, field.ball, c, cfg),
    };
    return { players, ball: passBall(c, sim.wp, sim.wHome, sim.seed, players, events, maxMin, cfg) };
  };

  const { players, ball } = stateAt(clock);

  const shown = [];
  events.forEach((ev, i) => {
    if (ev._m <= clock + 1e-9) shown.push({ ev, i, type: markerType(ev.kind), pos: pitchPos(ev, i) });
  });
  const last = shown.length ? shown[shown.length - 1] : null;
  const goalFlash = last && last.type === "goal" ? last : null;

  const trail = [];
  if (showTrail) {
    for (let k = 1; k <= TRAIL_N; k++) {
      const c = clock - k * 0.7;
      if (c < 0) break;
      trail.push(stateAt(c).ball);
    }
  }

  const playerDot = (p, i, color, prefix) => (
    <span key={prefix + i} className="pitch-player"
      style={{ left: p.x + "%", top: p.y + "%", background: color }}>
      {showNumbers ? i + 1 : ""}
    </span>
  );

  return (
    <div className="replay-pitch">
      <div className="pitch-line center" />
      <div className="pitch-circle" />
      <div className="pitch-box left" /><div className="pitch-box right" />
      <div className="pitch-goal left" /><div className="pitch-goal right" />
      {players.home.map((p, i) => playerDot(p, i, homeColor, "ph"))}
      {players.away.map((p, i) => playerDot(p, i, awayColor, "pa"))}
      {showTrail ? trail.map((pt, i) => (
        <span key={"tr" + i} className="pitch-trail"
          style={{ left: pt.x + "%", top: pt.y + "%", opacity: (1 - i / TRAIL_N) * 0.4 }} />
      )) : null}
      {showMarkers ? shown.map((r) => {
        const active = r === last;
        return (
          <span key={r.i} className={"pitch-marker " + r.type + (active ? " active" : "")}
            style={{ left: r.pos.x + "%", top: r.pos.y + "%" }}>
            <span className="marker-glyph">{MARKER_GLYPH[r.type]}</span>
            {active && r.ev.player ? (
              <span className="marker-label">{r.ev.player}{r.ev.min ? " " + r.ev.min : ""}</span>
            ) : null}
          </span>
        );
      }) : null}
      <span className="pitch-ball" style={{ left: ball.x + "%", top: ball.y + "%" }} />
      {goalFlash ? <div className="pitch-flash" key={"f" + goalFlash.i}>{goalLabel}</div> : null}
    </div>
  );
}
