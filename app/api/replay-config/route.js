/*
 * /api/replay-config — the app-wide match-replay animation defaults.
 *
 *   GET   -> { config: { cfg, display, updatedAt } | null }   (public; read by
 *            both the admin lab and the public match-replay modal)
 *   POST  { cfg, display }  -> save as the app default   (admin only)
 *
 * GET is public so the live site can pick up the owner's saved tuning; POST is
 * gated by HTTP Basic Auth (middleware lets GET through, requires creds on POST;
 * the handler re-checks, fail-closed when creds are unset). Stored in KV under
 * replay:config (see lib/replay-config).
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { loadReplayConfig, saveReplayConfig, sanitizeReplayConfig } from "@/lib/replay-config";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  const config = await loadReplayConfig();
  return Response.json({ config }, { headers: noStore });
}

export async function POST(request) {
  if (!isAdmin(request)) {
    return Response.json(
      { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
      { status: 401, headers: noStore }
    );
  }
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const clean = sanitizeReplayConfig(body);
  if (!Object.keys(clean.cfg).length) {
    return Response.json({ error: "cfg required" }, { status: 400, headers: noStore });
  }
  const config = Object.assign(clean, { updatedAt: new Date().toISOString() });
  await saveReplayConfig(config);
  return Response.json({ ok: true, config }, { headers: noStore });
}
