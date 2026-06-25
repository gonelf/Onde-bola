/*
 * /api/admin/league — create + inspect game leagues (Basic-Auth gated).
 *
 *   GET  -> { snapshots:[{id,seasonLabel,clubCount}], leagues:[{...,clubCount,
 *            fixtures,played}] }  for the admin league page.
 *   POST { snapshotId, intervalMinutes? } -> create an active league from the
 *          clubs imported under that snapshot: zeroed standings + a full double
 *          round-robin fixture list (one matchday per `intervalMinutes`,
 *          default a day), starting now.
 *
 * Scope stays PT/UK because snapshots only ever come from seed-squads, which is
 * allowlisted.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db } from "@/lib/db/client";
import { snapshots, clubs, leagues, leagueMembership, fixtures } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { leagueInfo, ALLOWED_LEAGUES } from "@/lib/game/fotmobSquad";
import { buildFixtures } from "@/lib/game/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });
const deny = () => json({ error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" }, 401);

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  const snaps = await db
    .select({ id: snapshots.id, seasonLabel: snapshots.seasonLabel, takenAt: snapshots.takenAt,
      clubCount: sql`count(${clubs.id})`.mapWith(Number) })
    .from(snapshots).leftJoin(clubs, eq(clubs.snapshotId, snapshots.id))
    .groupBy(snapshots.id).orderBy(snapshots.takenAt);

  const lgs = await db
    .select({ id: leagues.id, name: leagues.name, status: leagues.status, tier: leagues.tier,
      clubCount: sql`count(distinct ${leagueMembership.clubId})`.mapWith(Number) })
    .from(leagues).leftJoin(leagueMembership, eq(leagueMembership.leagueId, leagues.id))
    .groupBy(leagues.id).orderBy(leagues.createdAt);

  return json({ snapshots: snaps, leagues: lgs, allowed: ALLOWED_LEAGUES });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const snapshotId = body.snapshotId;
  if (!snapshotId) return json({ error: "snapshotId required" }, 400);
  const intervalMinutes = Math.max(1, Math.min(20160, parseInt(body.intervalMinutes, 10) || 1440));

  const snapRows = await db.select().from(snapshots).where(eq(snapshots.id, snapshotId)).limit(1);
  const snap = snapRows[0];
  if (!snap) return json({ error: "snapshot not found" }, 404);

  const clubRows = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.snapshotId, snapshotId));
  const clubIds = clubRows.map((c) => c.id);
  if (clubIds.length < 2) return json({ error: "snapshot has fewer than 2 clubs" }, 409);

  const info = ALLOWED_LEAGUES.find((l) => l.name === snap.seasonLabel);
  const tier = info ? info.tier : 1;

  // Create the league.
  const lg = await db.insert(leagues).values({
    name: snap.seasonLabel || "League", tier, seasonLabel: snap.seasonLabel,
    status: "active", relegationSlots: tier === 1 ? 3 : 0, promotionSlots: tier > 1 ? 3 : 0,
  }).returning();
  const leagueId = lg[0] && lg[0].id;
  if (!leagueId) return json({ error: "league insert failed" }, 500);

  // Zeroed standings.
  await db.insert(leagueMembership).values(clubIds.map((clubId) => ({ leagueId, clubId })));

  // Double round-robin fixtures.
  const rows = buildFixtures(leagueId, clubIds, {
    startAtMs: Date.now(), intervalMs: intervalMinutes * 60000,
  });
  // Insert in chunks to stay under statement limits.
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(fixtures).values(rows.slice(i, i + 200));
  }

  return json({ ok: true, leagueId, name: snap.seasonLabel, clubs: clubIds.length, fixtures: rows.length, rounds: (clubIds.length - 1) * 2 });
}
