"use client";

/*
 * MatchPicker — date + fixtures dropdown that fills home/away/fmid, ported from
 * the static admin-common.js. Controlled: the parent owns `value`
 * ({ date, home, away, fmid }) and gets updates via onChange. Extra toolbar
 * content (per-page buttons/hints) can be passed as children.
 */

import { useEffect, useRef, useState } from "react";

export default function MatchPicker({ value, onChange, children }) {
  const [fixtures, setFixtures] = useState([]);
  const [note, setNote] = useState("");
  const loadedFor = useRef(null);

  const set = (patch) => onChange(Object.assign({}, value, patch));

  const loadFixtures = async () => {
    const date = value.date;
    setNote("loading…"); setFixtures([]);
    try {
      const r = await fetch("/api/fixtures?date=" + encodeURIComponent(date));
      const j = await r.json();
      const ev = (j && j.fixtures) || [];
      setFixtures(ev);
      setNote(ev.length ? ev.length + " matches" : "no fixtures for " + date);
    } catch (e) { setNote("failed to load"); }
  };

  // Load on mount and whenever the date changes.
  useEffect(() => {
    if (loadedFor.current !== value.date) { loadedFor.current = value.date; loadFixtures(); }
  }, [value.date]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (e) => {
    const parts = e.target.value.split("|");
    set({ home: parts[0] || "", away: parts[1] || "", fmid: parts[2] || "" });
  };

  return (
    <div className="card">
      <div className="row">
        <div>
          <label>Date (UTC)</label>
          <input type="date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
        </div>
        <div>
          <label>Match picker (fills teams)</label>
          <select onChange={onPick} defaultValue="">
            <option value="">{fixtures.length ? "— " + fixtures.length + " matches —" : "— load fixtures —"}</option>
            {fixtures.map((e, i) => (
              <option key={i} value={(e.home || "") + "|" + (e.away || "") + "|" + (e.fmid || "")}>
                {(e.home || "?") + " vs " + (e.away || "?") + (e.competition ? "  ·  " + e.competition : "")}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div><label>Home team</label><input type="text" placeholder="e.g. Spain" value={value.home} onChange={(e) => set({ home: e.target.value })} /></div>
        <div><label>Away team</label><input type="text" placeholder="e.g. Cape Verde" value={value.away} onChange={(e) => set({ away: e.target.value })} /></div>
        <div><label>FotMob match id</label><input type="text" placeholder="auto-filled by picker" value={value.fmid} onChange={(e) => set({ fmid: e.target.value })} /></div>
      </div>
      <div className="toolbar">
        <button className="secondary" onClick={loadFixtures}>Load fixtures</button>
        {children}
        {note ? <span className="pill">{note}</span> : null}
      </div>
    </div>
  );
}
