/*
 * /api/tv — cached proxy for TheSportsDB TV listings.
 *
 * Fetches real per-match broadcast channels and caches them in a Vercel KV
 * (Upstash Redis) store so repeated page loads / visitors don't re-hit the
 * upstream API. Works without a DB too (pass-through), and the client falls
 * back to calling TheSportsDB directly if this function isn't deployed.
 *
 * Query:
 *   ?date=YYYY-MM-DD  -> the day's soccer TV schedule (eventstv.php)
 *   ?id=<eventId>     -> one event's TV broadcasts (lookuptv.php)
 *
 * Env:
 *   THESPORTSDB_KEY                         (optional, defaults to free "123")
 *   KV_REST_API_URL / KV_REST_API_TOKEN     (optional, enables caching)
 */

const SDB_KEY = process.env.THESPORTSDB_KEY || "123";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result;
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  const { date, id } = req.query || {};

  let upstream, key, ttl;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    upstream = `https://www.thesportsdb.com/api/v1/json/${SDB_KEY}/eventstv.php?d=${date}&s=Soccer`;
    key = `tv:date:${date}`;
    const today = new Date().toISOString().slice(0, 10);
    ttl = date === today ? 600 : (date < today ? 86400 : 3600); // live day short, past long
  } else if (id && /^\d+$/.test(id)) {
    upstream = `https://www.thesportsdb.com/api/v1/json/${SDB_KEY}/lookuptv.php?id=${id}`;
    key = `tv:id:${id}`;
    ttl = 3600;
  } else {
    res.status(400).json({ error: "Pass ?date=YYYY-MM-DD or ?id=<eventId>" });
    return;
  }

  // Serve from cache when available.
  const cached = await kv(["GET", key]);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(JSON.parse(cached));
    return;
  }

  // Fetch upstream, then cache.
  let data;
  try {
    const r = await fetch(upstream, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    data = await r.json();
  } catch (e) {
    res.status(502).json({ error: "Upstream fetch failed", detail: String(e) });
    return;
  }

  await kv(["SET", key, JSON.stringify(data), "EX", String(ttl)]);

  res.setHeader("X-Cache", "MISS");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  res.status(200).json(data);
};
