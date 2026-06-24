"use client";

// Manual TV overrides admin (ported from public/admin/overrides.html).

import { useState } from "react";
import MatchPicker from "@/components/admin/MatchPicker";
import { asJson, todayUTC } from "@/components/admin/adminUtil";

export default function OverridesPage() {
  const [pick, setPick] = useState({ date: todayUTC(), home: "", away: "", fmid: "" });
  const [country, setCountry] = useState("Portugal");
  const [channels, setChannels] = useState("");
  const [hint, setHint] = useState("pick a match to override its listing");
  const [list, setList] = useState("—");

  const onPick = (p) => {
    setPick(p);
    setHint(p.fmid ? ("match " + p.fmid + " — fill channel + Save") : "pick a match first");
  };

  const reload = async () => {
    try {
      const j = await asJson(await fetch("/api/overrides?date=" + encodeURIComponent(pick.date)));
      const ov = (j && j.overrides) || [];
      setList(ov.length ? ov.map((o) => o.fmid + "  " + (o.home || "?") + " vs " + (o.away || "?") + "\n  " +
        (o.rows || []).map((r) => r.country + ": " + r.channel).join(", ")).join("\n\n") : "no overrides for " + pick.date);
    } catch (e) { setList(String(e.message || e)); }
  };

  const save = async () => {
    if (!pick.fmid) { setHint("pick a match (need its id) first"); return; }
    const ch = channels.split(",").map((s) => s.trim()).filter(Boolean);
    if (!country.trim() || !ch.length) { setHint("country + at least one channel"); return; }
    const rows = ch.map((c) => ({ country: country.trim(), channel: c }));
    setHint("saving…");
    try {
      const j = await asJson(await fetch("/api/overrides", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fmid: pick.fmid, date: pick.date, home: pick.home, away: pick.away, rows }),
      }));
      setHint(j && j.ok ? "saved ✓ (reload the app to see it)" : ((j && j.error) || "error"));
      reload();
    } catch (e) { setHint(String(e.message || e)); }
  };

  const remove = async () => {
    if (!pick.fmid) { setHint("pick a match first"); return; }
    try { await asJson(await fetch("/api/overrides?fmid=" + encodeURIComponent(pick.fmid), { method: "DELETE" })); setHint("removed"); reload(); }
    catch (e) { setHint(String(e.message || e)); }
  };

  return (
    <>
      <div className="sub">Add broadcasters a free feed missed. Pick a match, then attach a channel — it's saved server-side and merged into the listings like any other source.</div>

      <MatchPicker value={pick} onChange={onPick} />

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>🔒 Manual TV override</div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Add broadcasters a free feed missed (e.g. Sport TV for a match FotMob skips). Saved server-side
          and merged into the listings like any source. Admin login required (set <code>ADMIN_USER</code> / <code>ADMIN_PASSWORD</code>).
        </div>
        <div className="row">
          <div><label>Country</label><input type="text" value={country} onChange={(e) => setCountry(e.target.value)} /></div>
          <div><label>Channels (comma-separated)</label><input type="text" placeholder="e.g. Sport TV 5" value={channels} onChange={(e) => setChannels(e.target.value)} /></div>
        </div>
        <div className="toolbar">
          <button onClick={save}>Save override</button>
          <button className="secondary" onClick={reload}>Show overrides for date</button>
          <button className="secondary" onClick={remove}>Remove for this match</button>
          <span className="pill">{hint}</span>
        </div>
        <pre>{list}</pre>
      </div>
    </>
  );
}
