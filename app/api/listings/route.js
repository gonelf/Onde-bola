/*
 * /api/listings — serves the accumulated daily TV-listings store that the
 * builder (lib/listings-build.js) writes to KV, and opportunistically refreshes
 * it in the background off real traffic.
 *
 * Read path is cheap: just return the persisted map for a date (keyed by FotMob
 * match id, so the client joins onto fixtures by `fmid` with no name matching).
 * Empty ({}) until built, so it is purely additive over the live sources.
 *
 * On-visit revalidation: for today / upcoming dates, after responding we kick a
 * background rebuild of that date (via Next's `after`, so the visitor isn't
 * slowed). A short KV lock debounces it to at most once per window, so heavy
 * traffic doesn't hammer upstreams and we don't need a high-frequency cron — the
 * current visitor may see slightly stale data, the next ones get it fresher.
 *
 * Query: ?date=YYYY-MM-DD
 * Returns: { matches: { <fmid>: { home, away, kickoff, leagueId, rows:[{channel,country}] } } }
 */

import { after } from "next/server";
import { kv, kvConfigured } from "@/lib/kv";
import { buildListingsForDate, FM_DISABLED } from "@/lib/listings-build";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Don't rebuild a date more than once per this window, however many visitors.
const REVALIDATE_LOCK_SEC = Math.max(60, Number(process.env.LISTINGS_REVALIDATE_SEC) || 1800);
// Keep the on-visit rebuild light vs. the scheduled cron (which sweeps a window).
const VISIT_SOFA_BUDGET = Math.max(0, Number(process.env.LISTINGS_VISIT_SOFA_BUDGET) || 12);

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

  // Background revalidation for today / future dates only (past days are final).
  // Acquire a NX+EX lock so only one visitor per window triggers a rebuild.
  // `refreshing` tells the client a fresh build was kicked, so it can show a
  // banner and re-fetch shortly to pick up the updated store.
  const today = new Date().toISOString().slice(0, 10);
  let refreshing = false;
  if (kvConfigured && !FM_DISABLED && date >= today) {
    const got = await kv(["SET", `tv:rich:lock:${date}`, "1", "NX", "EX", String(REVALIDATE_LOCK_SEC)]);
    if (got) {
      refreshing = true;
      after(async () => {
        try { await buildListingsForDate(date, { sofaBudget: VISIT_SOFA_BUDGET }); } catch (e) {}
      });
    }
  }

  return Response.json({ matches, refreshing }, {
    headers: { "X-Cache": raw ? "HIT" : "EMPTY", "Cache-Control": swr },
  });
}
