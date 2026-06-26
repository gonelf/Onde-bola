/*
 * economy.js — money helpers for the manager game (M4).
 *
 * The manager's wallet is managers.cashBalance; the finances table is the
 * per-club ledger (gate receipts, prize money, transfer fees, training spend).
 * Amounts are whole currency units. recordFinance writes a ledger row and
 * (optionally) moves the manager's wallet, in that order, fail-soft.
 */

import { managers, finances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const STARTING_CASH = 20_000_000; // a new manager's transfer budget

// Match-day income for an owned club (illustrative): a gate receipt every game
// plus a win/draw result bonus.
export const GATE_RECEIPT = 750_000;
export const WIN_BONUS = 1_500_000;
export const DRAW_BONUS = 500_000;

// Sell-on returns this fraction of a player's market value.
export const SELL_FRACTION = 0.9;

// Append a ledger row. `clubId` may be null (manager-level), `type` is one of
// gate | prize | transfer | wages | training | other.
export async function recordFinance(db, { clubId, type, amount, fixtureId, seasonLabel }) {
  try {
    await db.insert(finances).values({
      clubId: clubId || null, type, amount: Math.round(amount) || 0,
      fixtureId: fixtureId || null, seasonLabel: seasonLabel || null,
    });
  } catch (e) { /* ledger is best-effort */ }
}

// Adjust a manager's wallet by `delta` (can be negative). Returns the new
// balance, or null on failure. Reads then writes (Neon HTTP has no atomic
// increment helper here; callers serialize their own actions).
export async function adjustWallet(db, managerId, delta) {
  try {
    const rows = await db.select({ cash: managers.cashBalance }).from(managers).where(eq(managers.id, managerId)).limit(1);
    if (!rows[0]) return null;
    const next = (rows[0].cash || 0) + Math.round(delta);
    await db.update(managers).set({ cashBalance: next }).where(eq(managers.id, managerId));
    return next;
  } catch (e) {
    return null;
  }
}
