/*
 * /api/cron-buffer — daily social-media automation: schedule tomorrow's "games
 * of the day" post on Buffer. It pairs the square card
 * (/image/<tomorrow>/square, which Buffer fetches itself from the URL) with the
 * matching caption (/image/<tomorrow>/text) and schedules the update for the
 * next day at 09:00 UTC. Runs as a native Vercel cron (see vercel.json).
 *
 * If CRON_SECRET is set, gate it with `Authorization: Bearer <secret>` or `?key=`.
 * Configure Buffer via BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS (see
 * lib/buffer-post). Each run is recorded in the Buffer log shown at /admin/buffer.
 *
 * Override the target day with ?date=YYYY-MM-DD (defaults to tomorrow, UTC); the
 * post is always scheduled for 09:00 UTC on that day.
 */

import { bufferConfigured, scheduleDayPost, tomorrowYmd } from "@/lib/buffer-post";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET = process.env.CRON_SECRET || "";

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  return bearer === SECRET || key === SECRET;
}

export async function GET(request) {
  const url = new URL(request.url);
  const noStore = { "Cache-Control": "no-store" };

  if (!authorized(request, url.searchParams.get("key") || "")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore });
  }
  if (!bufferConfigured()) {
    return Response.json(
      { ok: false, error: "Buffer not configured — set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS" },
      { status: 500, headers: noStore }
    );
  }

  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const qDate = url.searchParams.get("date") || "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : tomorrowYmd();

  const result = await scheduleDayPost({ origin, date: day, trigger: "cron" });
  return Response.json(result, { status: result.ok ? 200 : 502, headers: noStore });
}
