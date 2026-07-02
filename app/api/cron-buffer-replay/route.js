/*
 * /api/cron-buffer-replay — schedule the animated match-replay video of one
 * finished game on Buffer (Facebook + Instagram). Third sibling of
 * /api/cron-buffer (image) and /api/cron-buffer-reel (games-of-the-day video):
 * the replay is recorded off /admin/replay in headless Chromium on a GitHub
 * Actions runner (scripts/replay-cron.mjs via .github/workflows/replay-cron.yml),
 * uploaded to Vercel Blob, and this endpoint does the fast part — build the
 * one-game caption and schedule the post for 10:00 UTC the morning after the
 * match (an hour after the daily digest posts), logged to /admin/buffer.
 *
 * Query:
 *   ?video=<https URL>   required — the recorded mp4 (public, Buffer fetches it)
 *   ?thumb=<https URL>   optional — a cover frame
 *   ?date=YYYY-MM-DD     required — the day the match was PLAYED
 *   ?fmid=<id>           required — the game's fixtures-feed id (for the caption)
 *
 * If CRON_SECRET is set, gate it with `Authorization: Bearer <secret>` or `?key=`.
 */

import { bufferConfigured, scheduleReplayPost } from "@/lib/buffer-post";
import { forwardAuthHeaders } from "@/lib/forward-auth";

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
      { ok: false, error: "Buffer not configured — set BUFFER_ACCESS_TOKEN" },
      { status: 500, headers: noStore }
    );
  }

  const videoUrl = url.searchParams.get("video") || "";
  const date = url.searchParams.get("date") || "";
  const fmid = url.searchParams.get("fmid") || "";
  if (!/^https:\/\//.test(videoUrl)) {
    return Response.json({ ok: false, error: "missing or non-https ?video=<url>" }, { status: 400, headers: noStore });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !fmid) {
    return Response.json({ ok: false, error: "missing ?date=YYYY-MM-DD or ?fmid=<id>" }, { status: 400, headers: noStore });
  }
  const thumbUrl = /^https:\/\//.test(url.searchParams.get("thumb") || "")
    ? url.searchParams.get("thumb")
    : "";

  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const result = await scheduleReplayPost({
    origin, date, fmid, videoUrl, thumbUrl, trigger: "cron", auth: forwardAuthHeaders(h),
  });
  return Response.json(result, { status: result.ok ? 200 : 502, headers: noStore });
}
