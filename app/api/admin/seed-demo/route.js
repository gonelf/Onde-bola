/*
 * /api/admin/seed-demo — one-click, FotMob-free demo. Generates a fictional
 * PT/UK league (clubs + squads), creates the league + a full double round-robin,
 * simulates the ENTIRE season, and writes standings — so /fantasygame shows a
 * finished table and watchable matches immediately. Basic-Auth gated.
 *
 * Built for reliability where FotMob is blocked (e.g. Vercel IPs): no external
 * calls. Simulation is done in-memory (standings accumulated, then written) to
 * keep round-trips low and finish within maxDuration.
 *
 *   POST { clubs?, reset? } -> { ok, leagueId, clubs, fixtures }
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db } from "@/lib/db/client";
import {
  snapshots, clubs as clubsTbl, players as playersTbl, leagues, leagueMembership,
  fixtures as fixturesTbl, matchResults,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { buildDemoLeague } from "@/lib/game/demoData";
import { buildFixtures } from "@/lib/game/schedule";
import { autoLineup } from "@/lib/game/lineup";
import { simulateMatch, SIM_VERSION } from "@/lib/game/simMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });
const deny = () => json({ error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" }, 401);

function delta(gf, ga) {
  const won = gf > ga ? 1 : 0, drawn = gf === ga ? 1 : 0, lost = gf < ga ? 1 : 0;
  return { played: 1, won, drawn, lost, gf, ga, points: won * 3 + drawn };
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const demo = buildDemoLeague(parseInt(body.clubs, 10) || 8);

  try {
    // 1. Snapshot.
    const snap = (await db.insert(snapshots).values({
      source: "demo", seasonLabel: demo.seasonLabel, notes: `${demo.clubs.length} fictional clubs`,
    }).returning())[0];

    // 2. Clubs (bulk) → map name → id.
    const clubRows = await db.insert(clubsTbl).values(demo.clubs.map((c) => ({
      name: c.name, shortName: c.shortName, kitColor: c.kitColor, baseFormation: c.baseFormation,
      crestUrl: null, isAi: true, snapshotId: snap.id,
    }))).returning({ id: clubsTbl.id, name: clubsTbl.name });
    const idByName = {};
    clubRows.forEach((r) => { idByName[r.name] = r.id; });

    // 3. Players (bulk) + keep an in-memory lineup per club.
    const playerValues = [];
    const lineupByClub = {};
    demo.clubs.forEach((c) => {
      const clubId = idByName[c.name];
      c.players.forEach((p) => playerValues.push({
        clubId, snapshotId: snap.id, name: p.name, shortName: p.shortName,
        position: p.position, rating: p.rating, age: p.age, marketValue: p.marketValue, derived: false,
      }));
      lineupByClub[clubId] = autoLineup(
        { name: c.name, baseFormation: c.baseFormation, kitColor: c.kitColor },
        c.players
      );
    });
    for (let i = 0; i < playerValues.length; i += 200) {
      await db.insert(playersTbl).values(playerValues.slice(i, i + 200));
    }

    // 4. League + zeroed standings.
    const league = (await db.insert(leagues).values({
      name: demo.seasonLabel, tier: 1, seasonLabel: demo.seasonLabel, status: "active", relegationSlots: 3,
    }).returning())[0];
    const clubIds = clubRows.map((r) => r.id);
    await db.insert(leagueMembership).values(clubIds.map((clubId) => ({ leagueId: league.id, clubId })));

    // 5. Fixtures (kickoffs in the past so they read as played).
    const start = Date.now() - clubIds.length * 2 * 86400000;
    const fxRows = buildFixtures(league.id, clubIds, { startAtMs: start, intervalMs: 86400000 });
    const inserted = [];
    for (let i = 0; i < fxRows.length; i += 200) {
      const r = await db.insert(fixturesTbl).values(fxRows.slice(i, i + 200))
        .returning({ id: fixturesTbl.id, homeClubId: fixturesTbl.homeClubId, awayClubId: fixturesTbl.awayClubId, seed: fixturesTbl.seed });
      inserted.push(...r);
    }

    // 6. Simulate the whole season in memory.
    const standings = {};
    clubIds.forEach((id) => { standings[id] = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }; });
    const resultValues = [];
    inserted.forEach((fx) => {
      const sim = simulateMatch({ home: lineupByClub[fx.homeClubId], away: lineupByClub[fx.awayClubId], seed: (Number(fx.seed) || 1) >>> 0 });
      resultValues.push({
        fixtureId: fx.id, homeScore: sim.score.home, awayScore: sim.score.away,
        eventsJson: sim.events, statsJson: sim.stats,
        metaJson: { home: sim.homeLineup, away: sim.awayLineup, seed: fx.seed, kind: "league" },
        simVersion: SIM_VERSION,
      });
      const dh = delta(sim.score.home, sim.score.away), da = delta(sim.score.away, sim.score.home);
      accumulate(standings[fx.homeClubId], dh);
      accumulate(standings[fx.awayClubId], da);
    });

    // 7. Persist results, link fixtures, write standings.
    const resultIdByFixture = {};
    for (let i = 0; i < resultValues.length; i += 100) {
      const r = await db.insert(matchResults).values(resultValues.slice(i, i + 100))
        .returning({ id: matchResults.id, fixtureId: matchResults.fixtureId });
      r.forEach((row) => { resultIdByFixture[row.fixtureId] = row.id; });
    }
    for (const fx of inserted) {
      await db.update(fixturesTbl).set({ status: "simulated", resultId: resultIdByFixture[fx.id] })
        .where(eq(fixturesTbl.id, fx.id));
    }
    for (const clubId of clubIds) {
      await db.update(leagueMembership).set(standings[clubId])
        .where(and(eq(leagueMembership.leagueId, league.id), eq(leagueMembership.clubId, clubId)));
    }

    return json({ ok: true, leagueId: league.id, clubs: clubIds.length, fixtures: inserted.length });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

function accumulate(s, d) {
  s.played += d.played; s.won += d.won; s.drawn += d.drawn; s.lost += d.lost;
  s.gf += d.gf; s.ga += d.ga; s.points += d.points;
}
