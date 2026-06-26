/*
 * season.js — end-of-season rollover with promotion/relegation.
 *
 * When a league's fixtures are all simulated, rollOver() starts a fresh season:
 *   • If a lower-tier active league exists, swap the upper league's bottom
 *     `relegationSlots` clubs with the lower league's top `promotionSlots` —
 *     promotion & relegation.
 *   • Reset standings, drop the old fixtures (their results cascade away), and
 *     regenerate a new double round-robin for each affected league.
 *   • Bump the season label.
 * With no paired league it's just a fresh season for the one league (no swap).
 *
 * Pure DB orchestration; safe to call from an admin action or a cron.
 */

import { leagues, leagueMembership, fixtures } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getStandings } from "@/lib/game/leagueData";
import { buildFixtures } from "@/lib/game/schedule";

export async function seasonComplete(db, leagueId) {
  const rows = await db.select({ status: fixtures.status }).from(fixtures).where(eq(fixtures.leagueId, leagueId));
  if (!rows.length) return false;
  return rows.every((r) => r.status === "simulated");
}

function nextLabel(label) {
  const m = String(label || "").match(/season\s*(\d+)/i);
  if (m) return label.replace(/season\s*\d+/i, "Season " + (parseInt(m[1], 10) + 1));
  return (label ? label + " · " : "") + "Season 2";
}

async function clubIdsOf(db, leagueId) {
  const rows = await db.select({ clubId: leagueMembership.clubId }).from(leagueMembership).where(eq(leagueMembership.leagueId, leagueId));
  return rows.map((r) => r.clubId);
}

async function resetAndSchedule(db, leagueId, intervalMs) {
  // Reset standings.
  await db.update(leagueMembership).set({ played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 })
    .where(eq(leagueMembership.leagueId, leagueId));
  // Drop old fixtures (match_results cascade off the fixtures FK).
  await db.delete(fixtures).where(eq(fixtures.leagueId, leagueId));
  // New fixtures.
  const clubIds = await clubIdsOf(db, leagueId);
  if (clubIds.length >= 2) {
    const rows = buildFixtures(leagueId, clubIds, { startAtMs: Date.now(), intervalMs });
    for (let i = 0; i < rows.length; i += 200) await db.insert(fixtures).values(rows.slice(i, i + 200));
    return rows.length;
  }
  return 0;
}

// Move a set of clubs from one league to another (membership only).
async function moveClubs(db, clubIds, fromLeagueId, toLeagueId) {
  if (!clubIds.length) return;
  await db.update(leagueMembership).set({ leagueId: toLeagueId })
    .where(and(eq(leagueMembership.leagueId, fromLeagueId), inArray(leagueMembership.clubId, clubIds)));
}

/*
 * rollOver(db, leagueId, { intervalMinutes }) — finish the season for `leagueId`
 * and start a new one (with promotion/relegation if a lower-tier league exists).
 * Returns a summary { promoted, relegated, leagues:[{id,fixtures}] }.
 */
export async function rollOver(db, leagueId, { intervalMinutes = 1440 } = {}) {
  const lg = (await db.select().from(leagues).where(eq(leagues.id, leagueId)).limit(1))[0];
  if (!lg) return { error: "league not found" };
  if (!(await seasonComplete(db, leagueId))) return { error: "season not complete (simulate all fixtures first)" };

  const intervalMs = Math.max(1, intervalMinutes) * 60000;

  // Find a paired lower-tier active league.
  const lower = (await db.select().from(leagues)
    .where(and(eq(leagues.tier, (lg.tier || 1) + 1), eq(leagues.status, "active"))).limit(1))[0] || null;

  let promoted = [], relegated = [];
  if (lower) {
    const upTable = await getStandings(db, leagueId);   // sorted best→worst
    const loTable = await getStandings(db, lower.id);
    const rel = Math.min(lg.relegationSlots || 3, Math.max(0, upTable.length - 1));
    const pro = Math.min(lower.promotionSlots || rel, rel, Math.max(0, loTable.length - 1));
    relegated = upTable.slice(upTable.length - rel).map((r) => r.clubId);
    promoted = loTable.slice(0, pro).map((r) => r.clubId);

    await moveClubs(db, relegated, leagueId, lower.id);
    await moveClubs(db, promoted, lower.id, leagueId);
  }

  const label = nextLabel(lg.seasonLabel || lg.name);
  await db.update(leagues).set({ status: "active", seasonLabel: label }).where(eq(leagues.id, leagueId));
  const f1 = await resetAndSchedule(db, leagueId, intervalMs);
  const out = { promoted: promoted.length, relegated: relegated.length, leagues: [{ id: leagueId, fixtures: f1 }] };

  if (lower) {
    await db.update(leagues).set({ status: "active", seasonLabel: nextLabel(lower.seasonLabel || lower.name) }).where(eq(leagues.id, lower.id));
    const f2 = await resetAndSchedule(db, lower.id, intervalMs);
    out.leagues.push({ id: lower.id, fixtures: f2 });
  }
  return out;
}
