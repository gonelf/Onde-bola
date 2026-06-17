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

import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

const SDB_KEY = process.env.THESPORTSDB_KEY || "123";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const id = searchParams.get("id");

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
    return Response.json({ error: "Pass ?date=YYYY-MM-DD or ?id=<eventId>" }, { status: 400 });
  }

  // Serve from cache when available.
  const cached = await kv(["GET", key]);
  if (cached) {
    return Response.json(JSON.parse(cached), {
      headers: {
        "X-Cache": "HIT",
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  }

  // Fetch upstream, then cache.
  let data;
  try {
    const r = await fetch(upstream, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    data = await r.json();
  } catch (e) {
    return Response.json({ error: "Upstream fetch failed", detail: String(e) }, { status: 502 });
  }

  await kv(["SET", key, JSON.stringify(data), "EX", String(ttl)]);

  return Response.json(data, {
    headers: {
      "X-Cache": "MISS",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
