/*
 * Feature flags — simple on/off switches the owner can flip from the admin
 * dashboard without a deploy.
 *
 * Stored as { [id]: boolean } overrides in one KV key; a flag with no stored
 * override falls back to its built-in `default` below, so adding a new flag
 * to FLAG_DEFS doesn't require touching KV first.
 *
 * Mirrors lib/ads-store.js's shape (KV-backed, unstable_cache + revalidateTag)
 * but is generic — any part of the app can gate behavior on a flag id via
 * isEnabled(), the same way <AdSlot> reads ads-store.
 *
 * --- Adding a new flag, every time ---
 * 1. Add one entry to FLAG_DEFS below: { id, label, description, default }.
 *    That's the only schema change needed — /api/flags and /admin/flags read
 *    this list, so the new flag shows up there automatically.
 * 2. At the gate point (a server component, page, or route handler), check it:
 *      import { isEnabled } from "@/lib/flags";
 *      if (!(await isEnabled("your-flag-id"))) return null; // or skip the branch
 *    isEnabled() is cached (same revalidate window as the rest of the admin
 *    surface) and fails closed to false on any error, so it's safe to call
 *    without extra error handling.
 * No changes needed to middleware.js, app/api/flags/route.js, or
 * public/admin/flags.html — they're all generic over FLAG_DEFS.
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";

export const FLAGS_KEY = "flags:overrides";

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const FLAGS_TAG = "flags";

// The flags the app actually checks. Add new entries here as needed — each
// one shows up in the admin page automatically. See "Adding a new flag" above.
export const FLAG_DEFS = [
  {
    id: "ads",
    label: "Ads",
    description:
      "Site-wide ad slots (list-top, list-bottom, detail, global) rendered by <AdSlot>. Off hides every placement immediately — a kill switch independent of the ads-manager unit list.",
    default: true,
  },
  {
    id: "homepage-debug-banner",
    label: "Homepage debug ad banner",
    description:
      "Shows a hardcoded test banner in the homepage footer, bypassing the ads manager entirely — for checking whether a real ad creative renders outside the ad-units pipeline.",
    default: false,
  },
  {
    id: "game",
    label: "Manager game",
    description:
      "The fantasy-meets-Elifoot football manager mode (accounts, squads, leagues, async PvP) under /play. Off hides the whole mode: the (game) route group 404s, its APIs are unreachable, and the season cron tick no-ops. Flip on to open the beta without a redeploy.",
    default: false,
  },
];

export function isValidFlag(id) {
  return FLAG_DEFS.some((f) => f.id === id);
}

async function loadOverrides() {
  const raw = await kv(["GET", FLAGS_KEY]);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

// The full list (what the admin page shows/edits): every defined flag, with
// its effective (stored override, else default) value.
export async function loadFlags() {
  const overrides = await loadOverrides();
  return FLAG_DEFS.map((f) => ({
    ...f,
    enabled: typeof overrides[f.id] === "boolean" ? overrides[f.id] : f.default,
  }));
}

export async function saveFlags(updates) {
  const overrides = {};
  for (const u of Array.isArray(updates) ? updates : []) {
    const id = String((u && u.id) || "");
    if (isValidFlag(id)) overrides[id] = !!(u && u.enabled);
  }
  await kv(["SET", FLAGS_KEY, JSON.stringify(overrides)]);
  return loadFlags();
}

// Cached accessor for server components/pages to gate behavior on a flag
// without per-request dynamic rendering; admin saves bust this via
// revalidateTag(FLAGS_TAG).
const cachedFlags = unstable_cache(loadFlags, ["flags:effective"], {
  revalidate: 300,
  tags: [FLAGS_TAG],
});

export async function isEnabled(id) {
  try {
    const flags = await cachedFlags();
    const f = flags.find((x) => x.id === id);
    return f ? f.enabled : false;
  } catch (e) {
    return false;
  }
}
