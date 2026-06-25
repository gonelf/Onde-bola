/*
 * /api/game/clubs — list imported clubs for the friendly picker. Auth-gated
 * (requireManager) and flag-gated (the `game` flag). Returns id/name/crest only.
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { clubs } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (!(await isEnabled("game"))) return Response.json({ error: "not found" }, { status: 404, headers: noStore });
  const { response } = await requireManager();
  if (response) return response;

  try {
    const rows = await db
      .select({ id: clubs.id, name: clubs.name, crest: clubs.crestUrl, color: clubs.kitColor, formation: clubs.baseFormation })
      .from(clubs)
      .orderBy(asc(clubs.name));
    return Response.json({ clubs: rows }, { headers: noStore });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 500, headers: noStore });
  }
}
