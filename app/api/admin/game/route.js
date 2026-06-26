/*
 * /api/admin/game — consolidated game admin (Basic-Auth gated).
 *
 *   GET  -> overview: counts of managers/clubs/leagues/players, last sim time,
 *           configured sources, plus manager + league lists for the console.
 *   POST { action, ... } -> management operations:
 *     release-club   { clubId }            back to AI, clear its owner's club
 *     reset-manager  { managerId }         clear a manager's club (releases it)
 *     set-budget     { managerId, amount } set a manager's cash
 *     delete-league  { leagueId }          delete a league (+ its fixtures/results)
 *     sim-round      { leagueId, round }    force-sim one round
 *     wipe           { confirm:"WIPE" }     delete ALL game data (clean reset)
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db } from "@/lib/db/client";
import {
  managers, clubs, players, leagues, leagueMembership, fixtures, matchResults,
  transfers, finances, challenges, snapshots,
} from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { simulateFixture } from "@/lib/game/runFixture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });
const deny = () => json({ error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" }, 401);

async function count(table, where) {
  const q = db.select({ n: sql`count(*)`.mapWith(Number) }).from(table);
  const rows = where ? await q.where(where) : await q;
  return rows[0] ? rows[0].n : 0;
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  const [mgrs, clubsTotal, clubsClaimed, players_, leaguesActive, leaguesAll] = await Promise.all([
    count(managers), count(clubs), count(clubs, eq(clubs.isAi, false)), count(players),
    count(leagues, eq(leagues.status, "active")), count(leagues),
  ]);
  const lastSim = (await db.select({ t: matchResults.createdAt }).from(matchResults).orderBy(sql`${matchResults.createdAt} desc`).limit(1))[0];

  const managerList = await db
    .select({ id: managers.id, name: managers.displayName, clubId: managers.clubId, cash: managers.cashBalance, clubName: clubs.name })
    .from(managers).leftJoin(clubs, eq(clubs.id, managers.clubId)).orderBy(managers.createdAt).limit(100);

  const leagueList = await db
    .select({ id: leagues.id, name: leagues.name, tier: leagues.tier, status: leagues.status, season: leagues.seasonLabel,
      clubCount: sql`count(distinct ${leagueMembership.clubId})`.mapWith(Number),
      played: sql`count(distinct case when ${fixtures.status} = 'simulated' then ${fixtures.id} end)`.mapWith(Number),
      fixtures: sql`count(distinct ${fixtures.id})`.mapWith(Number) })
    .from(leagues)
    .leftJoin(leagueMembership, eq(leagueMembership.leagueId, leagues.id))
    .leftJoin(fixtures, eq(fixtures.leagueId, leagues.id))
    .groupBy(leagues.id).orderBy(leagues.tier);

  return json({
    overview: {
      managers: mgrs, clubsTotal, clubsClaimed, clubsFree: clubsTotal - clubsClaimed,
      players: players_, leaguesActive, leaguesAll,
      lastSim: lastSim ? lastSim.t : null,
      sources: {
        fotmob: process.env.FOTMOB_DISABLED !== "1",
        footballdata: !!process.env.FOOTBALL_DATA_TOKEN,
        thesportsdb: true,
      },
    },
    managers: managerList,
    leagues: leagueList,
  });
}

async function releaseClubById(clubId) {
  const c = (await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1))[0];
  if (!c) return;
  if (c.ownerManagerId) await db.update(managers).set({ clubId: null }).where(eq(managers.id, c.ownerManagerId));
  await db.update(clubs).set({ ownerManagerId: null, isAi: true }).where(eq(clubs.id, clubId));
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const action = body.action;

  try {
    if (action === "release-club") {
      if (!body.clubId) return json({ error: "clubId required" }, 400);
      await releaseClubById(body.clubId);
      return json({ ok: true });
    }

    if (action === "reset-manager") {
      if (!body.managerId) return json({ error: "managerId required" }, 400);
      const m = (await db.select().from(managers).where(eq(managers.id, body.managerId)).limit(1))[0];
      if (m && m.clubId) await releaseClubById(m.clubId);
      await db.update(managers).set({ clubId: null }).where(eq(managers.id, body.managerId));
      return json({ ok: true });
    }

    if (action === "set-budget") {
      if (!body.managerId) return json({ error: "managerId required" }, 400);
      const amount = Math.max(0, Math.round(Number(body.amount) || 0));
      await db.update(managers).set({ cashBalance: amount }).where(eq(managers.id, body.managerId));
      return json({ ok: true, amount });
    }

    if (action === "delete-league") {
      if (!body.leagueId) return json({ error: "leagueId required" }, 400);
      // fixtures + membership cascade off the league FK; results cascade off fixtures.
      await db.delete(leagues).where(eq(leagues.id, body.leagueId));
      return json({ ok: true });
    }

    if (action === "sim-round") {
      if (!body.leagueId || !body.round) return json({ error: "leagueId + round required" }, 400);
      const due = await db.select().from(fixtures)
        .where(and(eq(fixtures.leagueId, body.leagueId), eq(fixtures.round, Number(body.round)), eq(fixtures.status, "scheduled")));
      let simulated = 0;
      for (const fx of due) { const r = await simulateFixture(db, fx); if (r.resultId) simulated++; }
      return json({ ok: true, simulated, considered: due.length });
    }

    if (action === "wipe") {
      if (body.confirm !== "WIPE") return json({ error: 'type WIPE to confirm' }, 400);
      // Children → parents. Most have ON DELETE cascade, but delete explicitly
      // so order never matters.
      await db.delete(challenges);
      await db.delete(transfers);
      await db.delete(finances);
      await db.delete(matchResults);
      await db.delete(fixtures);
      await db.delete(leagueMembership);
      await db.delete(leagues);
      await db.delete(players);
      await db.delete(clubs);
      await db.delete(snapshots);
      await db.update(managers).set({ clubId: null, cashBalance: 0 });
      return json({ ok: true, wiped: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
