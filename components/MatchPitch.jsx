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

import { useMemo, useRef } from "react";
import {
  prepEvents, maxMinute, buildSim, formationArr, teamBase, simState,
  placePlayers, passBall, markerType, pitchPos, MARKER_GLYPH, runningScore, DEFAULT_CONFIG,
} from "@/public/admin/replay-sim";

// IG-story (portrait 9:16) framing: the frame is a top brand/score band plus a
// camera that zooms into the pitch and pans to follow the ball, matching the
// video export. The zoom and visible-width fraction come from the pitch region
// (the 1680px below a 240px header in the 1080×1920 frame).
const IG_HEADER_PCT = 12.5;                     // top brand/score band (% of the 9:16 frame)
const IG_ZOOM = 1680 / (1080 * 10 / 16);        // ≈ 2.489 — region height / natural pitch height
const IG_CAM_HALF = (1 / IG_ZOOM) / 2 * 100;    // ≈ 20.1 — half the visible width (%)

// Marker lifetimes, in simulated minutes: a marker pops in over POP; goals then
// linger as a dim "shadow"; cards and subs fade out over FADE. The on-pitch
// "scene" (celebration / card / sub) is rendered separately via the `celebrate`
// prop and timed by CSS while the parent freezes the clock.
const POP = 1.4, FADE = 4;

// The on-pitch "scene" for one event, played on real CSS time (the match clock
// is frozen by the parent meanwhile). Phases are sequenced via animation-delays
// in assets/replay.css. Mounted keyed by the event so it plays once.
const PHASE_LABEL = { kickoff: "KICK-OFF", halftime: "HALF-TIME", fulltime: "FULL-TIME" };

function EventScene({ ev, goalLabel, missLabel, phaseLabels }) {
  const type = markerType(ev.kind);
  if (type === "phase") {
    return (
      <div className="ev-overlay">
        <div className="scene-name phase-name">{(phaseLabels || PHASE_LABEL)[ev.kind] || ""}</div>
      </div>
    );
  }
  if (type === "shot") {
    return (
      <div className="ev-overlay">
        <div className="goal-sweep miss-sweep">{missLabel || "MISSED"}</div>
      </div>
    );
  }
  if (type === "goal") {
    return (
      <div className="ev-overlay">
        <div className="goal-sweep">{goalLabel}</div>
        <div className="scene-name gs-name">{ev.player || ""}</div>
      </div>
    );
  }
  if (ev.kind === "sub") {
    return (
      <div className="ev-overlay">
        <div className="scene-col sub-out"><span className="sub-arrow out">⬇</span><span className="scene-name-i">{ev.note || ev.player || ""}</span></div>
        <div className="scene-col sub-in"><span className="sub-arrow in">⬆</span><span className="scene-name-i">{ev.player || ""}</span></div>
      </div>
    );
  }
  return (
    <div className="ev-overlay">
      <div className="scene-col card-whistle"><Whistle /></div>
      <div className="scene-col card-hand"><span className="scene-emoji">✋</span><span className={"card-rect " + type} /></div>
      <div className="scene-name card-name">{ev.player || ""}</div>
    </div>
  );
}

function Whistle() {
  return (
    <svg className="whistle" width="64" height="42" viewBox="0 0 64 42" fill="none" aria-hidden="true">
      <path d="M6 16 H33 a13 13 0 1 1 -13 13 V22 H6 a3 3 0 0 1 -3 -3 v0 a3 3 0 0 1 3 -3 Z" fill="#eef3f8" />
      <circle cx="20" cy="29" r="4.5" fill="#9aa7b5" />
      <rect x="29" y="7" width="4" height="10" rx="2" fill="#c2ccd6" />
      <path d="M44 6 l6 -4 M50 12 l7 -3 M50 20 l7 1" stroke="#f4c430" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function MatchPitch({
  home, away, events: rawEvents, stats, config, clock, seed, celebrate,
  showNumbers = false, showMarkers = true, showTrail = false, goalLabel = "GOAL!",
  sceneScale = 1, ballShadow = true, trailLength = 10, gameSpeed = 1, igStory = false,
  camSpeed = 1, eventFont = 1, phaseLabels, missLabel,
}) {
  const cfg = config || DEFAULT_CONFIG;
  const events = useMemo(() => prepEvents(rawEvents), [rawEvents]);
  const maxMin = useMemo(() => maxMinute(events), [events]);
  const sim = useMemo(() => buildSim(events, stats, maxMin, seed), [events, stats, maxMin, seed]);
  const bases = useMemo(() => ({
    home: teamBase(formationArr(home && home.formation), true),
    away: teamBase(formationArr(away && away.formation), false),
  }), [home, away]);

  // Eased IG-story camera. Updated in-render off the real clock between renders
  // (the parent re-renders ~60fps while playing), so the camera glides toward the
  // ball with a ~0.4s time constant — trailing a couple of beats behind the play.
  const camRef = useRef(50);
  const camTsRef = useRef(0);

  const homeColor = (home && home.color) || "#4a90d9";
  const awayColor = (away && away.color) || "#e8554e";

  // Field (ball + attacking side) at any clock minute.
  const sampleField = (c) => simState(sim.wp, c);
  // Lag-free positions drive the ball (so the ball leads a switch of play);
  // the rendered players use the role-staggered reaction lag and trail behind.
  const cfgNoLag = Object.assign({}, cfg, { reactLag: 0 });
  const playersNowAt = (c) => ({
    home: placePlayers(bases.home, true, sampleField, c, cfgNoLag),
    away: placePlayers(bases.away, false, sampleField, c, cfgNoLag),
  });
  const ballAt = (c) => passBall(c, sim.wp, sim.wHome, sim.seed, playersNowAt(c), events, maxMin, cfg);

  const ball = ballAt(clock);
  const players = {
    home: placePlayers(bases.home, true, sampleField, clock, cfg),
    away: placePlayers(bases.away, false, sampleField, clock, cfg),
  };

  // Advance the eased camera toward the ball (clamped so the frame stays on-pitch).
  let camX = 50;
  if (igStory) {
    const target = Math.max(IG_CAM_HALF, Math.min(100 - IG_CAM_HALF, ball.x));
    const now = (typeof performance !== "undefined" ? performance.now() : 0);
    const dt = camTsRef.current ? now - camTsRef.current : 0;
    camTsRef.current = now;
    const tau = 380 / (camSpeed || 1); // higher camSpeed → shorter lag → snappier follow
    camRef.current += (target - camRef.current) * (1 - Math.exp(-dt / tau));
    camX = camRef.current;
  }
  const worldStyle = igStory
    ? { transform: `translate(${(50 - IG_ZOOM * camX).toFixed(3)}%, 0) scale(${IG_ZOOM})` }
    : undefined;

  // Revealed events with their age (dt) at this clock.
  const revealed = [];
  events.forEach((ev, i) => {
    if (ev._m <= clock + 1e-9) {
      revealed.push({ ev, i, type: markerType(ev.kind), pos: pitchPos(ev, i), dt: clock - ev._m });
    }
  });

  // Markers: goals persist (dimmed to a shadow after their pop); cards/subs only
  // linger briefly, then fade away.
  const markers = revealed.filter((r) => r.type !== "phase" && (r.type === "goal" || r.dt <= FADE));
  const markerStyle = (r) => {
    const pop = r.dt < POP ? 1 + (1 - r.dt / POP) * 1.3 : 1;
    if (r.type === "goal" && r.dt >= POP) {
      return { left: r.pos.x + "%", top: r.pos.y + "%",
        transform: "translate(-50%,-50%) scale(0.8)", opacity: 0.4, filter: "grayscale(0.6)" };
    }
    const opacity = r.type === "goal" ? 1 : Math.max(0, 1 - r.dt / FADE);
    return { left: r.pos.x + "%", top: r.pos.y + "%",
      transform: `translate(-50%,-50%) scale(${pop.toFixed(3)})`, opacity };
  };


  // Each trail dot samples the ball a fixed REAL-TIME interval ago, so the comet
  // reflects how fast the ball is actually moving on screen. The sample offset is
  // in sim-minutes, so scale it by gameSpeed (sim-time advances ∝ gameSpeed): at
  // slow playback the comet shortens (the ball looks slow), at fast it lengthens.
  const trail = [];
  if (showTrail) {
    for (let k = 1; k <= trailLength; k++) {
      const c = clock - k * 0.7 * gameSpeed;
      if (c < 0) break;
      trail.push(ballAt(c));
    }
  }

  const playerDot = (p, i, color, prefix) => (
    <span key={prefix + i} className="pitch-player"
      style={{ left: p.x + "%", top: p.y + "%", background: color }}>
      {showNumbers ? i + 1 : ""}
    </span>
  );

  const pitchWorld = (
    <div className="pitch-world" style={worldStyle}>
      <div className="pitch-line center" />
      <div className="pitch-circle" />
      <div className="pitch-box left" /><div className="pitch-box right" />
      <div className="pitch-goal left" /><div className="pitch-goal right" />
      {players.home.map((p, i) => playerDot(p, i, homeColor, "ph"))}
      {players.away.map((p, i) => playerDot(p, i, awayColor, "pa"))}
      {showTrail ? trail.map((pt, i) => (
        <span key={"tr" + i} className="pitch-trail"
          style={{ left: pt.x + "%", top: pt.y + "%", opacity: (1 - i / trailLength) * 0.4 }} />
      )) : null}
      {showMarkers ? markers.map((r) => (
        <span key={r.i} className={"pitch-marker " + r.type} style={markerStyle(r)}>
          <span className="marker-glyph">{MARKER_GLYPH[r.type]}</span>
        </span>
      )) : null}
      <span className={"pitch-ball" + (ballShadow ? "" : " no-shadow")} style={{ left: ball.x + "%", top: ball.y + "%" }}>⚽</span>
    </div>
  );
  const scene = celebrate
    ? <EventScene key={"sc" + celebrate._m + "-" + celebrate.kind} ev={celebrate} goalLabel={goalLabel} missLabel={missLabel} phaseLabels={phaseLabels} />
    : null;

  // IG-story: a self-contained 9:16 reel frame — branding + live result on top,
  // the following-camera pitch below, and a site watermark — so a shared clip is
  // instantly identifiable. Mirrors the video export (recordReplay.js).
  if (igStory) {
    const { hs, as } = runningScore(events, clock);
    const minNum = Math.floor(clock);
    const clockLabel = clock >= maxMin ? "FT" : (minNum > 90 ? "90+" + (minNum - 90) : minNum) + "'";
    return (
      <div className="replay-pitch ig" style={{ "--scene-scale": sceneScale, "--event-font": eventFont }}>
        <div className="ig-header">
          <div className="ig-brand"><span className="ig-ball">⚽</span> Hoje Há <span className="ig-accent">Bola</span></div>
          <div className="ig-score">
            <span className="ig-team" style={{ color: homeColor }}>{(home && home.name) || ""}</span>
            <span className="ig-num">{hs}<i>–</i>{as}</span>
            <span className="ig-team" style={{ color: awayColor }}>{(away && away.name) || ""}</span>
          </div>
          <div className="ig-clock">{clockLabel}</div>
        </div>
        <div className="pitch-region">
          {pitchWorld}
          {scene}
        </div>
        <div className="ig-foot">hojehabola.com</div>
      </div>
    );
  }

  return (
    <div className="replay-pitch" style={{ "--scene-scale": sceneScale, "--event-font": eventFont }}>
      {pitchWorld}
      {scene}
    </div>
  );
}
