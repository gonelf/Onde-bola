/*
 * /api/cron-sitemap — daily sweep that records canonical SEO URLs into the KV
 * registry (`seo:urls`) so /sitemap.xml is consistent and incremental. Ported
 * from lib/cron-sitemap.js. Runs as a native Vercel cron (see vercel.json).
 * If CRON_SECRET is set, send it as `Authorization: Bearer <secret>` or `?key=`.
 */

import { kv, kvConfigured } from "@/lib/kv";
import { sweep, addDays } from "@/lib/sitemap-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";
const REGISTRY = "seo:urls";
const PRUNE_DAYS = Math.max(30, Number(process.env.SITEMAP_PRUNE_DAYS) || 400);

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

  const { map, today } = await sweep(origin);

  const paths = Object.keys(map);
  let added = 0;
  if (paths.length) {
    const args = ["HSET", REGISTRY];
    paths.forEach((p) => args.push(p, map[p]));
    await kv(args);
    added = paths.length;
  }

  // Prune entries older than the window's tail.
  const cutoff = addDays(today, -PRUNE_DAYS);
  const raw = await kv(["HGETALL", REGISTRY]);
  const reg = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) reg[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(reg, raw);
  const stale = Object.keys(reg).filter((p) => String(reg[p]) < cutoff);
  if (stale.length) await kv(["HDEL", REGISTRY].concat(stale));

  return Response.json(
    { ok: true, swept: added, pruned: stale.length, total: Object.keys(reg).length - stale.length },
    { headers: noStore }
  );
}
