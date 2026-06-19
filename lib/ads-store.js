/*
 * Ad-loader store — the list of third-party ad-network loader snippets the app
 * injects on the fixtures list (home) and the per-game detail pages.
 *
 * The loaders all share one self-inserting IIFE wrapper (see loaderScript); the
 * only thing that varies between units is the script src the network gives you.
 * So the store keeps just the srcs (plus an optional label and an enabled flag)
 * and the wrapper is rebuilt at render time.
 *
 * Stored in one KV key, exactly like lib/overrides. When nothing has been saved
 * yet (e.g. KV isn't configured) the built-in defaults below are used, so ads
 * keep working out of the box and the admin page can see/edit the live units.
 *
 * Shape: ads:loaders -> [ { id, src, label, enabled } ]
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";

export const ADS_KEY = "ads:loaders";

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const ADS_TAG = "ads";

// The loaders that shipped hardcoded in components/Ads.jsx — used as the
// fallback until the owner configures their own list from the admin page.
export const DEFAULT_AD_SRCS = [
  "//massivesalad.com/b.X/VZs/d/GClx0jY_W_ch/gebml9Yu-ZtUIlLk/PDTwcbxfNvDIkQ5xNwjpE/tFNvziEi0tO/TVkd2jNiQh",
  "//massivesalad.com/bGXBVas/d.G/lL0zYdWgcx/UeVm_9_uKZiULlPkhPET/cexRNGDukV5eN/Dpk/tzNSzgEZ0cO/TqkU1vMAwy",
  "//massivesalad.com/bpXFVpsYd.Gfl/0NYSWGcC/EeQme9PuqZgUmlDkIPtTsccxDN/Dhk/5dNoj/ENtaNAzrEb0_OhTPkr2BN_Qh",
  "//massivesalad.com/btXTV.sLd/G/lx0yYlWQcD/EeWmQ9RuRZFUJlhkPPfTucwxRNdD/kw5/NRDBk-tlNZzaEo0TOeTSk/1qM/wh",
];

// Reject anything that isn't a plain network URL. These srcs are injected into a
// <script> string, so we also bar whitespace and the few characters that could
// break out of the string literal or the surrounding tag. Admin-gated, but
// cheap defence in depth.
export function isValidAdSrc(src) {
  const s = String(src == null ? "" : src).trim();
  if (!s || s.length > 2048) return false;
  if (/[\s<>"'`\\]/.test(s)) return false;
  return /^(https?:)?\/\/[^/]+\/.+/.test(s);
}

// One ad unit, with safe defaults for missing fields.
function normalize(item, i) {
  return {
    id: String((item && item.id) || `ad-${i + 1}`),
    src: String((item && item.src) || "").trim(),
    label: String((item && item.label) || "").trim().slice(0, 120),
    enabled: !item || item.enabled !== false,
  };
}

// Wrap a loader src in the ad network's self-inserting IIFE — the exact snippet
// they ship, only the src differs. JSON.stringify keeps the src safely quoted.
export function loaderScript(src) {
  return `(function(s){
var d = document,
    a = d.createElement('script'),
    l = d.scripts[d.scripts.length - 1];
a.settings = s || {};
a.src = ${JSON.stringify(String(src))};
a.async = true;
a.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(a, l);
})({})`;
}

// The full managed list (what the admin page shows/edits). Falls back to the
// built-in defaults when nothing meaningful is stored — i.e. the key is unset
// OR an empty list was saved. (Empty == "not configured", so saving an empty
// list can't silently wipe all ads; to run zero ads, keep the units but toggle
// them off.)
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
  const list = (stored && stored.length) ? stored : DEFAULT_AD_SRCS.map((src) => ({ src }));
  return list.map(normalize);
}

export async function saveAds(list) {
  const clean = (Array.isArray(list) ? list : []).map(normalize);
  await kv(["SET", ADS_KEY, JSON.stringify(clean)]);
  return clean;
}

// The enabled srcs to actually render. Cached so the statically-generated home
// page can read ad config without opting into per-request dynamic rendering;
// admin saves bust this via revalidateTag(ADS_TAG).
export const activeAdSrcs = unstable_cache(
  async () => {
    const list = await loadAds();
    return list.filter((a) => a.enabled && a.src).map((a) => a.src);
  },
  ["ads:active-srcs"],
  { revalidate: 300, tags: [ADS_TAG] }
);
