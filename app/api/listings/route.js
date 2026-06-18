/*
 * /api/listings — serves the accumulated daily TV-listings store that
 * /api/cron-listings builds in KV. Read-only and cheap: just returns the
 * persisted map for a date, so the client gets the richest merged listings
 * (FotMob across countries + SofaScore-filled gaps like Sport TV 5) without any
 * upstream calls on the request path.
 *
 * The map is keyed by FotMob match id so the client joins it onto fixtures by
 * `fmid` with no name matching. Empty ({}) until the cron has populated the
 * date, so it is purely additive over the live /api/fmtv + /api/tv sources.
 *
 * Query: ?date=YYYY-MM-DD
 * Returns: { matches: { <fmid>: { home, away, kickoff, leagueId, rows:[{channel,country}] } } }
 */

import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const swr = "public, s-maxage=120, stale-while-revalidate=600";
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Pass ?date=YYYY-MM-DD" }, {
      status: 400, headers: { "Cache-Control": swr },
    });
  }

  const raw = await kv(["GET", `tv:rich:${date}`]);
  let matches = {};
  if (raw) { try { matches = JSON.parse(raw) || {}; } catch (e) { matches = {}; } }

  return Response.json({ matches }, {
    headers: { "X-Cache": raw ? "HIT" : "EMPTY", "Cache-Control": swr },
  });
}
