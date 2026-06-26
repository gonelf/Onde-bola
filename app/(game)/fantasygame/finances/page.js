"use client";

/*
 * /fantasygame/finances — wallet balance + recent ledger (gate, prize,
 * transfer, training). Reads /api/game/finances.
 */

import { useEffect, useState } from "react";

function money(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? "€" + (a / 1_000_000).toFixed(2) + "M" : a >= 1000 ? "€" + Math.round(a / 1000) + "k" : "€" + a;
  return sign + s;
}
const LABEL = { gate: "Gate receipts", prize: "Prize money", transfer: "Transfer", training: "Training", wages: "Wages", other: "Other" };

export default function FinancesPage() {
  const [data, setData] = useState(null);
  const [hint, setHint] = useState("loading…");

  useEffect(() => {
    (async () => {
      try {
        const j = await (await fetch("/api/game/finances")).json();
        if (j.error) { setHint(j.error); setData({ ledger: [] }); return; }
        setData(j); setHint("");
      } catch (e) { setHint(String(e.message || e)); }
    })();
  }, []);

  if (!data) return <div className="game-card"><h1>Finances</h1><p className="game-sub">{hint}</p></div>;

  return (
    <div className="game-card">
      <h1>Finances</h1>
      <div className="game-statline">
        <span className="game-chip accent">Balance <b>{money(data.cash)}</b></span>
        {hint ? <span className="game-chip">{hint}</span> : null}
      </div>
      <div className="game-tablewrap">
      <table className="game-table">
        <thead><tr><th></th><th>Item</th><th>Amount</th></tr></thead>
        <tbody>
          {(data.ledger || []).map((r, i) => (
            <tr key={i}>
              <td style={{ color: "var(--muted)" }}>{r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : ""}</td>
              <td>{LABEL[r.type] || r.type}</td>
              <td className={r.amount < 0 ? "amt-neg" : "amt-pos"}>{money(r.amount)}</td>
            </tr>
          ))}
          {!(data.ledger || []).length ? <tr><td colSpan="3" className="game-empty">No transactions yet — play league matches to earn gate &amp; prize money.</td></tr> : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}
