"use client";

/*
 * useReplayClock — shared playback clock for the match replay, used by both the
 * public modal (MatchReplay) and the admin lab. Advances a virtual match clock
 * over `durationMs`, but PAUSES the clock (freezing ball/players/score) while an
 * event's on-pitch scene plays: when playback reaches a goal/card/sub, it holds
 * the clock at that minute for the scene's duration (sceneMs) and exposes the
 * event as `celebrating` so MatchPitch can render the scene on real CSS time.
 *
 * Returns { clock, playing, celebrating, toggle, restart, scrub }.
 * `events` must be prepped (have numeric _m) and sorted.
 */

import { useEffect, useRef, useState } from "react";
import { sceneMs } from "@/public/admin/replay-sim";

export default function useReplayClock(events, maxMin, durationMs, sceneScale = 1) {
  const [clock, setClock] = useState(maxMin);
  const [playing, setPlaying] = useState(false);
  const [celebrating, setCelebrating] = useState(null);

  const raf = useRef(0);
  const lastTs = useRef(0);
  const holdUntil = useRef(0);
  const clockRef = useRef(clock);
  const celebRef = useRef(null);
  const celebrated = useRef(new Set());
  clockRef.current = clock;

  // Reset to full time when the match changes.
  useEffect(() => {
    setPlaying(false); setCelebrating(null); celebRef.current = null;
    holdUntil.current = 0; celebrated.current = new Set();
    clockRef.current = maxMin; setClock(maxMin);
  }, [events, maxMin]);

  useEffect(() => {
    if (!playing) return undefined;
    lastTs.current = 0;
    const step = (ts) => {
      // Holding while a scene plays: keep the frame loop alive but freeze time.
      if (ts < holdUntil.current) { raf.current = requestAnimationFrame(step); return; }
      if (celebRef.current) { celebRef.current = null; setCelebrating(null); lastTs.current = ts; }
      if (!lastTs.current) lastTs.current = ts;
      const dt = ts - lastTs.current; lastTs.current = ts;
      const cur = clockRef.current;
      const next = Math.min(maxMin, cur + (dt / durationMs) * maxMin);

      // The soonest not-yet-celebrated scene event we'd reach this step.
      let hit = null;
      for (let i = 0; i < events.length; i++) {
        if (celebrated.current.has(i)) continue;
        const e = events[i];
        if (sceneMs(e) <= 0) continue;
        if (e._m > cur + 1e-9 && e._m <= next + 1e-9 && (!hit || e._m < hit.e._m)) hit = { e, i };
      }
      if (hit) {
        celebrated.current.add(hit.i);
        clockRef.current = hit.e._m; setClock(hit.e._m);
        celebRef.current = hit.e; setCelebrating(hit.e);
        holdUntil.current = ts + sceneMs(hit.e) * sceneScale;
        raf.current = requestAnimationFrame(step);
        return;
      }
      clockRef.current = next; setClock(next);
      if (next >= maxMin) { setPlaying(false); return; }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, maxMin, durationMs, events, sceneScale]);

  const clearHold = () => { holdUntil.current = 0; celebRef.current = null; setCelebrating(null); };

  const toggle = () => {
    if (clockRef.current >= maxMin) {
      celebrated.current = new Set(); clearHold();
      clockRef.current = 0; setClock(0); setPlaying(true);
    } else setPlaying((p) => !p);
  };
  const restart = () => {
    setPlaying(false); clearHold(); celebrated.current = new Set();
    clockRef.current = 0; setClock(0);
  };
  const scrub = (v) => {
    setPlaying(false); clearHold();
    const s = new Set();
    for (let i = 0; i < events.length; i++) if (events[i]._m <= v) s.add(i);
    celebrated.current = s;
    clockRef.current = v; setClock(v);
  };

  return { clock, playing, celebrating, toggle, restart, scrub };
}
