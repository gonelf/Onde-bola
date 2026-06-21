/*
 * Feature flags — simple on/off switches the owner can flip from the admin
 * dashboard without a deploy.
 *
 * Stored as { [id]: boolean } overrides in one KV key *per environment*
 * (production vs staging — see lib/env.js); a flag with no stored override falls
 * back to its built-in `default` below, so adding a new flag to FLAG_DEFS doesn't
 * require touching KV first.
 *
 * Mirrors lib/ads-store.js's shape (KV-backed, unstable_cache + revalidateTag)
 * but is generic — any part of the app can gate behavior on a flag id via
 * isEnabled(), the same way <AdSlot> reads ads-store.
 *
 * --- New feature = on in staging, off in production ---
 * Every new feature ships behind a flag whose default is on in staging and off
 * in production, so it's live for testing on the staging deployment
 * (hojehabola.cfd / STAGING_HOST) the moment it merges, and dark in production
 * until the owner flips it on at /admin/flags. Express that with the
 * NEW_FEATURE_DEFAULT shape:
 *
 *      { id, label, description, default: NEW_FEATURE_DEFAULT }
 *
 * A `default` may be a plain boolean (same value in both environments) or an
 * object { staging, production } (per-environment), which is what
 * NEW_FEATURE_DEFAULT is.
 *
 * --- Adding a new flag, every time ---
 * 1. Add one entry to FLAG_DEFS below: { id, label, description, default }.
 *    Use NEW_FEATURE_DEFAULT for a new feature. That's the only schema change
 *    needed — /api/flags and /admin/flags read this list, so the new flag shows
 *    up there automatically.
 * 2. At the gate point (a server component, page, or route handler), check it:
 *      import { isEnabled } from "@/lib/flags";
 *      if (!(await isEnabled("your-flag-id"))) return null; // or skip the branch
 *    isEnabled() is cached (same revalidate window as the rest of the admin
 *    surface) and fails closed to false on any error, so it's safe to call
 *    without extra error handling. It resolves against the current environment.
 * No changes needed to middleware.js, app/api/flags/route.js, or
 * public/admin/flags.html — they're all generic over FLAG_DEFS.
 */

import { kv } from "@/lib/kv";
import { unstable_cache } from "next/cache";
import { currentEnv, ENV_STAGING } from "@/lib/env";

// Production overrides keep the original key (back-compat); staging gets its own
// so toggling a flag on one deployment never bleeds into the other, even when
// both share a single KV store.
export const FLAGS_KEY = "flags:overrides";

export function flagsKey(env) {
  return env === ENV_STAGING ? `${FLAGS_KEY}:staging` : FLAGS_KEY;
}

// Tag the cached read so an admin save can bust it immediately (revalidateTag).
export const FLAGS_TAG = "flags";

// The default for a brand-new feature: live in staging, dark in production.
export const NEW_FEATURE_DEFAULT = { staging: true, production: false };

// The flags the app actually checks. Add new entries here as needed — each
// one shows up in the admin page automatically. See "Adding a new flag" above.
// Use `default: NEW_FEATURE_DEFAULT` for new features.
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
];

export function isValidFlag(id) {
  return FLAG_DEFS.some((f) => f.id === id);
}

// Resolve a flag def's default for an environment. Accepts a plain boolean
// (same in both) or a { staging, production } object (per-environment).
export function resolveDefault(def, env) {
  const d = def && def.default;
  if (d && typeof d === "object") {
    return env === ENV_STAGING ? !!d.staging : !!d.production;
  }
  return !!d;
}

async function loadOverrides(env) {
  const raw = await kv(["GET", flagsKey(env)]);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

// Cached per-environment override map; admin saves bust it via
// revalidateTag(FLAGS_TAG). The env argument is part of the cache key, so
// staging and production are cached separately.
const cachedOverrides = unstable_cache(
  async (env) => loadOverrides(env),
  ["flags:overrides"],
  { revalidate: 300, tags: [FLAGS_TAG] }
);

// The full list (what the admin page shows/edits): every defined flag, with its
// effective (stored override, else env default) value for the given environment.
export async function loadFlags(env) {
  const e = env || (await currentEnv());
  const overrides = await loadOverrides(e);
  return FLAG_DEFS.map((f) => {
    const def = resolveDefault(f, e);
    return {
      ...f,
      default: def,
      enabled: typeof overrides[f.id] === "boolean" ? overrides[f.id] : def,
    };
  });
}

export async function saveFlags(updates, env) {
  const e = env || (await currentEnv());
  const overrides = {};
  for (const u of Array.isArray(updates) ? updates : []) {
    const id = String((u && u.id) || "");
    if (isValidFlag(id)) overrides[id] = !!(u && u.enabled);
  }
  await kv(["SET", flagsKey(e), JSON.stringify(overrides)]);
  return loadFlags(e);
}

// Cached accessor for server components/pages to gate behavior on a flag
// without per-request dynamic rendering; admin saves bust this via
// revalidateTag(FLAGS_TAG). Resolves against the current environment, so the
// same flag id can be on in staging and off in production.
export async function isEnabled(id) {
  try {
    const env = await currentEnv();
    const def = FLAG_DEFS.find((x) => x.id === id);
    if (!def) return false;
    const overrides = await cachedOverrides(env);
    return typeof overrides[id] === "boolean" ? overrides[id] : resolveDefault(def, env);
  } catch (e) {
    return false;
  }
}
