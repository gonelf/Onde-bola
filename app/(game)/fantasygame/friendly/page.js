"use client";

/*
 * /fantasygame/friendly — pick two imported clubs and simulate a one-off match, then
 * jump to the replay. The M2 proof slice end to end: choose teams → POST
 * /api/game/friendly → watch the generated match in the shared animation.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function FriendlyPage() {
  const router = useRouter();
  const [clubs, setClubs] = useState([]);
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [hint, setHint] = useState("loading clubs…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/game/clubs");
        const j = await r.json();
        const cs = Array.isArray(j.clubs) ? j.clubs : [];
        setClubs(cs);
        if (cs.length >= 2) { setHome(cs[0].id); setAway(cs[1].id); setHint(cs.length + " clubs"); }
        else setHint(cs.length ? "need at least 2 clubs — seed more in admin" : "no clubs yet — seed squads in /admin/game-seed");
      } catch (e) { setHint(String(e.message || e)); }
    })();
  }, []);

  const play = async () => {
    if (busy || !home || !away || home === away) { setHint("pick two different clubs"); return; }
    setBusy(true); setHint("simulating…");
    try {
      const r = await fetch("/api/game/friendly", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeClubId: home, awayClubId: away }),
      });
      const j = await r.json();
      if (j && j.resultId) router.push("/fantasygame/match/" + j.resultId);
      else { setHint((j && j.error) || "error"); setBusy(false); }
    } catch (e) { setHint(String(e.message || e)); setBusy(false); }
  };

  const opts = (sel) => clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>);

  return (
    <div className="game-card feature">
      <h1>⚽ Friendly match</h1>
      <p className="game-sub">Pick two clubs and watch a simulated match play out in the live pitch animation.</p>

      <div className="game-versus">
        <label className="game-field">
          <span className="game-label">Home</span>
          <select className="game-select" value={home} onChange={(e) => setHome(e.target.value)}>{opts()}</select>
        </label>
        <span className="vs">vs</span>
        <label className="game-field">
          <span className="game-label">Away</span>
          <select className="game-select" value={away} onChange={(e) => setAway(e.target.value)}>{opts()}</select>
        </label>
      </div>

      <div className="game-actions" style={{ marginTop: 16, alignItems: "center" }}>
        <button className="game-btn" onClick={play} disabled={busy || clubs.length < 2}>
          {busy ? "Simulating…" : "▶ Kick off"}
        </button>
        <span className="game-hint">{hint}</span>
      </div>
    </div>
  );
}
