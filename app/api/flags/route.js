/*
 * /api/flags — admin CRUD for feature flags (see lib/flags).
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { flags:[{id,label,description,default,state}], kvConfigured }
 *   POST  { flags:[{id,state}] }  -> replace the stored overrides
 *           (state is "off" | "dev" | "staging" | "production")
 *
 * isEnabled() reads flags fresh per request (no time-based cache), so a save is
 * picked up immediately — no cache-tag revalidation needed here.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { kvConfigured } from "@/lib/kv";
import { loadFlags, saveFlags, isValidFlag, isValidState } from "@/lib/flags";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function deny() {
  return Response.json(
    { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
    { status: 401, headers: noStore }
  );
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  const flags = await loadFlags();
  return Response.json({ flags, kvConfigured }, { headers: noStore });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  if (!Array.isArray(body.flags)) {
    return Response.json({ error: "flags array required" }, { status: 400, headers: noStore });
  }

  for (const item of body.flags) {
    const id = String((item && item.id) || "");
    if (!isValidFlag(id)) {
      return Response.json({ error: `unknown flag: ${id}` }, { status: 400, headers: noStore });
    }
    if (!isValidState(item && item.state)) {
      return Response.json(
        { error: `invalid state for ${id}: ${item && item.state}` },
        { status: 400, headers: noStore }
      );
    }
  }

  if (!kvConfigured) {
    return Response.json(
      { ok: false, error: "KV not configured — changes cannot be persisted" },
      { status: 503, headers: noStore }
    );
  }

  const flags = await saveFlags(body.flags);
  return Response.json({ ok: true, flags, kvConfigured }, { headers: noStore });
}
