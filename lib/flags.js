/*
 * Feature flags — a per-environment switch the owner can flip from the admin
 * dashboard without a deploy.
 *
 * Each flag is one of four states, naming exactly where the flag is ON:
 *   "off"         → on nowhere
 *   "dev"         → on only in local dev (localhost / 127.0.0.1)
 *   "staging"     → on only on the staging environment (hojehabola.cfd)
 *   "production"  → on everywhere (all hosts)
 *
 * The environment is resolved per-request from the host (see currentEnv):
 *   localhost / 127.0.0.1 → "dev"
 *   hojehabola.cfd        → "staging"
 *   any other host        → "production" (hojehabola.com, footietoday.com, …)
 *
 * "dev" and "staging" are EXACT matches — a "staging" flag is off on localhost
 * and off in production; a "dev" flag is off on staging and production. Only
 * "production" is on across all hosts.
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
 *    `default` is a state string ("off" | "dev" | "staging" | "production").
 *    That's the only schema change needed — /api/flags and /admin/flags read
 *    this list, so the new flag shows up there automatically.
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

// The states a flag can take. Order matters for the admin UI (rendered in this
// order). "dev" and "staging" are exact-host matches; "production" is everywhere.
export const FLAG_STATES = ["off", "dev", "staging", "production"];

// Host → environment mapping. Anything not listed here is "production".
export const STAGING_HOST = "hojehabola.cfd";
const HOST_ENV = {
  localhost: "dev",
  "127.0.0.1": "dev",
  [STAGING_HOST]: "staging",
};

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

// Resolve the current environment ("dev" | "staging" | "production") from the
// request host. Fails closed to "production" (so only an explicit "production"
// flag is on there) if headers are unavailable.
export async function currentEnv() {
  try {
    const h = await headers();
    const host = normalizeHost(h.get("x-forwarded-host") || h.get("host") || "");
    return HOST_ENV[host] || "production";
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
    if (f.state === "production") return true; // on every host
    if (f.state === "off") return false;
    // "dev" / "staging" — on only when the current environment matches exactly.
    return f.state === (await currentEnv());
  } catch (e) {
    return false;
  }
}
