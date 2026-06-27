/*
 * /api/buffer — admin management + log for the Buffer social automation.
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { config, kvConfigured, nextDate, log }
 *            config: { configured, tokenSet, profileCount, profileIds }
 *            log: newest-first list of schedule attempts (see lib/buffer-post)
 *   POST  { action: "schedule", date? }  -> build + schedule the day's post on
 *            Buffer now (date defaults to tomorrow, UTC) and append to the log
 *         { action: "channels" }         -> discover the account's Buffer channel
 *            ids (so they can be put in BUFFER_CHANNEL_IDS)
 *         { action: "clear" }            -> clear the schedule log
 *
 * The square image and caption are pulled from the public /image/<date>/{square,
 * text} endpoints, so this shares exactly what the daily cron schedules.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { kvConfigured } from "@/lib/kv";
import {
  bufferConfig,
  bufferConfigured,
  readBufferLog,
  clearBufferLog,
  scheduleDayPost,
  listBufferChannels,
  tomorrowYmd,
} from "@/lib/buffer-post";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function deny() {
  return Response.json(
    { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
    { status: 401, headers: noStore }
  );
}

function originOf(request) {
  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  return `${proto}://${host}`;
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  const log = await readBufferLog();
  return Response.json(
    { config: bufferConfig(), kvConfigured, nextDate: tomorrowYmd(), log },
    { headers: noStore }
  );
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const action = String((body && body.action) || "schedule");

  if (action === "clear") {
    if (!kvConfigured) {
      return Response.json({ ok: false, error: "KV not configured — nothing to clear" }, { status: 503, headers: noStore });
    }
    await clearBufferLog();
    return Response.json({ ok: true, log: [] }, { headers: noStore });
  }

  if (action === "channels") {
    if (!bufferConfig().tokenSet) {
      return Response.json({ ok: false, error: "set BUFFER_ACCESS_TOKEN first" }, { status: 400, headers: noStore });
    }
    const r = await listBufferChannels();
    return Response.json(r, { status: r.ok ? 200 : 502, headers: noStore });
  }

  if (action === "schedule") {
    if (!bufferConfigured()) {
      return Response.json(
        { ok: false, error: "Buffer not configured — set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS" },
        { status: 400, headers: noStore }
      );
    }
    const qDate = String((body && body.date) || "");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : tomorrowYmd();
    const result = await scheduleDayPost({ origin: originOf(request), date, trigger: "manual" });
    const log = await readBufferLog();
    return Response.json({ ok: result.ok, result, log }, { status: result.ok ? 200 : 502, headers: noStore });
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400, headers: noStore });
}
