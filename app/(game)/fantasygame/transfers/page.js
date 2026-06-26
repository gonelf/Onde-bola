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
        <p className="game-sub">Budget <b style={{ color: "var(--accent)" }}>{money(data.cash)}</b> · squad {data.squadSize} · {hint}</p>
        <div style={{ marginBottom: 8 }}>
          {["ALL", "GK", "DF", "MF", "FW"].map((p) => (
            <button key={p} className="game-btn secondary" style={{ padding: "4px 10px", opacity: pos === p ? 1 : 0.6 }} onClick={() => setPos(p)}>{p}</button>
          ))}
        </div>
        <table className="game-table">
          <thead><tr><th>Pos</th><th>Player</th><th>Club</th><th>Rating</th><th>Price</th><th></th></tr></thead>
          <tbody>
            {market.map((p) => (
              <tr key={p.id}>
                <td>{p.position}</td><td>{p.name}</td>
                <td style={{ color: "var(--muted)" }}>{p.clubName || "free agent"}</td>
                <td><b>{p.rating}</b></td><td>{money(p.value)}</td>
                <td>
                  <button className="game-btn" style={{ padding: "4px 10px" }} disabled={busy === p.id + "buy" || data.cash < p.value} onClick={() => act("buy", p.id)}>
                    {busy === p.id + "buy" ? "…" : "Buy"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="game-card">
        <h2>Your squad</h2>
        <table className="game-table">
          <thead><tr><th>Pos</th><th>Player</th><th>Rating</th><th>Sell for</th><th></th></tr></thead>
          <tbody>
            {(data.squad || []).map((p) => (
              <tr key={p.id}>
                <td>{p.position}</td><td>{p.name}</td><td><b>{p.rating}</b></td>
                <td>{money(Math.round((p.value || 0) * 0.9))}</td>
                <td>
                  <button className="game-btn secondary" style={{ padding: "4px 10px" }} disabled={busy === p.id + "sell"} onClick={() => act("sell", p.id)}>
                    {busy === p.id + "sell" ? "…" : "Sell"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
