/*
 * /api/game/finances — the manager's wallet + recent ledger for their club.
 * Auth + flag gated. GET -> { cash, ledger:[{type,amount,createdAt}] }.
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { finances } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

export async function GET() {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  let ledger = [];
  try {
    ledger = await db
      .select({ type: finances.type, amount: finances.amount, createdAt: finances.createdAt })
      .from(finances).where(eq(finances.clubId, manager.clubId))
      .orderBy(desc(finances.createdAt)).limit(50);
  } catch (e) { ledger = []; }

  return json({ cash: manager.cashBalance || 0, ledger });
}
