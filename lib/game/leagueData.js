/*
 * leagueData.js — read helpers for the league + fixtures pages (server-side).
 * Joins standings/fixtures to club names and result scores so the pages stay
 * thin. Standings are sorted by the usual tiebreakers (points, GD, GF).
 */

import { leagues, leagueMembership, clubs, fixtures, matchResults } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function listActiveLeagues(db) {
  return db.select({ id: leagues.id, name: leagues.name, tier: leagues.tier, status: leagues.status })
    .from(leagues).where(eq(leagues.status, "active")).orderBy(asc(leagues.tier), asc(leagues.name));
}

export async function getLeague(db, leagueId) {
  const rows = await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  return rows[0] || null;
}

// Standings rows with club name, sorted points → goal difference → goals for.
export async function getStandings(db, leagueId) {
  const rows = await db
    .select({
      clubId: leagueMembership.clubId, name: clubs.name,
      played: leagueMembership.played, won: leagueMembership.won, drawn: leagueMembership.drawn,
      lost: leagueMembership.lost, gf: leagueMembership.gf, ga: leagueMembership.ga, points: leagueMembership.points,
    })
    .from(leagueMembership)
    .leftJoin(clubs, eq(clubs.id, leagueMembership.clubId))
    .where(eq(leagueMembership.leagueId, leagueId));
  return rows.sort((a, b) =>
    b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || String(a.name).localeCompare(b.name));
}

// Fixtures with both club names and (when simulated) the result score + id.
export async function getFixtures(db, leagueId) {
  const home = clubs;
  const rows = await db
    .select({
      id: fixtures.id, round: fixtures.round, status: fixtures.status,
      scheduledAt: fixtures.scheduledAt, resultId: fixtures.resultId,
      homeId: fixtures.homeClubId, awayId: fixtures.awayClubId,
      homeScore: matchResults.homeScore, awayScore: matchResults.awayScore,
    })
    .from(fixtures)
    .leftJoin(matchResults, eq(matchResults.id, fixtures.resultId))
    .where(eq(fixtures.leagueId, leagueId))
    .orderBy(asc(fixtures.round));

  // Resolve club names in one pass.
  const ids = new Set();
  rows.forEach((r) => { ids.add(r.homeId); ids.add(r.awayId); });
  const nameRows = await db.select({ id: clubs.id, name: clubs.name }).from(clubs);
  const nameOf = {};
  nameRows.forEach((c) => { nameOf[c.id] = c.name; });
  return rows.map((r) => ({ ...r, homeName: nameOf[r.homeId] || "—", awayName: nameOf[r.awayId] || "—" }));
}
