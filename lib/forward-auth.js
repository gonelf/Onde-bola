/*
 * lib/forward-auth — pick the subset of an incoming request's headers that
 * authenticate a *same-origin internal fetch*: the cookie (Vercel preview
 * protection sets `_vercel_jwt`) and the explicit protection-bypass
 * header/secret. Everything else is dropped so the internal call stays a clean
 * JSON request.
 *
 * Without these, a server-side `fetch(\`${origin}/api/…\`)` hits Deployment
 * Protection's auth wall on preview deployments and silently gets an empty body
 * — which, for the SEO render + sitemap sweep, flips real pages to `noindex` and
 * empties the sitemap. Production (unprotected) is unaffected; the headers are
 * simply absent and this returns {}.
 *
 * Accepts any Headers-like with a `.get()` (Web `Headers`, Next's
 * `ReadonlyHeaders` from `headers()`, or a route handler's `request.headers`).
 */
export function forwardAuthHeaders(reqHeaders) {
  const out = {};
  if (!reqHeaders || typeof reqHeaders.get !== "function") return out;
  const cookie = reqHeaders.get("cookie");
  if (cookie) out.cookie = cookie;
  const bypass = reqHeaders.get("x-vercel-protection-bypass");
  if (bypass) out["x-vercel-protection-bypass"] = bypass;
  const set = reqHeaders.get("x-vercel-set-bypass-cookie");
  if (set) out["x-vercel-set-bypass-cookie"] = set;
  return out;
}
