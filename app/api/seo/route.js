/*
 * /api/seo — admin endpoint to inspect and manage the pSEO sitemap registry
 * (KV hash `seo:urls` → { path: lastmod }) that /sitemap.xml serves and the
 * daily /api/cron-sitemap maintains. This gives the owner a button to check
 * that the programmatic SEO pages are being registered, trigger a sweep/rebuild
 * on demand (instead of waiting for the daily cron), and prune/remove URLs.
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET                          -> { ok, kv, stats, sample }
 *   GET  ?list=1&prefix=/g/euro  -> + { urls: [ { path, lastmod, indexable } ] }
 *   POST { action:"sweep" }      -> run the sweep, upsert into the registry
 *   POST { action:"prune" }      -> drop entries older than SITEMAP_PRUNE_DAYS
 *   POST { action:"rebuild" }    -> clear, then sweep fresh
 *   DELETE ?path=/g/foo          -> remove one URL
 *   DELETE ?all=1                -> clear the whole registry
 */

import { kvConfigured } from "@/lib/kv";
import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import {
  sweep,
  lisbonYmd,
  readRegistry,
  writeRegistry,
  pruneRegistry,
  removeFromRegistry,
  clearRegistry,
} from "@/lib/sitemap-sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

// A registry path is a league/edition hub when it has <= 2 segments
// (/g/<league>), otherwise it's a per-match page (/g/<league>/<date>/<slug>).
function isHub(path) {
  return path.split("/").filter(Boolean).length <= 2;
}

function statsOf(reg) {
  const paths = Object.keys(reg);
  let hubs = 0;
  let matches = 0;
  let oldest = null;
  let newest = null;
  for (const p of paths) {
    if (isHub(p)) hubs++; else matches++;
    const lm = String(reg[p] || "");
    if (lm) {
      if (!oldest || lm < oldest) oldest = lm;
      if (!newest || lm > newest) newest = lm;
    }
  }
  return { total: paths.length, hubs, matches, oldest, newest };
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();

  const { searchParams } = new URL(request.url);
  const reg = await readRegistry();
  const stats = statsOf(reg);

  // Deterministic order: hubs first, then most-recent lastmod, then path.
  const sorted = Object.keys(reg).sort((a, b) => {
    const da = a.split("/").filter(Boolean).length;
    const db = b.split("/").filter(Boolean).length;
    if (da !== db) return da - db;
    if (reg[a] !== reg[b]) return reg[b] < reg[a] ? -1 : 1;
    return a < b ? -1 : 1;
  });

  const body = {
    ok: true,
    kv: { configured: kvConfigured },
    registry: "seo:urls",
    stats,
    sample: sorted.slice(0, 12).map((p) => ({ path: p, lastmod: reg[p] })),
  };

  if (searchParams.get("list") === "1") {
    const prefix = (searchParams.get("prefix") || "").trim();
    const list = (prefix ? sorted.filter((p) => p.startsWith(prefix)) : sorted)
      .map((p) => ({ path: p, lastmod: reg[p], hub: isHub(p) }));
    body.count = list.length;
    body.urls = list;
  }

  return Response.json(body, { headers: noStore });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  if (!kvConfigured) {
    return Response.json(
      { ok: false, error: "KV not configured — nothing to persist" },
      { status: 400, headers: noStore }
    );
  }

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const action = String(body.action || "").trim();

  if (action !== "sweep" && action !== "prune" && action !== "rebuild") {
    return Response.json(
      { ok: false, error: 'action must be "sweep", "prune" or "rebuild"' },
      { status: 400, headers: noStore }
    );
  }

  const today = lisbonYmd(new Date());

  if (action === "prune") {
    const stale = await pruneRegistry(today);
    const reg = await readRegistry();
    return Response.json(
      { ok: true, action, pruned: stale.length, prunedPaths: stale.slice(0, 50), total: Object.keys(reg).length },
      { headers: noStore }
    );
  }

  // sweep + rebuild both re-scan the fixtures window.
  if (action === "rebuild") await clearRegistry();
  const { map } = await sweep(originOf(request));
  const swept = await writeRegistry(map);
  const stale = await pruneRegistry(today);
  const reg = await readRegistry();

  return Response.json(
    { ok: true, action, swept, pruned: stale.length, total: Object.keys(reg).length },
    { headers: noStore }
  );
}

export async function DELETE(request) {
  if (!isAdmin(request)) return deny();
  const { searchParams } = new URL(request.url);

  if (searchParams.get("all") === "1") {
    await clearRegistry();
    return Response.json({ ok: true, cleared: true }, { headers: noStore });
  }

  const path = String(searchParams.get("path") || "").trim();
  if (!path) {
    return Response.json(
      { ok: false, error: "path or all=1 required" },
      { status: 400, headers: noStore }
    );
  }
  const removed = await removeFromRegistry(path);
  return Response.json({ ok: true, path, removed }, { headers: noStore });
}
