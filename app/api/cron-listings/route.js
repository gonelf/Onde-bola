/*
 * /api/cron-listings — scheduled sweep that builds the rich, accumulated TV
 * listings store (tv:rich:<date>) for the upcoming days' MAJOR-league fixtures.
 * The heavy lifting (FotMob id-join + SofaScore PT fill + accumulate-merge)
 * lives in lib/listings-build.js, shared with the on-visit revalidation in
 * /api/listings. This route just handles auth, the date window, and looping.
 *
 * Why a store: no single free source is complete, and broadcasters publish
 * listings piecemeal as kickoff nears — running repeatedly and merging means
 * once a channel (e.g. Portugal's Sport TV 5) is seen it sticks, and coverage
 * only grows. Scoped to major leagues to keep upstream cost bounded.
 *
 * Pokeable by an external scheduler (or vercel.json crons). If CRON_SECRET is
 * set, send it as `Authorization: Bearer <secret>` or `?key=`.
 *
 * Env: CRON_SECRET, FOTMOB_DISABLED=1, SOFASCORE_DISABLED=1, MAJOR_LEAGUE_IDS,
 *      FOTMOB_COUNTRIES, LISTINGS_DAYS (default 3), LISTINGS_SOFA_BUDGET (40),
 *      KV_REST_API_URL / KV_REST_API_TOKEN.
 */

import { kvConfigured } from "@/lib/kv";
import { buildListingsForDate, FM_DISABLED } from "@/lib/listings-build";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET = process.env.CRON_SECRET || "";
const DAYS = Math.min(10, Math.max(1, Number(process.env.LISTINGS_DAYS) || 3));

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  return auth.replace(/^Bearer\s+/i, "") === SECRET || key === SECRET;
}

export async function GET(request) {
  const noStore = { "Cache-Control": "no-store" };
  const { searchParams } = new URL(request.url);

  if (!authorized(request, searchParams.get("key") || "")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore });
  }
  if (FM_DISABLED) return Response.json({ ok: false, disabled: true }, { headers: noStore });
  if (!kvConfigured) {
    return Response.json({ ok: false, error: "KV not configured — nothing to persist" }, { headers: noStore });
  }

  let dates;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.get("date")))) {
    dates = [String(searchParams.get("date"))];
  } else {
    const days = Math.min(10, Math.max(1, Number(searchParams.get("days")) || DAYS));
    dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() + i * 86400000).toISOString().slice(0, 10));
    }
  }

  const summary = { ok: true, dates, fixtures: 0, withFotmob: 0, sofaFilled: 0,
    sofaLookups: 0, stored: 0, days: {} };

  for (const date of dates) {
    const day = await buildListingsForDate(date);
    summary.fixtures += day.fixtures;
    summary.withFotmob += day.withFotmob;
    summary.sofaFilled += day.sofaFilled;
    summary.sofaLookups += day.sofaLookups;
    summary.stored += day.stored;
    summary.days[date] = day;
  }

  return Response.json(summary, { headers: noStore });
}
