/*
 * /api/game/transfers — the transfer market.
 *   GET  -> { cash, squadSize, market:[buyable], squad:[sellable] }
 *   POST { action:"buy"|"sell", playerId } -> moves the player + money, records
 *          a transfer + a finance ledger row.
 *
 * Buyable = free agents (no club) or players at AI clubs. Selling a player makes
 * them a free agent and returns SELL_FRACTION of their value. Squad bounds keep
 * it sane (min 11, max 30). Auth + flag gated.
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { players, clubs, transfers } from "@/lib/db/schema";
import { eq, or, isNull, desc, asc, and } from "drizzle-orm";
import { recordFinance, adjustWallet, SELL_FRACTION } from "@/lib/game/economy";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

const MIN_SQUAD = 11, MAX_SQUAD = 30;

async function squadSize(clubId) {
  const rows = await db.select({ id: players.id }).from(players).where(eq(players.clubId, clubId));
  return rows.length;
}

export async function GET() {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  // Buyable: free agents or AI-club players (not mine), best first.
  const market = await db
    .select({
      id: players.id, name: players.name, position: players.position, rating: players.rating,
      value: players.marketValue, age: players.age, clubId: players.clubId, clubName: clubs.name,
    })
    .from(players)
    .leftJoin(clubs, eq(clubs.id, players.clubId))
    .where(or(isNull(players.clubId), eq(clubs.isAi, true)))
    .orderBy(desc(players.rating))
    .limit(120);

  const squad = await db
    .select({ id: players.id, name: players.name, position: players.position, rating: players.rating, value: players.marketValue, age: players.age })
    .from(players).where(eq(players.clubId, manager.clubId)).orderBy(asc(players.position));

  return json({ cash: manager.cashBalance || 0, squadSize: squad.length, market, squad });
}

export async function POST(request) {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const { action, playerId } = body;
  if (!playerId || (action !== "buy" && action !== "sell")) return json({ error: "action (buy|sell) + playerId required" }, 400);

  const pr = await db.select().from(players).where(eq(players.id, playerId)).limit(1);
  const player = pr[0];
  if (!player) return json({ error: "player not found" }, 404);
  const size = await squadSize(manager.clubId);

  if (action === "buy") {
    if (player.clubId === manager.clubId) return json({ error: "already yours" }, 409);
    if (player.clubId) {
      const owner = await db.select({ isAi: clubs.isAi }).from(clubs).where(eq(clubs.id, player.clubId)).limit(1);
      if (!owner[0] || !owner[0].isAi) return json({ error: "player isn't available" }, 409);
    }
    if (size >= MAX_SQUAD) return json({ error: `squad full (max ${MAX_SQUAD})` }, 409);
    const fee = player.marketValue || 0;
    if ((manager.cashBalance || 0) < fee) return json({ error: "not enough budget", fee }, 402);
    try {
      const fromClubId = player.clubId || null;
      await db.update(players).set({ clubId: manager.clubId }).where(eq(players.id, playerId));
      const cash = await adjustWallet(db, manager.id, -fee);
      await db.insert(transfers).values({ playerId, fromClubId, toClubId: manager.clubId, fee, type: "buy" });
      await recordFinance(db, { clubId: manager.clubId, type: "transfer", amount: -fee });
      return json({ ok: true, action, fee, cash });
    } catch (e) { return json({ error: "buy failed: " + String((e && e.message) || e) }, 500); }
  }

  // sell
  if (player.clubId !== manager.clubId) return json({ error: "not your player" }, 403);
  if (size <= MIN_SQUAD) return json({ error: `keep at least ${MIN_SQUAD} players` }, 409);
  const fee = Math.round((player.marketValue || 0) * SELL_FRACTION);
  try {
    await db.update(players).set({ clubId: null }).where(eq(players.id, playerId));
    const cash = await adjustWallet(db, manager.id, fee);
    await db.insert(transfers).values({ playerId, fromClubId: manager.clubId, toClubId: null, fee, type: "sell" });
    await recordFinance(db, { clubId: manager.clubId, type: "transfer", amount: fee });
    return json({ ok: true, action, fee, cash });
  } catch (e) { return json({ error: "sell failed: " + String((e && e.message) || e) }, 500); }
}
