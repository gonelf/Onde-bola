/*
 * /api/ads — admin CRUD for the ad units (see lib/ads-store).
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET   -> { ads:[{id,script,label,enabled,slot,banner?}], slots:[{id,label}], kvConfigured }
 *   POST  { ads:[{script|banner,label?,enabled?,slot?}] }  -> replace the whole list
 *
 * A unit is either a hand-pasted `script` snippet or a `banner` shape
 * ({key,width,height,format}) — the server generates `script` from the
 * latter (see lib/ads-store#bannerSnippet) so a "key + size" banner ad never
 * needs a raw paste.
 *
 * Each unit is rendered at its slot's place in the layout by <AdSlot>. On save
 * we revalidate the "ads" cache tag so the change is picked up promptly.
 */

import { revalidateTag } from "next/cache";
import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { kvConfigured } from "@/lib/kv";
import { loadAds, saveAds, ADS_TAG, AD_SLOTS, isValidSlot, DEFAULT_SLOT, isValidBannerKey } from "@/lib/ads-store";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const MAX_SNIPPET = 20000;

function deny() {
  return Response.json(
    { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
    { status: 401, headers: noStore }
  );
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  const ads = await loadAds();
  return Response.json({ ads, slots: AD_SLOTS, kvConfigured }, { headers: noStore });
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
    const common = {
      id: String(item.id || "").trim() || undefined,
      label: String(item.label || "").trim(),
      enabled: item.enabled !== false,
      slot: isValidSlot(item.slot) ? item.slot : DEFAULT_SLOT,
      everyN: item.everyN, // in-feed cadence; normalized/clamped in ads-store
    };

    const bannerKey = item.banner && typeof item.banner === "object" ? String(item.banner.key || "").trim() : "";
    if (bannerKey) {
      if (!isValidBannerKey(bannerKey)) {
        return Response.json(
          { error: `row ${i + 1}: key must be 6-64 letters, digits, "-" or "_"` },
          { status: 400, headers: noStore }
        );
      }
      ads.push({ ...common, banner: { key: bannerKey, width: item.banner.width, height: item.banner.height, format: item.banner.format } });
      continue;
    }

    const script = String(item.script || "").trim();
    if (!script) {
      return Response.json({ error: `row ${i + 1}: script is empty` }, { status: 400, headers: noStore });
    }
    if (script.length > MAX_SNIPPET) {
      return Response.json({ error: `row ${i + 1}: script too long` }, { status: 400, headers: noStore });
    }
    ads.push({ ...common, script });
  }

  if (!kvConfigured) {
    return Response.json(
      { ok: false, error: "KV not configured — changes cannot be persisted", ads },
      { status: 503, headers: noStore }
    );
  }

  const saved = await saveAds(ads);
  revalidateTag(ADS_TAG);
  return Response.json({ ok: true, ads: saved, slots: AD_SLOTS, kvConfigured }, { headers: noStore });
}
