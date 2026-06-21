/*
 * Environment helper — tells the rest of the app whether the current request is
 * running against the **staging** deployment or **production**.
 *
 * This is what makes the "new feature = on in staging, off in production"
 * convention work: feature-flag defaults (lib/flags.js) are resolved against the
 * environment returned here.
 *
 * Detection, in priority order:
 *   1. APP_ENV (or NEXT_PUBLIC_APP_ENV) = "staging" | "production" — an explicit
 *      per-deployment override. Set APP_ENV=staging in the staging deployment's
 *      env and nothing else is needed; no request is read, so flag-gated pages
 *      stay static/ISR-friendly. This is the recommended setup.
 *   2. Host match — if APP_ENV is unset, the request host is compared against
 *      STAGING_HOST (default "hojehabola.cfd"). The staging domain is an env var
 *      so it can change without a code edit. Reading the host opts the caller
 *      into dynamic rendering, so prefer APP_ENV when you care about ISR.
 *   3. Vercel preview deployments (VERCEL_ENV=preview) are treated as staging.
 *
 * Falls back to "production" when nothing matches — fail safe, so a new feature
 * never lights up in production by accident.
 */

import { headers } from "next/headers";

export const ENV_STAGING = "staging";
export const ENV_PRODUCTION = "production";

// The staging domain, configurable via env so it isn't hardcoded. Defaults to
// the project's staging domain. Compared against the request host in (2) above.
export const STAGING_HOST = (process.env.STAGING_HOST || "hojehabola.cfd")
  .trim()
  .toLowerCase();

function normalizeHost(host) {
  return String(host || "").trim().toLowerCase().split(":")[0];
}

// Does this host belong to the staging domain (exact match or a subdomain)?
export function isStagingHost(host) {
  const h = normalizeHost(host);
  if (!h || !STAGING_HOST) return false;
  return h === STAGING_HOST || h.endsWith("." + STAGING_HOST);
}

// Explicit env override (APP_ENV / NEXT_PUBLIC_APP_ENV), or null if unset.
function explicitEnv() {
  const v = (process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || "")
    .trim()
    .toLowerCase();
  if (v === "staging" || v === "stage") return ENV_STAGING;
  if (v === "production" || v === "prod") return ENV_PRODUCTION;
  return null;
}

// Resolve the current environment. Async because the host fallback reads the
// request headers (Next 15's headers() is async).
export async function currentEnv() {
  const explicit = explicitEnv();
  if (explicit) return explicit;

  // Host-based detection (staging domain configurable via STAGING_HOST).
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || "";
    if (isStagingHost(host)) return ENV_STAGING;
  } catch (e) {
    // headers() unavailable outside a request scope — fall through.
  }

  // Vercel preview builds behave like staging.
  if ((process.env.VERCEL_ENV || "").trim().toLowerCase() === "preview") {
    return ENV_STAGING;
  }

  return ENV_PRODUCTION;
}

export async function isStaging() {
  return (await currentEnv()) === ENV_STAGING;
}
