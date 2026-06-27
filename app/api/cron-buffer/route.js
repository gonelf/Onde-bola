/*
 * /api/cron-buffer — daily social-media automation: schedule tomorrow's "games
 * of the day" post on Buffer. It pairs the square card
 * (/image/<tomorrow>/square, which Buffer fetches itself from the URL) with the
 * matching caption (/image/<tomorrow>/text) and schedules the update for the
 * next day at 09:00 UTC. Runs as a native Vercel cron (see vercel.json).
 *
 * If CRON_SECRET is set, gate it with `Authorization: Bearer <secret>` or `?key=`.
 * Configure Buffer via BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS (see
 * lib/buffer-post). Can also be triggered by hand to schedule the next post.
 *
 * Override the target day with ?date=YYYY-MM-DD (defaults to tomorrow, UTC); the
 * post is always scheduled for 09:00 UTC on that day.
 */

import { bufferConfigured, scheduleBufferUpdate } from "@/lib/buffer-post";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SECRET = process.env.CRON_SECRET || "";

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  return bearer === SECRET || key === SECRET;
}

// Tomorrow (UTC) as YYYY-MM-DD — the day the scheduled post is about and goes out.
function tomorrowYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
  const imageUrl = `${origin}/image/${day}/square`;
  const textUrl = `${origin}/image/${day}/text`;
  // Publish at 09:00 UTC on the day the card is about.
  const scheduledAt = `${day}T09:00:00Z`;

  // Pull the caption from the new text endpoint (the same words /image shows).
  // Buffer fetches the square image itself, so we only need to hand it the URL.
  let text = "";
  try {
    const r = await fetch(textUrl, { headers: { Accept: "text/plain" } });
    if (r.ok) text = (await r.text()).trim();
  } catch (e) { /* handled below */ }

  if (!text) {
    return Response.json(
      { ok: false, error: "could not build post text", textUrl },
      { status: 502, headers: noStore }
    );
  }

  const res = await scheduleBufferUpdate({ text, photo: imageUrl, scheduledAt });
  return Response.json(
    {
      ok: res.ok,
      date: day,
      scheduledAt,
      imageUrl,
      textUrl,
      status: res.status,
      buffer: safeJson(res.body),
    },
    { status: res.ok ? 200 : 502, headers: noStore }
  );
}

function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}
