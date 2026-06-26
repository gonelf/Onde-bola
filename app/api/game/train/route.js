/*
 * /api/game/train — spend cash to improve one of your players by +1 rating.
 * Cost scales steeply with the player's current rating (and is capped), so it's
 * a money sink, not a free ramp. Auth + flag gated; the player must belong to
 * the manager's club.
 *
 *   POST { playerId } -> { ok, rating, cost, cash }
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { players, managers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { recordFinance, adjustWallet } from "@/lib/game/economy";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

const RATING_CAP = 90;
// Cost to go from r → r+1: cheap at the bottom, very expensive near the cap.
function trainCost(r) {
  return Math.round(50_000 * Math.pow(1.18, Math.max(0, r - 50)));
}

export async function POST(request) {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const playerId = body.playerId;
  if (!playerId) return json({ error: "playerId required" }, 400);

  const pr = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const player = pr[0];
  if (!player || player.clubId !== manager.clubId) return json({ error: "not your player" }, 403);
  if (player.rating >= RATING_CAP) return json({ error: `already at the training cap (${RATING_CAP})` }, 409);

  const cost = trainCost(player.rating);
  if ((manager.cashBalance || 0) < cost) return json({ error: "not enough budget", cost }, 402);

  try {
    const nextRating = player.rating + 1;
    await db.update(players).set({ rating: nextRating }).where(eq(players.id, playerId));
    const cash = await adjustWallet(db, manager.id, -cost);
    await recordFinance(db, { clubId: manager.clubId, type: "training", amount: -cost });
    return json({ ok: true, rating: nextRating, cost, cash });
  } catch (e) {
    return json({ error: "train failed: " + String((e && e.message) || e) }, 500);
  }
}
