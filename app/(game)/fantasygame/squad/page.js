"use client";

/*
 * /fantasygame/squad — your club's players, with per-player Training. Reads
 * /api/game/club for the squad + budget; Train posts to /api/game/train.
 */

import { useEffect, useState } from "react";

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return "€" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1000) return "€" + Math.round(v / 1000) + "k";
  return "€" + v;
}
const LINE = { GK: 0, DF: 1, MF: 2, FW: 3 };

export default function SquadPage() {
  const [data, setData] = useState(null);
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState("");

  const load = async () => {
    try {
      const j = await (await fetch("/api/game/club")).json();
      setData(j);
      setHint(j.club ? "" : "no club yet — claim one on the dashboard");
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const train = async (id) => {
    if (busy) return;
    setBusy(id);
    try {
      const j = await (await fetch("/api/game/train", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: id }),
      })).json();
      setHint(j && j.ok ? `trained ✓ → ${j.rating} (−${money(j.cost)})` : (j && j.error) || "error");
      if (j && j.ok) await load();
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(""); }
  };

  if (!data) return <div className="game-card"><h1>Squad</h1><p className="game-sub">{hint}</p></div>;
  if (!data.club) return <div className="game-card"><h1>Squad</h1><p className="game-sub">{hint}</p><a className="game-btn" href="/fantasygame">Dashboard</a></div>;

  const squad = (data.squad || []).slice().sort((a, b) => (LINE[a.position] ?? 9) - (LINE[b.position] ?? 9) || b.rating - a.rating);
  const cash = data.manager && data.manager.cashBalance;

  return (
    <div className="game-card">
      <h1>{data.club.name} · Squad</h1>
      <p className="game-sub">Budget <b style={{ color: "var(--accent)" }}>{money(cash)}</b> · {squad.length} players · {hint}</p>
      <table className="game-table">
        <thead><tr><th>Pos</th><th>Player</th><th>Age</th><th>Rating</th><th>Value</th><th></th></tr></thead>
        <tbody>
          {squad.map((p) => (
            <tr key={p.id}>
              <td>{p.position}</td>
              <td>{p.name}</td>
              <td>{p.age || "—"}</td>
              <td><b>{p.rating}</b></td>
              <td>{money(p.marketValue)}</td>
              <td>
                <button className="game-btn secondary" style={{ padding: "4px 10px" }}
                  disabled={busy === p.id || p.rating >= 90} onClick={() => train(p.id)}>
                  {busy === p.id ? "…" : "Train +1"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
