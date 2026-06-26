"use client";

/*
 * /fantasygame/challenge — async PvP. Pick an opponent club, simulate instantly,
 * jump to the replay. Past challenges list with scores + replay links.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChallengePage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [opp, setOpp] = useState("");
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const j = await (await fetch("/api/game/challenge")).json();
      if (j.error) { setHint(j.error); setData({ opponents: [], history: [] }); return; }
      setData(j);
      if (j.opponents && j.opponents.length) setOpp(j.opponents[0].clubId);
      setHint(`${(j.opponents || []).length} clubs to challenge`);
    } catch (e) { setHint(String(e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const play = async () => {
    if (!opp || busy) return;
    setBusy(true); setHint("simulating…");
    try {
      const j = await (await fetch("/api/game/challenge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opponentClubId: opp }),
      })).json();
      if (j && j.resultId) router.push("/fantasygame/match/" + j.resultId);
      else { setHint((j && j.error) || "error"); setBusy(false); }
    } catch (e) { setHint(String(e.message || e)); setBusy(false); }
  };

  if (!data) return <div className="game-card"><h1>Challenge</h1><p className="game-sub">{hint}</p></div>;
  if (!data.opponents) return <div className="game-card"><h1>Challenge</h1><p className="game-sub">{hint}</p><a className="game-btn" href="/fantasygame">Dashboard</a></div>;

  return (
    <>
      <div className="game-card">
        <h1>Challenge a club</h1>
        <p className="game-sub">Play an instant match against any club. {hint}</p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={opp} onChange={(e) => setOpp(e.target.value)}
            style={{ padding: "8px 10px", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, minWidth: 220 }}>
            {data.opponents.map((o) => <option key={o.clubId} value={o.clubId}>{o.name}{o.human ? " (human)" : ""}</option>)}
          </select>
          <button className="game-btn" onClick={play} disabled={busy || !data.opponents.length}>{busy ? "Simulating…" : "⚔ Challenge"}</button>
        </div>
      </div>

      {data.history && data.history.length ? (
        <div className="game-card">
          <h2>Recent challenges</h2>
          <table className="game-table">
            <thead><tr><th>Date</th><th>Result</th><th></th></tr></thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td style={{ color: "var(--muted)" }}>{h.createdAt ? new Date(h.createdAt).toISOString().slice(0, 10) : ""}</td>
                  <td>{h.meta && h.meta.home ? h.meta.home.name : "You"} {h.homeScore}–{h.awayScore} {h.meta && h.meta.away ? h.meta.away.name : ""}</td>
                  <td>{h.resultId ? <a className="game-btn secondary" style={{ padding: "4px 10px" }} href={`/fantasygame/match/${h.resultId}`}>Watch</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
