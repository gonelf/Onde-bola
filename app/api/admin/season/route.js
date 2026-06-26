/*
 * /api/admin/season — end a league's season and roll it over (promotion/
 * relegation with the paired lower tier, then fresh fixtures). Basic-Auth gated.
 *
 *   POST { leagueId, intervalMinutes? } -> rollOver summary
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db } from "@/lib/db/client";
import { rollOver } from "@/lib/game/season";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

export async function POST(request) {
  if (!isAdmin(request)) return json({ error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" }, 401);
  if (!db) return json({ error: "DATABASE_URL not configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  if (!body.leagueId) return json({ error: "leagueId required" }, 400);

  const res = await rollOver(db, body.leagueId, { intervalMinutes: parseInt(body.intervalMinutes, 10) || 1440 });
  if (res.error) return json({ ok: false, error: res.error }, 409);
  return json({ ok: true, ...res });
}
