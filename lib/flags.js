/*
 * Feature flags — a per-environment rollout ladder the owner can flip from the
 * admin dashboard without a deploy.
 *
 * Each flag is one of three states, ordered as a promote-up ladder:
 *   "off"         → on nowhere
 *   "staging"     → on only on the staging environment
 *   "production"  → on everywhere (staging + production)
 *
 * The environment is resolved per-request from the host (see currentEnv): the
 * staging domain (and local dev) count as "staging"; every public domain
 * (hojehabola.com, footietoday.com, …) counts as "production". So a flag set to
 * "staging" can be exercised on the staging site before being promoted to
 * "production" for the live audience.
 *
 * Stored as { [id]: state } overrides in one KV key; a flag with no stored
 * override falls back to its built-in `default` below, so adding a new flag
 * to FLAG_DEFS doesn't require touching KV first. Legacy boolean overrides
 * (from the old on/off scheme) are read as true→"production", false→"off".
 *
 * Mirrors lib/ads-store.js's shape (KV-backed, unstable_cache + revalidateTag)
 * but is generic — any part of the app can gate behavior on a flag id via
 * isEnabled(), the same way <AdSlot> reads ads-store.
 *
 * --- Adding a new flag, every time ---
 * 1. Add one entry to FLAG_DEFS below: { id, label, description, default }.
 *    `default` is a state string ("off" | "staging" | "production"). That's the
 *    only schema change needed — /api/flags and /admin/flags read this list, so
 *    the new flag shows up there automatically.
 * 2. At the gate point (a server component, page, or route handler), check it:
 *      import { isEnabled } from "@/lib/flags";
 *      if (!(await isEnabled("your-flag-id"))) return null; // or skip the branch
 *    isEnabled() resolves the flag's state and the current environment, fails
 *    closed to false on any error, and reads request headers — so calling it
 *    opts the surrounding component into dynamic rendering.
 * No changes needed to middleware.js, app/api/flags/route.js, or
 * public/admin/flags.html — they're all generic over FLAG_DEFS.
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { normalizeHost } from "@/lib/brand";

export const FLAGS_KEY = "flags:overrides";

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const FLAGS_TAG = "flags";

// The rollout ladder, from least to most exposed. The order matters for the
// admin UI (it renders them in this order).
export const FLAG_STATES = ["off", "staging", "production"];

// Hosts that count as the staging environment. Everything else is production.
// Local dev (localhost / 127.0.0.1) is treated as staging too, so "staging"
// flags light up while developing.
export const STAGING_HOST = "hojehabola.cfd";
const STAGING_HOSTS = new Set([STAGING_HOST, "localhost", "127.0.0.1"]);

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

export function isValidState(state) {
  return FLAG_STATES.includes(state);
}

// Coerce a stored/incoming value into a valid state string, tolerating the
// legacy boolean scheme (true→"production", false→"off"). Returns `fallback`
// for anything unrecognised.
export function normalizeState(value, fallback) {
  if (isValidState(value)) return value;
  if (value === true) return "production";
  if (value === false) return "off";
  return fallback;
}

// Resolve the current environment ("staging" | "production") from the request
// host. Fails closed to "production" (the most conservative — only an explicit
// "production" flag is on there) if headers are unavailable.
export async function currentEnv() {
  try {
    const h = await headers();
    const host = normalizeHost(h.get("x-forwarded-host") || h.get("host") || "");
    return STAGING_HOSTS.has(host) ? "staging" : "production";
  } catch (e) {
    return "production";
  }
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
// its effective (stored override, else default) state.
export async function loadFlags() {
  const overrides = await loadOverrides();
  return FLAG_DEFS.map((f) => ({
    ...f,
    state: normalizeState(overrides[f.id], f.default),
  }));
}

export async function saveFlags(updates) {
  const overrides = {};
  for (const u of Array.isArray(updates) ? updates : []) {
    const id = String((u && u.id) || "");
    if (!isValidFlag(id)) continue;
    // Accept the new `state`, or a legacy `enabled` boolean.
    const state = normalizeState(u && "state" in u ? u.state : u && u.enabled, null);
    if (state) overrides[id] = state;
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
    if (!f) return false;
    if (f.state === "production") return true; // on everywhere
    if (f.state === "staging") return (await currentEnv()) === "staging";
    return false; // "off" (or anything unexpected)
  } catch (e) {
    return false;
  }
}
