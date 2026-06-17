/*
 * Minimal Vercel KV (Upstash Redis REST) command runner, shared by the API
 * routes. Returns the command result, or null when KV isn't configured or the
 * request fails — every caller treats KV as a best-effort cache, never a hard
 * dependency. (Extracted from the per-endpoint kv() helpers in the old api/*.)
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const kvConfigured = !!(KV_URL && KV_TOKEN);

export async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (e) {
    return null;
  }
}
