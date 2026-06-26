"use client";

/*
 * /fantasygame/transfers — the market. Buy free agents / AI-club players, sell
 * your own. Reads + posts to /api/game/transfers.
 */

import { useEffect, useState } from "react";

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return "€" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1000) return "€" + Math.round(v / 1000) + "k";
  return "€" + v;
}
const ratingClass = (r) => (r >= 85 ? "elite" : r >= 75 ? "good" : r >= 65 ? "mid" : "");

export default function TransfersPage() {
  const [data, setData] = useState(null);
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState("");
  const [pos, setPos] = useState("ALL");

  const load = async () => {
    try {
      const j = await (await fetch("/api/game/transfers")).json();
      if (j.error) { setHint(j.error); setData({ market: [], squad: [] }); return; }
      setData(j); setHint("");
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const act = async (action, id) => {
    if (busy) return;
    setBusy(id + action);
    try {
      const j = await (await fetch("/api/game/transfers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, playerId: id }),
      })).json();
      setHint(j && j.ok ? `${action} ✓ ${money(j.fee)}` : (j && j.error) || "error");
      if (j && j.ok) await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(""); }
  };

  if (!data) return <div className="game-card"><h1>Transfers</h1><p className="game-sub">{hint}</p></div>;
  if (!data.market && !data.squad) return <div className="game-card"><h1>Transfers</h1><p className="game-sub">{hint}</p></div>;

  const market = (data.market || []).filter((p) => pos === "ALL" || p.position === pos);

  return (
    <>
      <div className="game-card">
        <h1>Transfer market</h1>
        <div className="game-statline">
          <span className="game-chip accent">Budget <b>{money(data.cash)}</b></span>
          <span className="game-chip">Squad <b>{data.squadSize}</b></span>
          {hint ? <span className="game-chip">{hint}</span> : null}
        </div>
        <div className="game-pills">
          {["ALL", "GK", "DF", "MF", "FW"].map((p) => (
            <button key={p} className={`game-pill ${pos === p ? "active" : ""}`} onClick={() => setPos(p)}>{p}</button>
          ))}
        </div>
        <div className="game-tablewrap">
        <table className="game-table">
          <thead><tr><th>Pos</th><th>Player</th><th>Club</th><th>OVR</th><th>Price</th><th></th></tr></thead>
          <tbody>
            {market.length ? market.map((p) => (
              <tr key={p.id}>
                <td><span className={`pos-badge ${p.position}`}>{p.position}</span></td><td>{p.name}</td>
                <td style={{ color: "var(--muted)" }}>{p.clubName || "free agent"}</td>
                <td><span className={`rating-badge ${ratingClass(p.rating)}`}>{p.rating}</span></td><td>{money(p.value)}</td>
                <td>
                  <button className="game-btn sm" disabled={busy === p.id + "buy" || data.cash < p.value} onClick={() => act("buy", p.id)}>
                    {busy === p.id + "buy" ? "…" : "Buy"}
                  </button>
                </td>
              </tr>
            )) : <tr><td colSpan="6" className="game-empty">No players available in this position.</td></tr>}
          </tbody>
        </table>
        </div>
      </div>

      <div className="game-card">
        <h2>Your squad</h2>
        <div className="game-tablewrap">
        <table className="game-table">
          <thead><tr><th>Pos</th><th>Player</th><th>OVR</th><th>Sell for</th><th></th></tr></thead>
          <tbody>
            {(data.squad || []).map((p) => (
              <tr key={p.id}>
                <td><span className={`pos-badge ${p.position}`}>{p.position}</span></td><td>{p.name}</td>
                <td><span className={`rating-badge ${ratingClass(p.rating)}`}>{p.rating}</span></td>
                <td>{money(Math.round((p.value || 0) * 0.9))}</td>
                <td>
                  <button className="game-btn secondary sm" disabled={busy === p.id + "sell"} onClick={() => act("sell", p.id)}>
                    {busy === p.id + "sell" ? "…" : "Sell"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </>
  );
}
