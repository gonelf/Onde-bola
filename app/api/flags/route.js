/*
 * /api/flags — admin CRUD for feature flags (see lib/flags).
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { flags:[{id,label,description,default,enabled}], kvConfigured, env }
 *   POST  { flags:[{id,enabled}] }  -> replace the stored overrides
 *
 * Flags are read/written for the *current* environment (production vs staging —
 * see lib/env.js), so the admin page served on the staging domain manages the
 * staging overrides and the one on production manages production's.
 *
 * On save we revalidate the "flags" cache tag so isEnabled() picks up the
 * change promptly.
 */

import { revalidateTag } from "next/cache";
import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { kvConfigured } from "@/lib/kv";
import { loadFlags, saveFlags, isValidFlag, FLAGS_TAG } from "@/lib/flags";
import { currentEnv } from "@/lib/env";

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
  const env = await currentEnv();
  const flags = await loadFlags(env);
  return Response.json({ flags, kvConfigured, env }, { headers: noStore });
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
  }

  if (!kvConfigured) {
    return Response.json(
      { ok: false, error: "KV not configured — changes cannot be persisted" },
      { status: 503, headers: noStore }
    );
  }

  const env = await currentEnv();
  const flags = await saveFlags(body.flags, env);
  revalidateTag(FLAGS_TAG);
  return Response.json({ ok: true, flags, kvConfigured, env }, { headers: noStore });
}
