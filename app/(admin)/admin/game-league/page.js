"use client";

// Game leagues admin — create a league from an imported squad snapshot (full
// double round-robin), then "advance" it by running the cron tick manually.
// Basic-Auth (same as the rest of /admin), so calls carry creds automatically.

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

export default function GameLeaguePage() {
  const [data, setData] = useState({ snapshots: [], leagues: [] });
  const [snapshotId, setSnapshotId] = useState("");
  const [interval, setIntervalMin] = useState(1440);
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const j = await asJson(await fetch("/api/admin/league"));
      setData({ snapshots: j.snapshots || [], leagues: j.leagues || [] });
      const snaps = (j.snapshots || []).filter((s) => s.clubCount >= 2);
      if (snaps.length) setSnapshotId(snaps[0].id);
      setHint(`${(j.leagues || []).length} league(s) · ${(j.snapshots || []).length} snapshot(s)`);
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!snapshotId || busy) return;
    setBusy(true); setHint("creating league + fixtures…");
    try {
      const j = await asJson(await fetch("/api/admin/league", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId, intervalMinutes: Number(interval) }),
      }));
      setHint(j && j.ok ? `created ✓ ${j.clubs} clubs · ${j.fixtures} fixtures (${j.rounds} rounds)` : (j && j.error) || "error");
      await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const advance = async (leagueId, all) => {
    if (busy) return;
    setBusy(true); setHint(all ? "simulating ALL scheduled…" : "simulating due matchdays…");
    try {
      const q = `?max=200&league=${encodeURIComponent(leagueId)}` + (all ? "&all=1" : "");
      const j = await asJson(await fetch("/api/cron-tick" + q));
      setHint(j && j.ok ? `ticked ✓ simulated ${j.simulated}, skipped ${j.skipped}, errors ${j.errors}` : (j && j.error) || "error");
      await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const seedDemo = async () => {
    if (busy) return;
    setBusy(true); setHint("seeding demo league + simulating a full season…");
    try {
      const j = await asJson(await fetch("/api/admin/seed-demo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clubs: 8 }),
      }));
      setHint(j && j.ok ? `demo ready ✓ ${j.clubs} clubs · ${j.fixtures} games simulated — open /fantasygame` : (j && j.error) || "error");
      await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const snaps = data.snapshots.filter((s) => s.clubCount >= 2);

  return (
    <>
      <div className="sub">Create a league from imported squads and run the season tick.</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>⚡ One-click demo</div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Generates a fictional 8-club league and simulates a whole season — no FotMob needed.
          Use this to populate <code>/fantasygame</code> instantly.
        </div>
        <div className="toolbar">
          <button onClick={seedDemo} disabled={busy}>Seed demo season</button>
          <span className="pill">{hint}</span>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🏆 Create league</div>
        <div className="row">
          <div style={{ flex: "2 1 240px" }}>
            <label>From snapshot</label>
            <select value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}>
              {snaps.length ? snaps.map((s) => (
                <option key={s.id} value={s.id}>{s.seasonLabel || "—"} · {s.clubCount} clubs</option>
              )) : <option value="">— seed squads first —</option>}
            </select>
          </div>
          <div>
            <label>Matchday interval (min)</label>
            <input type="number" min="1" value={interval} onChange={(e) => setIntervalMin(e.target.value)} />
          </div>
        </div>
        <div className="toolbar">
          <button onClick={create} disabled={busy || !snaps.length}>Create league</button>
          <span className="pill">{hint}</span>
        </div>
        <div className="sub" style={{ marginTop: 6 }}>
          Default 1440 min = one matchday per day (the daily cron simulates due rounds). Use a small
          value, then “Advance all”, to play a whole season instantly for testing.
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📅 Leagues</div>
        {data.leagues.length ? data.leagues.map((l) => (
          <div className="loader-row" key={l.id}>
            <div className="loader-head" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong>{l.name}</strong>
              <span className="sub">tier {l.tier} · {l.clubCount} clubs · {l.status}</span>
            </div>
            <div className="toolbar" style={{ marginTop: 6 }}>
              <button className="secondary" onClick={() => advance(l.id, false)} disabled={busy}>Advance due</button>
              <button onClick={() => advance(l.id, true)} disabled={busy}>Advance ALL (sim season)</button>
            </div>
          </div>
        )) : <div className="loader-empty">No leagues yet.</div>}
      </div>
    </>
  );
}
