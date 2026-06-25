"use client";

/*
 * Synthesized match-event sound effects via the Web Audio API — no audio assets.
 * One engine drives both live playback (connected to the speakers) and the video
 * export (connected to a MediaStream destination so the SFX are muxed into the
 * recording). Sounds are short, procedural, and deterministic.
 *
 *   goal  → crowd-roar swell + a brass stinger
 *   card  → referee whistle (a longer extra blast for a red)
 *   sub   → a soft two-note chime
 *   shot  → a quick whoosh
 */

import { useEffect, useRef } from "react";
import { markerType } from "@/public/admin/replay-sim";

// Selectable sound presets (id → label) for the per-event SFX picker.
export const SFX_PRESETS = [
  { id: "none", label: "None" },
  { id: "roar", label: "Crowd roar" },
  { id: "horn", label: "Air horn" },
  { id: "applause", label: "Applause" },
  { id: "whistleShort", label: "Whistle · short" },
  { id: "whistleDouble", label: "Whistle · double" },
  { id: "whistleLong", label: "Whistle · long" },
  { id: "whistleTriple", label: "Whistle · triple" },
  { id: "chime", label: "Chime" },
  { id: "whoosh", label: "Whoosh" },
];

// The event types the picker exposes (label shown in the UI), and the default
// sound for each.
export const SOUND_EVENTS = [
  { key: "goal", label: "Goal" },
  { key: "yellow", label: "Yellow card" },
  { key: "red", label: "Red card" },
  { key: "sub", label: "Substitution" },
  { key: "shot", label: "Shot" },
  { key: "kickoff", label: "Kick-off" },
  { key: "halftime", label: "Half-time" },
  { key: "fulltime", label: "Full-time" },
];

export const DEFAULT_EVENT_SOUNDS = {
  goal: "roar", yellow: "whistleShort", red: "whistleDouble", sub: "chime",
  shot: "whoosh", kickoff: "whistleLong", halftime: "whistleDouble", fulltime: "whistleTriple",
};

// Map an event kind to one of the picker's event-type keys.
function soundCategory(kind) {
  if (kind === "kickoff" || kind === "halftime" || kind === "fulltime") return kind;
  const ty = markerType(kind);
  if (ty === "goal") return "goal";
  if (ty === "yellow" || ty === "red" || ty === "sub" || ty === "shot") return ty;
  return null;
}

function noiseBuffer(ctx, dur) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Create an audio engine. opts.context / opts.destination let the recorder reuse
// its own context and route the sound into a MediaStreamDestination.
export function createReplayAudio(opts) {
  const o = opts || {};
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  let ctx;
  try { ctx = o.context || new AC(); } catch (e) { return null; }
  const master = ctx.createGain();
  master.gain.value = o.gain != null ? o.gain : 0.5;
  master.connect(o.destination || ctx.destination);

  const env = (node, t, peak, attack, hold, release) => {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  };

  function goal(t) {
    const dur = 1.8;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(1100, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.2, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
    // brass triad stinger
    [392, 494, 587].forEach((f) => {
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = f;
      const og = ctx.createGain();
      env(og, t + 0.02, 0.16, 0.06, 0.18, 0.5);
      osc.connect(og); og.connect(master); osc.start(t + 0.02); osc.stop(t + 0.8);
    });
  }

  function whistleN(t, count, dur) {
    for (let i = 0; i < count; i++) {
      const start = t + i * (dur + 0.07);
      const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = 2300;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
      const lg = ctx.createGain(); lg.gain.value = 2300 * 0.02;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(start); lfo.stop(start + dur);
      const g = ctx.createGain();
      env(g, start, 0.3, 0.02, dur - 0.06, 0.04);
      osc.connect(g); g.connect(master); osc.start(start); osc.stop(start + dur);
    }
  }

  function horn(t) {
    const dur = 0.9;
    [233, 311, 466].forEach((f) => {
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.04);
      g.gain.setValueAtTime(0.2, t + dur - 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + dur + 0.02);
    });
  }

  function applause(t) {
    const dur = 1.5;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2000; bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.2);
    g.gain.setValueAtTime(0.32, t + dur - 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
  }

  function chime(t) {
    [659.25, 987.77].forEach((f, i) => {
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
      const g = ctx.createGain(); const s = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.3, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
      osc.connect(g); g.connect(master); osc.start(s); osc.stop(s + 0.5);
    });
  }

  function whoosh(t) {
    const dur = 0.25;
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, dur);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(1200, t); bp.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + dur);
  }

  // Preset id → synth. "none" is silence.
  const PRESET = {
    none: () => {},
    roar: (t) => goal(t),
    horn: (t) => horn(t),
    applause: (t) => applause(t),
    whistleShort: (t) => whistleN(t, 1, 0.18),
    whistleDouble: (t) => whistleN(t, 2, 0.16),
    whistleLong: (t) => whistleN(t, 1, 0.55),
    whistleTriple: (t) => whistleN(t, 3, 0.42),
    chime: (t) => chime(t),
    whoosh: (t) => whoosh(t),
  };
  // Event-type → preset id, overridable via setEventSounds().
  let eventSounds = Object.assign({}, DEFAULT_EVENT_SOUNDS, o.eventSounds || {});

  function playKind(kind, when) {
    const cat = soundCategory(kind);
    if (!cat) return;
    const fn = PRESET[eventSounds[cat]];
    if (fn) fn(when != null ? when : ctx.currentTime);
  }

  // --- Background music: a looping 4-bar bed that BUILDS with the replay's
  // progress (0→1) — faster tempo, louder, busier percussion, a higher arp and a
  // rising tension drone — so it grows more frantic/stressful toward full time.
  // Scheduled ahead off the audio clock so it stays tight during playback and the
  // real-time export. Mixed low so the event SFX sit on top.
  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const baseGain = o.musicGain != null ? o.musicGain : 0.16;
  let music = null;
  let musicProgress = 0; // 0..1, driven by setProgress()
  function startMusic() {
    if (music) return;
    if (ctx.state === "suspended" && ctx.resume) ctx.resume();
    const mg = ctx.createGain(); mg.gain.value = 0.0001; mg.connect(master);
    mg.gain.exponentialRampToValueAtTime(baseGain, ctx.currentTime + 0.6);
    const tempo = 122, spb = 60 / tempo, baseEighth = spb / 2;
    const chords = [ // Am – G – C – F, one bar each
      { root: 45, notes: [57, 60, 64] }, { root: 43, notes: [55, 59, 62] },
      { root: 48, notes: [60, 64, 67] }, { root: 41, notes: [57, 60, 65] },
    ];
    const voice = (freq, t, dur, type, peak) => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(mg); osc.start(t); osc.stop(t + dur + 0.03);
    };
    const kick = (t) => {
      const osc = ctx.createOscillator(); osc.type = "sine";
      osc.frequency.setValueAtTime(160, t); osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(g); g.connect(mg); osc.start(t); osc.stop(t + 0.2);
    };
    const hat = (t, peak) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.05);
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak || 0.15, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(hp); hp.connect(g); g.connect(mg); src.start(t); src.stop(t + 0.06);
    };
    const snare = (t) => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, 0.18);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.28, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      src.connect(bp); bp.connect(g); g.connect(mg); src.start(t); src.stop(t + 0.2);
    };
    // ten: eased tension 0..1 (stays calmer early, ramps hard near the end).
    const scheduleStep = (s, t, e) => {
      const ten = musicProgress * musicProgress; // ease-in: calmer start, steep finish
      const spbNow = e * 2;
      const bar = Math.floor(s / 8) % 4, inBar = s % 8;
      const ch = chords[bar];
      if (inBar % 2 === 0) { kick(t); voice(midiFreq(ch.root), t, e * 1.8, "triangle", 0.16); }
      if (inBar % 2 === 1 || ten > 0.4) hat(t, 0.12 + ten * 0.12);   // offbeats, then every eighth
      if (inBar % 2 === 1 && ten > 0.7) kick(t);                      // driving double-time kick
      if (inBar === 4 && ten > 0.45) snare(t);                        // backbeat snare
      if (inBar === 0) ch.notes.forEach((n) => voice(midiFreq(n), t, spbNow * 4 * 0.92, "triangle", 0.05 + ten * 0.03));
      const arp = ch.notes[inBar % ch.notes.length] + 12 + (ten > 0.5 ? 12 : 0);
      voice(midiFreq(arp), t, e * 0.9, "sine", 0.05 + ten * 0.06);    // higher + louder with tension
      if (ten > 0.55 && inBar === 0) {                                // rising tension drone
        const drone = 71 + Math.round(ten * 10);
        voice(midiFreq(drone), t, spbNow * 4 * 0.95, "sawtooth", 0.025 + (ten - 0.55) * 0.1);
      }
    };
    let step = 0, nextTime = ctx.currentTime + 0.08;
    const tick = () => {
      const ten = musicProgress * musicProgress;
      try { mg.gain.setTargetAtTime(baseGain * (0.85 + ten * 1.0), ctx.currentTime, 0.1); } catch (e) { /* noop */ }
      const e = baseEighth / (1 + ten * 0.4); // up to ~40% faster by the end
      while (nextTime < ctx.currentTime + 0.12) { scheduleStep(step, nextTime, e); step++; nextTime += e; }
    };
    tick();
    music = { timer: setInterval(tick, 25), mg };
  }
  function stopMusic() {
    if (!music) return;
    clearInterval(music.timer);
    const mg = music.mg; music = null;
    try {
      mg.gain.cancelScheduledValues(ctx.currentTime);
      mg.gain.setValueAtTime(Math.max(0.0001, mg.gain.value), ctx.currentTime);
      mg.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    } catch (e) { /* noop */ }
    setTimeout(() => { try { mg.disconnect(); } catch (e) { /* noop */ } }, 400);
  }

  return {
    ctx,
    play: (kind) => { if (ctx.state === "suspended" && ctx.resume) ctx.resume(); playKind(kind); },
    playAt: (kind, when) => playKind(kind, when),
    startMusic,
    stopMusic,
    setProgress: (p) => { musicProgress = Math.max(0, Math.min(1, p || 0)); },
    setEventSounds: (m) => { eventSounds = Object.assign({}, DEFAULT_EVENT_SOUNDS, m || {}); },
    resume: () => { if (ctx.resume) return ctx.resume(); },
    setVolume: (v) => { master.gain.value = v; },
    close: () => { stopMusic(); if (!o.context && ctx.close) try { ctx.close(); } catch (e) { /* noop */ } },
  };
}

// Live-playback hook: lazily creates a speaker engine (on a user gesture via
// ensureAudio), plays the matching SFX as each new event scene starts, and runs
// the background-music bed while playing (when enabled).
//   opts: { enabled (SFX), music (bg music), playing }
export function useReplaySound(celebrating, options) {
  const opts = options || {};
  const enabled = !!opts.enabled, music = !!opts.music, playing = !!opts.playing;
  const progress = opts.progress || 0;
  const eventSounds = opts.eventSounds;
  const engineRef = useRef(null);
  const lastKey = useRef("");

  const ensureAudio = () => {
    if (!engineRef.current) engineRef.current = createReplayAudio({ eventSounds });
    if (engineRef.current) engineRef.current.resume();
    return engineRef.current;
  };

  useEffect(() => { if (engineRef.current && eventSounds) engineRef.current.setEventSounds(eventSounds); }, [eventSounds]);

  useEffect(() => {
    if (!enabled || !celebrating) return;
    const key = celebrating._m + ":" + celebrating.kind;
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (engineRef.current) engineRef.current.play(celebrating.kind);
  }, [celebrating, enabled]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (music && playing) eng.startMusic();
    else eng.stopMusic();
  }, [music, playing]);

  useEffect(() => { if (engineRef.current) engineRef.current.setProgress(progress); }, [progress]);

  useEffect(() => () => { if (engineRef.current) engineRef.current.close(); }, []);

  return { ensureAudio };
}
