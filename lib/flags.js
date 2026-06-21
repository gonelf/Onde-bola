/*
 * Feature flags — per-environment on/off switches the owner can flip from the
 * admin dashboard without a deploy.
 *
 * Each flag holds one of three values:
 *   - "off"        — disabled everywhere
 *   - "staging"    — enabled on staging (preview deploys / local dev) only
 *   - "production" — enabled on production, and on staging too
 * isEnabled() resolves that value against the environment this code is running
 * in (see isProductionEnv) and returns a plain boolean to callers.
 *
 * Stored as { [id]: value } overrides in one KV key; a flag with no stored
 * override falls back to its built-in `default` below, so adding a new flag to
 * FLAG_DEFS doesn't require touching KV first. Legacy boolean overrides/defaults
 * (true/false from the old on/off model) are coerced — true -> "production",
 * false -> "off".
 *
 * Mirrors lib/ads-store.js's shape (KV-backed, unstable_cache + revalidateTag)
 * but is generic — any part of the app can gate behavior on a flag id via
 * isEnabled(), the same way <AdSlot> reads ads-store.
 *
 * --- Adding a new flag, every time ---
 * 1. Add one entry to FLAG_DEFS below: { id, label, description, default }.
 *    `default` is one of FLAG_VALUES ("off" | "staging" | "production").
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

// The three states a flag can hold. Order matters for the admin dropdown.
export const FLAG_VALUES = ["off", "staging", "production"];

// The flags the app actually checks. Add new entries here as needed — each
// one shows up in the admin page automatically. See "Adding a new flag" above.
export const FLAG_DEFS = [
  {
    id: "ads",
    label: "Ads",
    description:
      "Site-wide ad slots (list-top, list-bottom, detail, global) rendered by <AdSlot>. Off hides every placement immediately — a kill switch independent of the ads-manager unit list.",
    default: "production",
  },
  {
    id: "homepage-debug-banner",
    label: "Homepage debug ad banner",
    description:
      "Shows a hardcoded test banner in the homepage footer, bypassing the ads manager entirely — for checking whether a real ad creative renders outside the ad-units pipeline.",
    default: "off",
  },
];

export function isValidFlag(id) {
  return FLAG_DEFS.some((f) => f.id === id);
}

// Coerce any stored/legacy/incoming value to one of FLAG_VALUES, or null if it
// isn't a recognisable flag value. Legacy booleans from the old on/off model
// map true -> "production" (was "on everywhere"), false -> "off".
export function toFlagValue(v) {
  if (v === true) return "production";
  if (v === false) return "off";
  const s = String(v == null ? "" : v).toLowerCase();
  return FLAG_VALUES.includes(s) ? s : null;
}

export function isValidFlagValue(v) {
  return toFlagValue(v) !== null;
}

// Which environment is this code running in? Vercel sets VERCEL_ENV to
// "production" on the production deployment and "preview"/"development"
// elsewhere; we treat everything that isn't production as staging.
export function isProductionEnv() {
  return process.env.VERCEL_ENV === "production";
}

// Resolve a flag value to enabled/disabled for the current environment.
export function resolveFlag(value) {
  const v = toFlagValue(value);
  if (v === "production") return true; // on everywhere
  if (v === "staging") return !isProductionEnv(); // on staging only
  return false; // "off" or unknown
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

// The full list (what the admin page shows/edits): every defined flag, with its
// effective value (stored override, else default) plus `enabled`, that value
// resolved for the environment this code is running in.
export async function loadFlags() {
  const overrides = await loadOverrides();
  return FLAG_DEFS.map((f) => {
    const value = toFlagValue(overrides[f.id]) || toFlagValue(f.default) || "off";
    return { ...f, default: toFlagValue(f.default) || "off", value, enabled: resolveFlag(value) };
  });
}

export async function saveFlags(updates) {
  const overrides = {};
  for (const u of Array.isArray(updates) ? updates : []) {
    const id = String((u && u.id) || "");
    const value = toFlagValue(u && u.value);
    if (isValidFlag(id) && value) overrides[id] = value;
  }
  await kv(["SET", FLAGS_KEY, JSON.stringify(overrides)]);
  return loadFlags();
}

// Cached accessor for server components/pages to gate behavior on a flag
// without per-request dynamic rendering; admin saves bust this via
// revalidateTag(FLAGS_TAG). A deployment runs in a single environment, so
// caching the resolved boolean is safe.
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
