"use client";

// Squad seeding admin — imports real PT/UK clubs + squads into the game DB via
// /api/admin/seed-squads (Basic-Auth, so calls carry admin creds automatically).
// Pick an allowed league, Import, and watch the per-club summary.

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

export default function GameSeedPage() {
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState("");
  const [limit, setLimit] = useState(24);
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const j = await asJson(await fetch("/api/admin/seed-squads"));
        const ls = Array.isArray(j.leagues) ? j.leagues : [];
        setLeagues(ls);
        setLeagueId(ls.length ? String(ls[0].id) : "");
        setHint(j.dbConfigured ? "ready" : "⚠️ DATABASE_URL not configured — imports will fail");
      } catch (e) { setHint(String(e.message || e)); }
    })();
  }, []);

  const run = async () => {
    if (!leagueId || busy) return;
    setBusy(true); setResult(null); setHint("importing… (fetching squads from FotMob, can take ~30s)");
    try {
      const j = await asJson(await fetch("/api/admin/seed-squads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leagueId: Number(leagueId), limit: Number(limit) }),
      }));
      setResult(j);
      setHint(j && j.ok ? `done ✓ ${j.clubsImported} club(s) imported` : (j && j.error) || "error");
    } catch (e) { setHint(String(e.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="sub">Import real clubs &amp; squads (Portugal &amp; UK only) into the manager game.</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🌱 Seed squads</div>
        <div className="row">
          <div>
            <label>League</label>
            <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)}>
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>{l.country} · {l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Max clubs</label>
            <input type="number" min="1" max="30" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>
        <div className="toolbar">
          <button onClick={run} disabled={busy}>{busy ? "Importing…" : "Import"}</button>
          <span className="pill">{hint}</span>
        </div>
      </div>

      {result && Array.isArray(result.summary) ? (
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {result.league ? `${result.league.country} · ${result.league.name}` : "Result"}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <tbody>
              {result.summary.map((s, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "4px 0" }}>{s.club}</td>
                  <td style={{ textAlign: "right", color: "var(--muted)" }}>
                    {s.players != null
                      ? `${s.players} players${s.derivedRatings ? ` · ${s.derivedRatings} derived` : ""}`
                      : (s.skipped || s.error || "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
