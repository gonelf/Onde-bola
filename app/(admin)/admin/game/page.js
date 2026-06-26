"use client";

// Consolidated game admin (M6): overview, manager/club tools, league lifecycle,
// and a guarded data wipe. Basic-Auth via middleware, so calls carry creds.

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

function money(n) {
  const v = Number(n) || 0;
  return v >= 1_000_000 ? "€" + (v / 1_000_000).toFixed(1) + "M" : "€" + Math.round(v / 1000) + "k";
}

export default function GameAdminPage() {
  const [data, setData] = useState(null);
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);
  const [wipeText, setWipeText] = useState("");

  const load = async () => {
    try {
      const j = await asJson(await fetch("/api/admin/game"));
      setData(j); setHint("");
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const act = async (payload, label) => {
    if (busy) return;
    setBusy(true); setHint(label + "…");
    try {
      const j = await asJson(await fetch("/api/admin/game", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      }));
      setHint(j && j.ok ? `${label} ✓` : (j && j.error) || "error");
      await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (!data) return <div className="card"><div className="sub">{hint}</div></div>;
  const o = data.overview || {};

  return (
    <>
      <div className="sub">Operate the manager game — overview, managers, leagues, reset.</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📊 Overview</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
          <Stat label="Managers" value={o.managers} />
          <Stat label="Clubs" value={`${o.clubsClaimed}/${o.clubsTotal}`} sub="claimed/total" />
          <Stat label="Free clubs" value={o.clubsFree} />
          <Stat label="Players" value={o.players} />
          <Stat label="Leagues" value={`${o.leaguesActive}/${o.leaguesAll}`} sub="active/all" />
          <Stat label="Last sim" value={o.lastSim ? new Date(o.lastSim).toISOString().slice(5, 16).replace("T", " ") : "—"} />
        </div>
        <div className="sub" style={{ marginTop: 10 }}>
          Sources — FotMob: {flag(o.sources && o.sources.fotmob)} · Football-Data: {flag(o.sources && o.sources.footballdata)} · TheSportsDB: {flag(o.sources && o.sources.thesportsdb)}
          <span className="pill" style={{ marginLeft: 10 }}>{hint || "ready"}</span>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>👤 Managers</div>
        {(data.managers || []).length ? (data.managers || []).map((m) => (
          <div className="loader-row" key={m.id}>
            <div className="loader-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong>{m.name || "(unnamed)"}</strong>
              <span className="sub">{m.clubName ? `manages ${m.clubName}` : "no club"} · {money(m.cash)}</span>
            </div>
            <div className="toolbar" style={{ marginTop: 6 }}>
              {m.clubId ? <button className="secondary" disabled={busy} onClick={() => act({ action: "reset-manager", managerId: m.id }, "reset manager")}>Release club</button> : null}
              <button className="secondary" disabled={busy} onClick={() => { const v = prompt("Set budget (whole €):", String(m.cash || 0)); if (v != null) act({ action: "set-budget", managerId: m.id, amount: Number(v) }, "set budget"); }}>Set budget</button>
            </div>
          </div>
        )) : <div className="loader-empty">No managers yet.</div>}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🏆 Leagues</div>
        {(data.leagues || []).length ? (data.leagues || []).map((l) => (
          <div className="loader-row" key={l.id}>
            <div className="loader-head" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <strong>{l.name}</strong>
              <span className="sub">{l.season || "Season 1"} · tier {l.tier} · {l.clubCount} clubs · {l.played}/{l.fixtures} played · {l.status}</span>
            </div>
            <div className="toolbar" style={{ marginTop: 6 }}>
              <button className="secondary" disabled={busy} onClick={() => { const r = prompt("Sim which round?"); if (r) act({ action: "sim-round", leagueId: l.id, round: Number(r) }, "sim round"); }}>Sim round</button>
              <button className="secondary" disabled={busy} onClick={() => { if (confirm(`Delete league "${l.name}"? Fixtures + results are removed.`)) act({ action: "delete-league", leagueId: l.id }, "delete league"); }}>Delete</button>
            </div>
          </div>
        )) : <div className="loader-empty">No leagues. Create one in “Game: leagues”.</div>}
        <div className="sub" style={{ marginTop: 6 }}>Advance ticks &amp; end-of-season promotion/relegation live in <a href="/admin/game-league">Game: leagues</a>.</div>
      </div>

      <div className="card" style={{ borderColor: "#7a2a2a" }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: "#e8867e" }}>⚠️ Danger zone</div>
        <div className="sub" style={{ marginBottom: 8 }}>
          Wipe ALL game data — clubs, players, leagues, fixtures, results, transfers, finances and
          every manager’s club/budget. User accounts stay. Type <code>WIPE</code> to enable.
        </div>
        <div className="toolbar">
          <input value={wipeText} onChange={(e) => setWipeText(e.target.value)} placeholder="WIPE" style={{ maxWidth: 120 }} />
          <button disabled={busy || wipeText !== "WIPE"} onClick={() => act({ action: "wipe", confirm: "WIPE" }, "wipe all game data")}>Wipe everything</button>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ background: "var(--panel,#182230)", border: "1px solid var(--line,#2a3647)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value == null ? "—" : value}</div>
      <div className="sub" style={{ margin: 0 }}>{label}{sub ? ` (${sub})` : ""}</div>
    </div>
  );
}
function flag(b) { return b ? "✅" : "—"; }
