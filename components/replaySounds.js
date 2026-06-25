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

  function whistle(t, isRed) {
    const blow = (start, dur, freq) => {
      const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = freq;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
      const lg = ctx.createGain(); lg.gain.value = freq * 0.02;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start(start); lfo.stop(start + dur);
      const g = ctx.createGain();
      env(g, start, 0.3, 0.02, dur - 0.06, 0.04);
      osc.connect(g); g.connect(master); osc.start(start); osc.stop(start + dur);
    };
    blow(t, 0.16, 2300);
    blow(t + 0.22, 0.16, 2300);
    if (isRed) blow(t + 0.44, 0.3, 2050);
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

  function playKind(kind, when) {
    const t = when != null ? when : ctx.currentTime;
    const type = markerType(kind);
    if (type === "goal") goal(t);
    else if (type === "yellow" || type === "red") whistle(t, type === "red");
    else if (type === "sub") chime(t);
    else if (type === "shot") whoosh(t);
  }

  return {
    ctx,
    play: (kind) => { if (ctx.state === "suspended" && ctx.resume) ctx.resume(); playKind(kind); },
    playAt: (kind, when) => playKind(kind, when),
    resume: () => { if (ctx.resume) return ctx.resume(); },
    setVolume: (v) => { master.gain.value = v; },
    close: () => { if (!o.context && ctx.close) try { ctx.close(); } catch (e) { /* noop */ } },
  };
}

// Live-playback hook: lazily creates a speaker engine (on a user gesture via
// ensureAudio) and plays the matching SFX whenever a new event scene starts.
export function useEventSound(celebrating, enabled) {
  const engineRef = useRef(null);
  const lastKey = useRef("");

  const ensureAudio = () => {
    if (!engineRef.current) engineRef.current = createReplayAudio();
    if (engineRef.current) engineRef.current.resume();
    return engineRef.current;
  };

  useEffect(() => {
    if (!enabled || !celebrating) return;
    const key = celebrating._m + ":" + celebrating.kind;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const eng = engineRef.current;
    if (eng) eng.play(celebrating.kind);
  }, [celebrating, enabled]);

  useEffect(() => () => { if (engineRef.current) engineRef.current.close(); }, []);

  return { ensureAudio };
}
