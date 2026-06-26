/*
 * runFixture.js — simulate ONE scheduled fixture and persist everything: freeze
 * a match_results row, mark the fixture simulated, and update both clubs'
 * standings. Shared by the cron tick and the admin "advance" action so the
 * season logic lives in one place.
 *
 * Uses the fixture's frozen `seed`, so a result is reproducible. Standings are
 * materialized incrementally into league_membership (read both rows, add the
 * deltas, write back) — no full recompute per fixture.
 */

import { clubs, players as playersTbl, fixtures, matchResults, leagueMembership } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { autoLineup } from "@/lib/game/lineup";
import { simulateMatch, SIM_VERSION } from "@/lib/game/simMatch";
import { recordFinance, adjustWallet, GATE_RECEIPT, WIN_BONUS, DRAW_BONUS } from "@/lib/game/economy";

// Credit gate + result money to a club when a human manages it.
async function payClub(db, club, gf, ga, fixtureId) {
  if (!club || !club.ownerManagerId) return;
  const bonus = gf > ga ? WIN_BONUS : gf === ga ? DRAW_BONUS : 0;
  await adjustWallet(db, club.ownerManagerId, GATE_RECEIPT + bonus);
  await recordFinance(db, { clubId: club.id, type: "gate", amount: GATE_RECEIPT, fixtureId });
  if (bonus) await recordFinance(db, { clubId: club.id, type: "prize", amount: bonus, fixtureId });
}

async function loadClub(db, id) {
  const c = await db.select().from(clubs).where(eq(clubs.id, id)).limit(1);
  if (!c[0]) return null;
  const ps = await db.select().from(playersTbl).where(eq(playersTbl.clubId, id));
  return { club: c[0], players: ps };
}

function resultDelta(gf, ga) {
  const won = gf > ga ? 1 : 0, drawn = gf === ga ? 1 : 0, lost = gf < ga ? 1 : 0;
  return { played: 1, won, drawn, lost, gf, ga, points: won * 3 + drawn };
}

async function bumpStanding(db, leagueId, clubId, d) {
  const rows = await db.select().from(leagueMembership)
    .where(and(eq(leagueMembership.leagueId, leagueId), eq(leagueMembership.clubId, clubId))).limit(1);
  const m = rows[0];
  if (!m) return;
  await db.update(leagueMembership).set({
    played: m.played + d.played, won: m.won + d.won, drawn: m.drawn + d.drawn,
    lost: m.lost + d.lost, gf: m.gf + d.gf, ga: m.ga + d.ga, points: m.points + d.points,
  }).where(eq(leagueMembership.id, m.id));
}

// Simulate `fixture` (a fixtures row) and persist. Returns { resultId, score }
// or { skipped }. Never throws to the caller's loop — errors are returned.
export async function simulateFixture(db, fixture) {
  try {
    if (!fixture || fixture.status === "simulated") return { skipped: "already simulated" };
    const home = await loadClub(db, fixture.homeClubId);
    const away = await loadClub(db, fixture.awayClubId);
    if (!home || !away || !home.players.length || !away.players.length) {
      return { skipped: "missing club/players" };
    }

    const hl = autoLineup(home.club, home.players);
    const al = autoLineup(away.club, away.players);
    const seed = (Number(fixture.seed) || 1) >>> 0;
    const sim = simulateMatch({ home: hl, away: al, seed });

    const ins = await db.insert(matchResults).values({
      fixtureId: fixture.id,
      homeScore: sim.score.home,
      awayScore: sim.score.away,
      eventsJson: sim.events,
      statsJson: sim.stats,
      metaJson: { home: sim.homeLineup, away: sim.awayLineup, seed, kind: "league" },
      simVersion: SIM_VERSION,
    }).returning({ id: matchResults.id });
    const resultId = ins[0] && ins[0].id;

    await db.update(fixtures).set({ status: "simulated", resultId }).where(eq(fixtures.id, fixture.id));

    if (fixture.leagueId) {
      await bumpStanding(db, fixture.leagueId, fixture.homeClubId, resultDelta(sim.score.home, sim.score.away));
      await bumpStanding(db, fixture.leagueId, fixture.awayClubId, resultDelta(sim.score.away, sim.score.home));
    }
    // Match-day income for any human-managed club in this fixture.
    await payClub(db, home.club, sim.score.home, sim.score.away, fixture.id);
    await payClub(db, away.club, sim.score.away, sim.score.home, fixture.id);
    return { resultId, score: sim.score };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
