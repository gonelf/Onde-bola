/*
 * /fantasygame/fixtures — the schedule + results for an active league, grouped by
 * round. Simulated fixtures show the score and link to the replay; scheduled
 * ones show their kickoff day. Auth-gated; flag-gated by layout.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { listActiveLeagues, getLeague, getFixtures } from "@/lib/game/leagueData";

export const dynamic = "force-dynamic";

function dayLabel(d) {
  try { return new Date(d).toISOString().slice(5, 10).replace("-", "/"); } catch (e) { return ""; }
}

export default async function FixturesPage({ searchParams }) {
  const session = await auth();
  if (!session || !session.user) redirect("/login");
  if (!db) return <div className="game-card"><p className="game-sub">Database not configured.</p></div>;

  const active = await listActiveLeagues(db);
  if (!active.length) {
    return <div className="game-card"><h1>Fixtures</h1><p className="game-sub">No active league yet.</p></div>;
  }

  const sp = (await searchParams) || {};
  const leagueId = active.find((l) => l.id === sp.league) ? sp.league : active[0].id;
  const league = await getLeague(db, leagueId);
  const fixtures = await getFixtures(db, leagueId);

  // Group by round.
  const rounds = {};
  fixtures.forEach((f) => { (rounds[f.round] = rounds[f.round] || []).push(f); });
  const roundNums = Object.keys(rounds).map(Number).sort((a, b) => a - b);

  return (
    <div className="game-card">
      <h1>{league.name} · Fixtures</h1>
      <div className="game-actions" style={{ marginBottom: 8 }}>
        <a href={`/fantasygame/league?league=${leagueId}`} className="game-btn secondary sm">← Table</a>
      </div>
      {roundNums.map((rn) => (
        <div key={rn}>
          <div className="game-round">Round {rn}</div>
          {rounds[rn].map((f) => (
            <div className="game-fixture" key={f.id}>
              <span className="fx-home">{f.homeName}</span>
              {f.status === "simulated" && f.resultId ? (
                <a className="fx-score" href={`/fantasygame/match/${f.resultId}`}>{f.homeScore}–{f.awayScore}</a>
              ) : (
                <span className="fx-sched">{dayLabel(f.scheduledAt)}</span>
              )}
              <span className="fx-away">{f.awayName}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
