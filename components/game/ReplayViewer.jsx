"use client";

/*
 * ReplayViewer — plays a frozen match_results row in the SAME animation the
 * public site and admin lab use. Thin wrapper: it preps the stored events,
 * drives the shared useReplayClock, and renders <MatchPitch> + a scoreboard,
 * clock and scrub bar. All the heavy lifting lives in the reused engine.
 */

import { useMemo } from "react";
import MatchPitch from "@/components/MatchPitch";
import useReplayClock from "@/components/useReplayClock";
import { prepEvents, maxMinute, runningScore, addShotEvents } from "@/public/admin/replay-sim";

const DURATION_MS = 16000;

export default function ReplayViewer({ home, away, events: raw, stats }) {
  const events = useMemo(() => {
    const base = prepEvents(raw);
    const mm = maxMinute(base);
    return addShotEvents(base, stats, mm, base.length * 131 + Math.round(mm) * 7);
  }, [raw, stats]);
  const maxMin = useMemo(() => maxMinute(events), [events]);

  const { clock, playing, celebrating, toggle, restart, scrub } = useReplayClock(events, maxMin, DURATION_MS);
  const { hs, as } = runningScore(events, clock);
  const progress = maxMin > 0 ? Math.min(1, clock / maxMin) : 1;
  const minNum = Math.floor(clock);
  const clockLabel = clock >= maxMin ? "FT" : (minNum > 90 ? "90+" + (minNum - 90) : minNum) + "'";
  const scrubPct = (progress * 100).toFixed(2);

  return (
    <div className="match-replay">
      <div className="replay-board">
        <span className="rb-team home">{home.name}</span>
        <span className="rb-score" key={hs + "-" + as}>{hs}<i>–</i>{as}</span>
        <span className="rb-team away">{away.name}</span>
      </div>
      <div className="rb-clock">{clockLabel}</div>

      <MatchPitch
        home={home} away={away} events={events} stats={stats}
        clock={clock} celebrate={celebrating} goalLabel="GOAL!"
        showMarkers showTrail showNumbers
      />

      <div className="replay-controls">
        <button className="replay-btn" type="button" onClick={toggle}>{playing ? "⏸" : "▶"}</button>
        <input className="replay-scrub" type="range" min="0" max={maxMin} step="0.1" value={clock}
          onChange={(e) => scrub(Number(e.target.value))}
          style={{ background: `linear-gradient(90deg, var(--accent) ${scrubPct}%, var(--line) ${scrubPct}%)` }} />
        <button className="replay-btn" type="button" onClick={restart}>↺</button>
      </div>
    </div>
  );
}
