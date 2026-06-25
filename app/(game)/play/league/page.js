/*
 * /play/league — the standings table for an active league. Picks the league
 * from ?league=<id> or the first active one. Auth-gated; flag-gated by layout.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { listActiveLeagues, getLeague, getStandings } from "@/lib/game/leagueData";

export const dynamic = "force-dynamic";

export default async function LeaguePage({ searchParams }) {
  const session = await auth();
  if (!session || !session.user) redirect("/login");

  if (!db) return <div className="game-card"><p className="game-sub">Database not configured.</p></div>;

  const active = await listActiveLeagues(db);
  if (!active.length) {
    return (
      <div className="game-card">
        <h1>League</h1>
        <p className="game-sub">No active league yet. An admin can create one from imported squads in <code>/admin/game-league</code>.</p>
      </div>
    );
  }

  const sp = (await searchParams) || {};
  const leagueId = active.find((l) => l.id === sp.league) ? sp.league : active[0].id;
  const league = await getLeague(db, leagueId);
  const table = await getStandings(db, leagueId);
  const relegation = league.relegationSlots || 0;

  return (
    <div className="game-card">
      <h1>{league.name}</h1>
      {active.length > 1 ? (
        <p className="game-sub">
          {active.map((l) => (
            <a key={l.id} href={`/play/league?league=${l.id}`} style={{ marginRight: 12, color: l.id === leagueId ? "var(--text)" : "var(--muted)" }}>{l.name}</a>
          ))}
        </p>
      ) : null}
      <table className="game-table">
        <thead>
          <tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
        </thead>
        <tbody>
          {table.map((r, i) => {
            const dropping = relegation && i >= table.length - relegation;
            return (
              <tr key={r.clubId} style={dropping ? { color: "#e8867e" } : undefined}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.played}</td><td>{r.won}</td><td>{r.drawn}</td><td>{r.lost}</td>
                <td>{r.gf}</td><td>{r.ga}</td><td>{r.gf - r.ga}</td>
                <td><b>{r.points}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="game-note">
        <a href={`/play/fixtures?league=${leagueId}`} className="game-btn secondary">View fixtures →</a>
      </p>
    </div>
  );
}
