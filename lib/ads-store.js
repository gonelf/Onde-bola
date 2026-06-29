/*
 * Ad store — the list of third-party ad units the app injects, plus where each
 * one renders (its "slot").
 *
 * Each unit holds the full snippet the ad network gives you (a <script>…</script>
 * and/or banner markup), verbatim, so you paste/edit exactly what they shipped.
 * A unit is assigned to a named slot (see AD_SLOTS) that maps to a place in the
 * layout; <AdSlot name> renders the units for that slot.
 *
 * Stored in one KV key, like lib/overrides. When nothing has ever been saved
 * (the key is unset) the built-in defaults below are used, so ads keep working
 * out of the box. Once the admin saves, the saved list is honoured verbatim —
 * including an explicit empty list, so deleting every unit and saving really
 * does turn ads off rather than springing the defaults back.
 *
 * Shape: ads:loaders -> [ { id, script, label, enabled, slot, banner? } ]
 * (Back-compat: older units stored as { src } are upgraded to a full snippet.)
 *
 * `banner` is an alternative to authoring `script` by hand: { key, width,
 * height, format }, for the common "key + size" iframe-banner format (e.g.
 * highperformanceformat.com). The key/size are the only bits that ever change
 * per placement, so when `banner` is set, `script` is generated from it
 * server-side rather than pasted — removing the chance of a malformed paste.
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db/client";
import { adUnits } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { isMigrated, markMigrated } from "@/lib/config-migrate";

export const ADS_KEY = "ads:loaders";

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const ADS_TAG = "ads";

// Layout positions a unit can be assigned to. `id` is stored on the unit;
// <AdSlot name={id}> renders at the matching place in the pages.
//
//   home-top / home-bottom  – top and bottom of the homepage feed
//   fixtures-feed           – injected inside the list, after every N games
//                             (N is per-unit, see `everyN`)
//   detail-top / detail-bottom – top and bottom of the per-game detail view
//                                (the modal on the homepage and the /g page)
export const AD_SLOTS = [
  { id: "home-top", label: "Homepage — top" },
  { id: "home-bottom", label: "Homepage — bottom" },
  { id: "fixtures-feed", label: "Fixtures list — in-feed (every N games)" },
  { id: "detail-top", label: "Details page — top" },
  { id: "detail-bottom", label: "Details page — bottom" },
];
export const DEFAULT_SLOT = "home-bottom";

// Slots from earlier versions, mapped onto the current ones so saved units and
// the built-in defaults keep rendering after the rename rather than vanishing.
const LEGACY_SLOTS = {
  "list-top": "home-top",
  "list-bottom": "home-bottom",
  detail: "detail-top",
  global: "home-bottom",
};

// In-feed cadence: a `fixtures-feed` unit shows after every N game cards.
export const DEFAULT_EVERY_N = 5;

export function isValidSlot(slot) {
  return AD_SLOTS.some((s) => s.id === slot);
}

// Resolve a stored slot id to a current one, upgrading any legacy id.
function resolveSlot(slot) {
  if (isValidSlot(slot)) return slot;
  if (LEGACY_SLOTS[slot]) return LEGACY_SLOTS[slot];
  return DEFAULT_SLOT;
}

// The loaders that shipped originally — used as the fallback until the owner
// configures their own list. Self-placing (popunder/social-bar) formats, so
// they go in the site-wide slot.
export const DEFAULT_AD_SRCS = [
  "//massivesalad.com/b.X/VZs/d/GClx0jY_W_ch/gebml9Yu-ZtUIlLk/PDTwcbxfNvDIkQ5xNwjpE/tFNvziEi0tO/TVkd2jNiQh",
  "//massivesalad.com/bGXBVas/d.G/lL0zYdWgcx/UeVm_9_uKZiULlPkhPET/cexRNGDukV5eN/Dpk/tzNSzgEZ0cO/TqkU1vMAwy",
  "//massivesalad.com/bpXFVpsYd.Gfl/0NYSWGcC/EeQme9PuqZgUmlDkIPtTsccxDN/Dhk/5dNoj/ENtaNAzrEb0_OhTPkr2BN_Qh",
  "//massivesalad.com/btXTV.sLd/G/lx0yYlWQcD/EeWmQ9RuRZFUJlhkPPfTucwxRNdD/kw5/NRDBk-tlNZzaEo0TOeTSk/1qM/wh",
];

// The exact <script> snippet the ad network ships for a loader src — used to
// seed the defaults and to upgrade older src-only units to a full snippet.
export function loaderSnippet(src) {
  return `<script>
(function(gzsj){
var d = document,
    s = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
s.settings = gzsj || {};
s.src = ${JSON.stringify(String(src))};
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})
</script>`;
}

// A "key + size" banner network ships an atOptions block plus an invoke.js
// loader that only ever differ by key/width/height/format — generate it from
// just those instead of asking for a hand-pasted snippet.
export function isValidBannerKey(key) {
  return /^[a-zA-Z0-9_-]{6,64}$/.test(String(key || ""));
}

function clampInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function bannerSnippet({ key, width, height, format }) {
  const k = String(key || "").trim();
  const w = clampInt(width, 468, 1, 2000);
  const h = clampInt(height, 60, 1, 2000);
  const fmt = String(format || "iframe").trim() || "iframe";
  return `<script>
atOptions = {
  'key' : ${JSON.stringify(k)},
  'format' : ${JSON.stringify(fmt)},
  'height' : ${h},
  'width' : ${w},
  'params' : {}
};
</script>
<script src="https://www.highperformanceformat.com/${encodeURIComponent(k)}/invoke.js"></script>`;
}

// One unit, with safe defaults. Accepts the new {script,slot} shape, the
// {banner} shape (script generated below), and the old {src} shape (upgraded
// to a full snippet).
function normalize(item, i) {
  const it = item || {};
  const rawBanner = it.banner && typeof it.banner === "object" ? it.banner : null;
  const bannerKey = rawBanner ? String(rawBanner.key || "").trim() : "";
  const banner = bannerKey && isValidBannerKey(bannerKey)
    ? {
        key: bannerKey,
        width: clampInt(rawBanner.width, 468, 1, 2000),
        height: clampInt(rawBanner.height, 60, 1, 2000),
        format: String(rawBanner.format || "iframe").trim() || "iframe",
      }
    : null;

  let script = banner ? bannerSnippet(banner) : String(it.script || "").trim();
  if (!script && it.src) script = loaderSnippet(String(it.src).trim());
  const slot = resolveSlot(it.slot);
  return {
    id: String(it.id || `ad-${i + 1}`),
    script,
    banner,
    label: String(it.label || "").trim().slice(0, 120),
    enabled: it.enabled !== false,
    slot,
    // Only meaningful for the in-feed slot; kept on every unit for a simpler shape.
    everyN: clampInt(it.everyN, DEFAULT_EVERY_N, 1, 50),
  };
}

// Split a pasted snippet into renderable markup + executable scripts. Scripts
// inserted via innerHTML don't run, so <AdSlot> emits them as real <script>
// elements; everything else (iframe/ins/img/div banner markup) is returned as
// html to drop into a container.
export function parseSnippet(snippet) {
  const s = String(snippet || "");
  const scripts = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const attrs = m[1] || "";
    const srcMatch = attrs.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const src = srcMatch ? (srcMatch[2] || srcMatch[3] || srcMatch[4] || "") : "";
    if (src) scripts.push({ src, async: /\basync\b/i.test(attrs) });
    else scripts.push({ code: m[2] || "" });
  }
  let html = s.replace(re, "").trim();
  // A bad paste (e.g. one script block missing its opening <script>) can leave
  // an unpaired <script>/</script> tag behind; drop those before judging
  // what's left. If nothing but plain text remains, it's stray JS, not
  // markup — treat it as inline script so it runs instead of showing up as
  // raw text on the page.
  const leftover = html.replace(/<\/?script\b[^>]*>/gi, "").trim();
  if (leftover && leftover.indexOf("<") === -1) {
    scripts.push({ code: leftover });
    html = "";
  }
  return { html, scripts };
}

// The full managed list (what the admin page shows/edits). Falls back to the
// built-in defaults only when nothing has ever been saved (unset/invalid key);
// a stored list is honoured as-is, including an explicit empty list.
async function loadAdsKV() {
  const raw = await kv(["GET", ADS_KEY]);
  let stored = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) stored = parsed;
    } catch (e) {
      stored = null;
    }
  }
  const list = Array.isArray(stored)
    ? stored
    : DEFAULT_AD_SRCS.map((src) => ({ script: loaderSnippet(src), slot: DEFAULT_SLOT }));
  return list.map(normalize);
}

async function readAdsDB() {
  const rows = await db.select().from(adUnits).orderBy(asc(adUnits.position));
  return rows.map((r, i) => normalize({
    id: r.id, script: r.script, banner: r.banner, label: r.label,
    enabled: r.enabled, slot: r.slot, everyN: r.everyN,
  }, i));
}

async function writeAdsDB(clean) {
  const values = (Array.isArray(clean) ? clean : []).map((u, i) => ({
    id: u.id, position: i, script: u.script, banner: u.banner || null,
    label: u.label, enabled: u.enabled, slot: u.slot, everyN: u.everyN,
  }));
  await db.transaction(async (tx) => {
    await tx.delete(adUnits);
    if (values.length) await tx.insert(adUnits).values(values);
  });
}

// Postgres-backed once the admin has saved at least once (which sets the
// migration marker and distinguishes an intentional empty list from "not yet
// migrated"). Until then — and on any DB error — reads come from KV/defaults, so
// ads keep rendering exactly as before. Note loadAds runs inside unstable_cache,
// so it never writes; migration happens on save, not on read.
export async function loadAds() {
  if (!db) return loadAdsKV();
  try {
    if (await isMigrated(ADS_KEY)) return await readAdsDB();
    return await loadAdsKV();
  } catch (e) {
    return loadAdsKV();
  }
}

export async function saveAds(list) {
  const clean = (Array.isArray(list) ? list : []).map(normalize).filter((u) => u.script);
  if (!db) { await kv(["SET", ADS_KEY, JSON.stringify(clean)]); return clean; }
  try {
    await writeAdsDB(clean);
    await markMigrated(ADS_KEY);
  } catch (e) {
    await kv(["SET", ADS_KEY, JSON.stringify(clean)]);
  }
  return clean;
}

// The enabled units to actually render, cached so statically-generated pages can
// read ad config without per-request dynamic rendering; admin saves bust this
// via revalidateTag(ADS_TAG). <AdSlot> filters this by slot.
export const activeUnits = unstable_cache(
  async () => {
    const list = await loadAds();
    return list.filter((u) => u.enabled && u.script);
  },
  ["ads:active-units"],
  { revalidate: 300, tags: [ADS_TAG] }
);

// Parsed, serializable units for one slot — for slots rendered inside client
// islands (the in-feed list and the detail modal), where a server <AdSlot>
// can't reach. The home/SEO pages fetch these server-side and hand them to the
// client component, which injects them via <AdUnits> (same path <AdSlot> uses).
// Returns [{ id, everyN, html, scripts }]; never throws.
export async function slotUnits(name) {
  let all = [];
  try {
    all = await activeUnits();
  } catch (e) {
    return [];
  }
  return all
    .filter((u) => u.slot === name)
    .map((u) => ({ id: u.id, everyN: u.everyN, ...parseSnippet(u.script) }));
}
