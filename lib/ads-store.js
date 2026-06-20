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
 * Shape: ads:loaders -> [ { id, script, label, enabled, slot } ]
 * (Back-compat: older units stored as { src } are upgraded to a full snippet.)
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";

export const ADS_KEY = "ads:loaders";

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const ADS_TAG = "ads";

// Layout positions a unit can be assigned to. `id` is stored on the unit;
// <AdSlot name={id}> renders at the matching place in the pages.
export const AD_SLOTS = [
  { id: "list-top", label: "Games list — top (above the feed)" },
  { id: "list-bottom", label: "Games list — bottom (below the feed)" },
  { id: "detail", label: "Per-game page" },
  { id: "global", label: "Site-wide (self-placing scripts)" },
];
export const DEFAULT_SLOT = "global";

export function isValidSlot(slot) {
  return AD_SLOTS.some((s) => s.id === slot);
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

// One unit, with safe defaults. Accepts the new {script,slot} shape and the old
// {src} shape (upgraded to a full snippet).
function normalize(item, i) {
  const it = item || {};
  let script = String(it.script || "").trim();
  if (!script && it.src) script = loaderSnippet(String(it.src).trim());
  const slot = isValidSlot(it.slot) ? it.slot : DEFAULT_SLOT;
  return {
    id: String(it.id || `ad-${i + 1}`),
    script,
    label: String(it.label || "").trim().slice(0, 120),
    enabled: it.enabled !== false,
    slot,
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
export async function loadAds() {
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

export async function saveAds(list) {
  const clean = (Array.isArray(list) ? list : []).map(normalize).filter((u) => u.script);
  await kv(["SET", ADS_KEY, JSON.stringify(clean)]);
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
