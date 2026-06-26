"use client";

/*
 * ClubPanel — dashboard club section. Shows the manager's owned club (cash,
 * squad size, quick links) or, if none yet, a picker to claim an unowned club.
 */

import { useEffect, useState } from "react";

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return "€" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1000) return "€" + Math.round(v / 1000) + "k";
  return "€" + v;
}

export default function ClubPanel() {
  const [state, setState] = useState(null);
  const [clubs, setClubs] = useState([]);
  const [pick, setPick] = useState("");
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const j = await (await fetch("/api/game/club")).json();
      setState(j);
      if (!j.club) {
        const cj = await (await fetch("/api/game/clubs")).json();
        const free = (cj.clubs || []).filter((c) => c.isAi && !c.ownerManagerId);
        setClubs(free);
        setPick(free.length ? free[0].id : "");
        setHint(free.length ? `${free.length} clubs available` : "no clubs yet — seed squads in admin");
      } else {
        setHint("");
      }
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const claim = async () => {
    if (!pick || busy) return;
    setBusy(true); setHint("claiming…");
    try {
      const j = await (await fetch("/api/game/club", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clubId: pick }),
      })).json();
      if (j && j.ok) { setHint("claimed ✓"); await load(); }
      else setHint((j && j.error) || "error");
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  if (!state) return <div className="game-card"><h2>Your club</h2><p className="game-sub">{hint}</p></div>;

  if (state.club) {
    const c = state.club, cash = state.manager && state.manager.cashBalance;
    return (
      <div className="game-card">
        <h2>{c.name}</h2>
        <p className="game-sub">
          Budget <b style={{ color: "var(--accent)" }}>{money(cash)}</b> · squad {state.squad ? state.squad.length : 0} · {c.baseFormation}
        </p>
        <a className="game-btn secondary" href="/fantasygame/squad">Squad</a>
        <a className="game-btn secondary" href="/fantasygame/transfers">Transfers</a>
        <a className="game-btn secondary" href="/fantasygame/finances">Finances</a>
      </div>
    );
  }

  return (
    <div className="game-card">
      <h2>Choose your club</h2>
      <p className="game-sub">Pick a club to manage. You get a transfer budget to build your squad.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={pick} onChange={(e) => setPick(e.target.value)}
          style={{ padding: "8px 10px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8 }}>
          {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="game-btn" onClick={claim} disabled={busy || !clubs.length}>Claim club</button>
        <span className="game-note" style={{ marginTop: 0 }}>{hint}</span>
      </div>
    </div>
  );
}
