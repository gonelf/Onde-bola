/*
 * /api/buffer — admin management + log for the Buffer social automation.
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { config, dbConfigured, nextDate, log }
 *            config: { configured, tokenSet, storedChannelIds, envChannelIds, … }
 *            log: newest-first list of schedule attempts (see lib/buffer-post)
 *   POST  { action: "schedule", date? }      -> build + schedule the day's post on
 *            Buffer now (date defaults to tomorrow, UTC) and append to the log
 *         { action: "channels" }             -> discover the account's Buffer
 *            channels (id, name, service)
 *         { action: "saveChannels", channelIds:[…] } -> save which channels to
 *            post to (empty list clears the selection → env/auto-default)
 *         { action: "clear" }                -> clear the schedule log
 *
 * The square image and caption are pulled from the public /image/<date>/{square,
 * text} endpoints, so this shares exactly what the daily cron schedules.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { dbConfigured } from "@/lib/db/client";
import {
  bufferConfig,
  bufferConfigured,
  readBufferLog,
  clearBufferLog,
  scheduleDayPost,
  listBufferChannels,
  introspectCreatePost,
  saveStoredChannelIds,
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
  try {
    const [config, log] = await Promise.all([bufferConfig(), readBufferLog()]);
    return Response.json(
      { config, dbConfigured, nextDate: tomorrowYmd(), log },
      { headers: noStore }
    );
  } catch (e) {
    // Never let an unexpected error (e.g. a DB hiccup) crash the route to a 502.
    return Response.json(
      { error: "buffer admin read failed", detail: String((e && e.message) || e) },
      { status: 500, headers: noStore }
    );
  }
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const action = String((body && body.action) || "schedule");

  try {
  if (action === "clear") {
    if (!dbConfigured) {
      return Response.json({ ok: false, error: "database not configured — nothing to clear" }, { status: 503, headers: noStore });
    }
    await clearBufferLog();
    return Response.json({ ok: true, log: [] }, { headers: noStore });
  }

  if (action === "channels") {
    if (!bufferConfigured()) {
      return Response.json({ ok: false, error: "set BUFFER_ACCESS_TOKEN first" }, { status: 400, headers: noStore });
    }
    const r = await listBufferChannels();
    // 200 even on failure (carry r.ok/r.error) so a Buffer-API hiccup doesn't
    // surface to the browser as a scary gateway error.
    return Response.json(r, { headers: noStore });
  }

  if (action === "introspect") {
    if (!bufferConfigured()) {
      return Response.json({ ok: false, error: "set BUFFER_ACCESS_TOKEN first" }, { headers: noStore });
    }
    const r = await introspectCreatePost();
    return Response.json(r, { headers: noStore });
  }

  if (action === "saveChannels") {
    if (!dbConfigured) {
      return Response.json({ ok: false, error: "database not configured — selection can't be saved" }, { status: 503, headers: noStore });
    }
    const ids = Array.isArray(body && body.channelIds) ? body.channelIds : [];
    const saved = await saveStoredChannelIds(ids);
    return Response.json({ ok: true, storedChannelIds: saved }, { headers: noStore });
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
    // 200 with ok:false on a failed schedule (the page reads result.ok/message).
    return Response.json({ ok: result.ok, result, log }, { headers: noStore });
  }

  return Response.json({ error: `unknown action: ${action}` }, { status: 400, headers: noStore });
  } catch (e) {
    return Response.json(
      { ok: false, error: "buffer action failed", detail: String((e && e.message) || e) },
      { status: 500, headers: noStore }
    );
  }
}
