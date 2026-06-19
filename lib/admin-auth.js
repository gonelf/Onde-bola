/*
 * Shared HTTP Basic Auth check for the admin surface (the /admin.html page and
 * the override API). Credentials come from env: ADMIN_USER / ADMIN_PASSWORD.
 *
 * Fail-closed for writes: when the credentials aren't configured, isAdmin()
 * returns false, so the override endpoint refuses to do anything until the owner
 * sets the env vars. (The edge middleware separately leaves the page un-gated
 * until creds exist, so the read-only debug tool keeps working out of the box.)
 *
 * Works in both the Node runtime (API routes, Buffer) and the Edge runtime
 * (middleware, atob) — decode is done by the caller and passed in, or we detect.
 */

export function adminCredsConfigured() {
  return !!(process.env.ADMIN_USER && process.env.ADMIN_PASSWORD);
}

// Decode a Basic Authorization header value to "user:pass", runtime-agnostic.
function decodeBasic(header) {
  const [scheme, encoded] = String(header || "").split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  try {
    if (typeof atob === "function") return atob(encoded);
    // eslint-disable-next-line no-undef
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch (e) {
    return null;
  }
}

// Constant-ish comparison so a wrong length/char doesn't short-circuit early.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isAdmin(request) {
  const USER = process.env.ADMIN_USER, PASS = process.env.ADMIN_PASSWORD;
  if (!USER || !PASS) return false;
  const decoded = decodeBasic(request.headers.get("authorization"));
  if (decoded == null) return false;
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  return safeEqual(decoded.slice(0, idx), USER) && safeEqual(decoded.slice(idx + 1), PASS);
}
