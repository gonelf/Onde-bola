/*
 * /api/health — read-only diagnostics for the admin page.
 *
 * Reports which TV sources are configured and whether KV is reachable, WITHOUT
 * exposing any secret values (only booleans / non-sensitive config).
 */

import { currentEnv, STAGING_HOST } from "@/lib/env";

export const dynamic = "force-dynamic";

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kvPing() {
  if (!KV_URL || !KV_TOKEN) return { configured: false, ping: null };
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    if (!r.ok) return { configured: true, ping: null, status: r.status };
    const j = await r.json();
    return { configured: true, ping: j && j.result ? String(j.result) : null };
  } catch (e) {
    return { configured: true, ping: null, error: String((e && e.message) || e) };
  }
}

// Which KV-related env var NAMES are visible to this function (booleans only,
// never values). Helps distinguish "needs redeploy" from "wrong var name".
function kvEnvPresence() {
  const names = [
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN",
    "KV_REST_API_READ_ONLY_TOKEN",
    "KV_URL",
    "REDIS_URL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
  ];
  const present = {};
  for (const n of names) present[n] = !!process.env[n];
  return present;
}

export async function GET() {
  const kv = await kvPing();
  kv.env = kvEnvPresence();
  return Response.json(
    {
      ok: true,
      time: new Date().toISOString(),
      environment: {
        env: await currentEnv(),
        stagingHost: STAGING_HOST,
        appEnv: process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || null,
        vercelEnv: process.env.VERCEL_ENV || null,
      },
      kv,
      thesportsdb: { premiumKey: !!process.env.THESPORTSDB_KEY },
      sofascore: { enabled: process.env.SOFASCORE_DISABLED !== "1" },
      fotmob: {
        enabled: process.env.FOTMOB_DISABLED !== "1",
        countries: (process.env.FOTMOB_COUNTRIES || "PT,GB,ES,BR,US,FR,DE,IT,NL")
          .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
