/*
 * /api/highlights — read the highlights collected by /api/cron-highlights.
 *
 * The cron sweep writes a per-day map `hl:day:<date>` of finished matches with
 * their highlight links. This endpoint just reads those maps back as a flat,
 * most-recent-first feed for the client (or any consumer).
 *
 * Query:
 *   ?date=YYYY-MM-DD   -> that day's highlights
 *   (none)             -> today + yesterday merged (default 2 days, max 7 via &days=)
 *   &withUrl=1         -> only matches that have a real FotMob clip URL
 * Returns: { ok, dates, count, highlights: [ { fmid, home, away, competition,
 *            date, kickoff, score, url, source, youtube, ... } ] }
 *
 * Env: KV_REST_API_URL / KV_REST_API_TOKEN (without KV there is nothing to read).
 */

import { kv, kvConfigured } from "@/lib/kv";

export const dynamic = "force-dynamic";

const str = (x) => (x == null ? "" : String(x)).trim();
const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch (e) { return fallback; } };

export async function GET(request) {
  const swr = "public, s-maxage=300, stale-while-revalidate=1800";

  if (!kvConfigured) {
    return Response.json({ ok: false, error: "KV not configured", highlights: [] }, {
      headers: { "Cache-Control": swr },
    });
  }

  const { searchParams } = new URL(request.url);
  const onlyWithUrl = (searchParams.get("withUrl") === "1" || searchParams.get("withUrl") === "true");

  let dates;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str(searchParams.get("date")))) {
    dates = [str(searchParams.get("date"))];
  } else {
    const days = Math.min(7, Math.max(1, Number(searchParams.get("days")) || 2));
    dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
  }

  const items = [];
  for (const date of dates) {
    const raw = await kv(["GET", `hl:day:${date}`]);
    const map = safe(() => JSON.parse(raw), null);
    if (map && typeof map === "object") {
      Object.keys(map).forEach((fmid) => {
        const rec = map[fmid];
        if (!rec) return;
        if (onlyWithUrl && !rec.url) return;
        items.push(rec);
      });
    }
  }

  // Most recent kickoff first so the freshest finishes lead the feed.
  items.sort((a, b) => str(b.kickoff).localeCompare(str(a.kickoff)));

  return Response.json({ ok: true, dates, count: items.length, highlights: items }, {
    headers: { "Cache-Control": swr },
  });
}
