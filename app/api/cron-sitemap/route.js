/*
 * /api/cron-sitemap — daily sweep that records canonical SEO URLs into the KV
 * registry (`seo:urls`) so /sitemap.xml is consistent and incremental. Ported
 * from lib/cron-sitemap.js. Runs as a native Vercel cron (see vercel.json).
 * If CRON_SECRET is set, send it as `Authorization: Bearer <secret>` or `?key=`.
 */

import { kvConfigured } from "@/lib/kv";
import { sweep, writeRegistry, pruneRegistry, readRegistry } from "@/lib/sitemap-sweep";
import { forwardAuthHeaders } from "@/lib/forward-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";

function authorized(request, key) {
  if (!SECRET) return true;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  return bearer === SECRET || key === SECRET;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const noStore = { "Cache-Control": "no-store" };

  if (!authorized(request, searchParams.get("key") || "")) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: noStore });
  }
  if (DISABLED) return Response.json({ ok: false, disabled: true }, { headers: noStore });
  if (!kvConfigured) {
    return Response.json({ ok: false, error: "KV not configured — nothing to persist" }, { headers: noStore });
  }

  const h = request.headers;
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const { map, today } = await sweep(origin, forwardAuthHeaders(h));
  const found = Object.keys(map).length;

  const added = await writeRegistry(map);

  // Prune entries older than the window's tail.
  const reg = await readRegistry();
  const stale = await pruneRegistry(today, reg);

  // A sweep that found nothing means the fixtures feed was unreachable (FotMob
  // blocked/disabled, or the internal fetch hit an auth wall) — the registry
  // keeps its old entries, but new match dates never get added and the sitemap
  // silently goes stale. Surface it as a non-2xx so the cron run shows as failed
  // instead of a quiet "ok" that hides the problem.
  const ok = found > 0;
  return Response.json(
    {
      ok,
      found,
      swept: added,
      pruned: stale.length,
      total: Object.keys(reg).length - stale.length,
      ...(ok ? {} : { error: "sweep found no fixtures — feed unreachable?" }),
    },
    { status: ok ? 200 : 502, headers: noStore }
  );
}
