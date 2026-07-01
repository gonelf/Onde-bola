/*
 * /api/cron-buffer-reel — schedule the day's video reel on Buffer (Facebook +
 * Instagram). The video sibling of /api/cron-buffer: a reel takes minutes to
 * render, far beyond a serverless budget, so the rendering happens on a GitHub
 * Actions runner (scripts/reel-cron.mjs via .github/workflows/reel-cron.yml)
 * which uploads the mp4 + cover to Vercel Blob and then calls this endpoint
 * with their public URLs. This endpoint only does the fast part: build the
 * caption in-process and schedule the post for 09:00 UTC on the target day,
 * logged to the same Buffer log shown at /admin/buffer.
 *
 * Query:
 *   ?video=<https URL>   required — the rendered mp4 (public, Buffer fetches it)
 *   ?thumb=<https URL>   optional — the cover still
 *   ?date=YYYY-MM-DD     the day the reel is about (defaults to tomorrow, UTC)
 *
 * If CRON_SECRET is set, gate it with `Authorization: Bearer <secret>` or `?key=`.
 */

import { bufferConfigured, scheduleReelPost, tomorrowYmd } from "@/lib/buffer-post";
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
  if (!/^https:\/\//.test(videoUrl)) {
    return Response.json(
      { ok: false, error: "missing or non-https ?video=<url>" },
      { status: 400, headers: noStore }
    );
  }
  const thumbUrl = /^https:\/\//.test(url.searchParams.get("thumb") || "")
    ? url.searchParams.get("thumb")
    : "";

  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const qDate = url.searchParams.get("date") || "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : tomorrowYmd();

  const result = await scheduleReelPost({
    origin, date: day, videoUrl, thumbUrl, trigger: "cron", auth: forwardAuthHeaders(h),
  });
  return Response.json(result, { status: result.ok ? 200 : 502, headers: noStore });
}
