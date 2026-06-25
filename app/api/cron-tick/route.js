/*
 * /api/cron-tick — the season heartbeat. Simulates fixtures that are due and
 * updates standings. Idempotent and batched: it processes only `scheduled`
 * fixtures whose kickoff has passed, up to a per-invocation cap, so repeated
 * ticks safely drain the backlog.
 *
 * Auth: CRON_SECRET (Authorization: Bearer <secret> or ?key=) like the other
 * crons, OR admin Basic Auth (so the admin league page can "advance" manually).
 * No-ops when the `game` flag is off, so a hidden mode is never simulated.
 *
 * Testing helpers: ?all=1 ignores kickoff time (sim everything still scheduled),
 * ?league=<id> limits to one league, ?max=<n> caps the batch.
 *
 * Env: CRON_SECRET. Add to vercel.json crons (daily on Hobby = one matchday/day).
 */

import { isEnabled } from "@/lib/flags";
import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db/client";
import { fixtures, leagues } from "@/lib/db/schema";
import { and, eq, lte, inArray } from "drizzle-orm";
import { simulateFixture } from "@/lib/game/runFixture";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET = process.env.CRON_SECRET || "";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

function authorized(request, key) {
  if (isAdmin(request)) return true;
  if (!SECRET) return true; // unset secret = open, matching the other crons
  const auth = request.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "") === SECRET || key === SECRET;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  if (!authorized(request, searchParams.get("key") || "")) return json({ ok: false, error: "unauthorized" }, 401);
  if (!(await isEnabled("game"))) return json({ ok: false, disabled: true });
  if (!db) return json({ ok: false, error: "DATABASE_URL not configured" }, 503);

  const all = searchParams.get("all") === "1";
  const leagueId = searchParams.get("league") || "";
  const max = Math.max(1, Math.min(200, parseInt(searchParams.get("max"), 10) || 100));

  // Only fixtures in active leagues.
  const active = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.status, "active"));
  const activeIds = active.map((l) => l.id);
  if (!activeIds.length) return json({ ok: true, simulated: 0, note: "no active leagues" });

  const conds = [eq(fixtures.status, "scheduled"), inArray(fixtures.leagueId, leagueId ? [leagueId] : activeIds)];
  if (!all) conds.push(lte(fixtures.scheduledAt, new Date()));

  let due = [];
  try {
    due = await db.select().from(fixtures).where(and(...conds)).orderBy(fixtures.scheduledAt).limit(max);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }

  let simulated = 0, skipped = 0, errors = 0;
  for (const fx of due) {
    const r = await simulateFixture(db, fx);
    if (r.resultId) simulated++;
    else if (r.error) errors++;
    else skipped++;
  }

  return json({ ok: true, considered: due.length, simulated, skipped, errors });
}
