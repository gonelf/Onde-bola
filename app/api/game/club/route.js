/*
 * /api/game/club — the manager's club.
 *   GET  -> { manager, club, squad }      (club/squad null until one is claimed)
 *   POST { clubId } -> claim an unowned club, seed the starting budget.
 *
 * Auth-gated (requireManager) + flag-gated (`game`).
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { managers, clubs, players } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { STARTING_CASH } from "@/lib/game/economy";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

async function squadOf(clubId) {
  return db.select().from(players).where(eq(players.clubId, clubId)).orderBy(asc(players.position));
}

export async function GET() {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;

  let club = null, squad = [];
  if (manager.clubId) {
    const c = await db.select().from(clubs).where(eq(clubs.id, manager.clubId)).limit(1);
    club = c[0] || null;
    if (club) squad = await squadOf(club.id);
  }
  return json({ manager, club, squad });
}

export async function POST(request) {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (manager.clubId) return json({ error: "you already manage a club" }, 409);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const clubId = body.clubId;
  if (!clubId) return json({ error: "clubId required" }, 400);

  const c = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  const club = c[0];
  if (!club) return json({ error: "club not found" }, 404);
  if (club.ownerManagerId) return json({ error: "club already taken" }, 409);

  try {
    // Claim atomically-ish: only update if still unowned.
    const upd = await db.update(clubs)
      .set({ ownerManagerId: manager.id, isAi: false })
      .where(and(eq(clubs.id, clubId), eq(clubs.isAi, true)))
      .returning({ id: clubs.id });
    if (!upd[0]) return json({ error: "club already taken" }, 409);

    await db.update(managers)
      .set({ clubId, cashBalance: manager.cashBalance && manager.cashBalance > 0 ? manager.cashBalance : STARTING_CASH })
      .where(eq(managers.id, manager.id));
  } catch (e) {
    return json({ error: "claim failed: " + String((e && e.message) || e) }, 500);
  }

  const squad = await squadOf(clubId);
  return json({ ok: true, clubId, squad: squad.length });
}
