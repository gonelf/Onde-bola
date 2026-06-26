/*
 * Guard helper for game API routes. Resolves the signed-in user's `managers`
 * row; returns { manager } on success or { response } (a 401/404/503 Response)
 * to return immediately. Use at the top of every app/api/game/* handler:
 *
 *   const { manager, response } = await requireManager();
 *   if (response) return response;
 *   // ...manager is guaranteed here
 *
 * Note: the `game` feature flag is checked separately (in the (game) layout and
 * each route) — this helper only handles auth + manager resolution.
 */

import { auth } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { managers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const noStore = { "Cache-Control": "no-store" };

function json(body, status) {
  return Response.json(body, { status, headers: noStore });
}

export async function requireManager() {
  if (!db) return { response: json({ error: "game not configured" }, 503) };

  const session = await auth();
  const userId = session && session.user && session.user.id;
  if (!userId) return { response: json({ error: "unauthorized" }, 401) };

  let manager = null;
  try {
    const rows = await db.select().from(managers).where(eq(managers.userId, userId)).limit(1);
    manager = rows[0] || null;
  } catch (e) {
    return { response: json({ error: "lookup failed" }, 500) };
  }

  // A signed-in user without a manager row shouldn't happen (createUser
  // provisions one), but self-heal rather than 500.
  if (!manager) {
    try {
      const inserted = await db
        .insert(managers)
        .values({
          userId,
          displayName: (session.user.name) || String(session.user.email || "").split("@")[0] || "Manager",
        })
        .returning();
      manager = inserted[0] || null;
    } catch (e) {
      manager = null;
    }
    if (!manager) return { response: json({ error: "no manager" }, 404) };
  }

  return { manager, session };
}
