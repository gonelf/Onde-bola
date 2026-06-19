/*
 * /api/ads — admin CRUD for the third-party ad-loader list (see lib/ads-store).
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { ads: [ { id, src, label, enabled } ], kvConfigured }
 *   POST  { ads: [ { src, label?, enabled? } ] }  -> replace the whole list
 *
 * Saved server-side and rendered on the home + per-game pages by <Ads>. On save
 * we revalidate the "ads" cache tag so the change is picked up on the next
 * render instead of waiting for the periodic revalidation.
 */

import { revalidateTag } from "next/cache";
import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { kvConfigured } from "@/lib/kv";
import { loadAds, saveAds, isValidAdSrc, ADS_TAG } from "@/lib/ads-store";

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
  const ads = await loadAds();
  return Response.json({ ads, kvConfigured }, { headers: noStore });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  if (!Array.isArray(body.ads)) {
    return Response.json({ error: "ads array required" }, { status: 400, headers: noStore });
  }

  const ads = [];
  for (let i = 0; i < body.ads.length; i++) {
    const item = body.ads[i] || {};
    const src = String(item.src || "").trim();
    if (!isValidAdSrc(src)) {
      return Response.json(
        { error: `row ${i + 1}: invalid src (expected //host/path or http(s):// URL)` },
        { status: 400, headers: noStore }
      );
    }
    ads.push({
      id: String(item.id || "").trim() || undefined,
      src,
      label: String(item.label || "").trim(),
      enabled: item.enabled !== false,
    });
  }

  if (!kvConfigured) {
    return Response.json(
      { ok: false, error: "KV not configured — changes cannot be persisted", ads },
      { status: 503, headers: noStore }
    );
  }

  const saved = await saveAds(ads);
  revalidateTag(ADS_TAG);
  return Response.json({ ok: true, ads: saved, kvConfigured }, { headers: noStore });
}
