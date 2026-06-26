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
 * KV-backed like lib/ads-store.js, but generic — any part of the app can gate
 * behavior on a flag id via isEnabled(), the same way <AdSlot> reads ads-store.
 * Unlike ads/overrides, flags are NOT time-cached: they're read fresh per
 * request (request-deduped via React cache()) so an admin save is live at once.
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
import { cache } from "react";
import { headers } from "next/headers";
import { normalizeHost } from "@/lib/brand";

export const FLAGS_KEY = "flags:overrides";

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
      "Ad slots (home-top, home-bottom, fixtures-feed, detail-top, detail-bottom) rendered by <AdSlot> and the in-feed/detail injections. Off hides every placement immediately — a kill switch independent of the ads-manager unit list.",
    default: "production",
  },
  {
    id: "homepage-debug-banner",
    label: "Homepage debug ad banner",
    description:
      "Shows a hardcoded test banner in the homepage footer, bypassing the ads manager entirely — for checking whether a real ad creative renders outside the ad-units pipeline.",
    default: "off",
  },
  {
    id: "game",
    label: "Manager game",
    description:
      "The fantasy-meets-Elifoot football manager mode (accounts, squads, leagues, async PvP) under /fantasygame. Off hides the whole mode: the (game) route group 404s, its APIs are unreachable, and the season cron tick no-ops. Flip on to open the beta without a redeploy.",
    default: false,
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

// Flags are read fresh on every request (no time-based cache) so an admin save
// is live immediately. React's cache() only de-dupes within a single render —
// several isEnabled() calls in one request (e.g. multiple <AdSlot>s) share one
// KV read — without holding the value across requests.
const requestFlags = cache(loadFlags);

export async function isEnabled(id) {
  try {
    const flags = await requestFlags();
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
