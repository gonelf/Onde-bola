/*
 * sitemap  (public path: /sitemap.xml) — reads the SEO URL registry.
 * Dispatched by api/share.js on `?sitemap=1` (it isn't its own function, to
 * stay under the platform's per-deployment function limit).
 *
 * The homepage cards are client-rendered, so crawlers can't reliably discover
 * the /g/<league> hubs and /g/<league>/<date>/<home>-vs-<away> match pages by
 * following links. This emits them from a KV registry (`seo:urls` → path:
 * lastmod) that the daily cron keeps current — so the sitemap is consistent
 * and incremental: a match doesn't vanish once it scrolls out of the live
 * window, and lastmod is frozen to the match date once the game is in the past.
 *
 * Read-only: the daily cron owns writes. Before the first cron run (or with no
 * KV configured) it falls back to a one-off read-only sweep of the fixtures
 * feed, so the sitemap is never empty.
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REGISTRY = "seo:urls";
const MAX_URLS = 45000; // stay under the 50k-per-sitemap limit

const { sweep } = require("./cron-sitemap.js");

function xesc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (e) { return null; }
}

function todayLisbon() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// path depth → sitemap weighting. /g/<league> is a hub; /g/<league>/<date>/<m> a match.
function classify(path) {
  if (path === "/") return { priority: "1.0", changefreq: "hourly" };
  const segs = path.split("/").filter(Boolean);
  if (segs.length <= 2) return { priority: "0.8", changefreq: "daily" }; // hub
  return { priority: "0.6", changefreq: "daily" }; // match
}

module.exports = async (req, res) => {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;
  const today = todayLisbon();

  // Read the registry the cron maintains.
  let entries = {};
  const raw = await kv(["HGETALL", REGISTRY]);
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) entries[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(entries, raw);

  // Nothing persisted yet (or no KV): fall back to a read-only live sweep so the
  // sitemap is never empty before the first cron run.
  if (!Object.keys(entries).length) {
    const swept = await sweep(origin).catch(() => null);
    if (swept && swept.map) entries = swept.map;
  }

  // Hubs before matches, each group newest-first.
  const urls = Object.keys(entries).sort((a, b) => {
    const da = a.split("/").filter(Boolean).length, db = b.split("/").filter(Boolean).length;
    if (da !== db) return da - db;
    return entries[b] < entries[a] ? -1 : entries[b] > entries[a] ? 1 : (a < b ? -1 : 1);
  });

  const urlTag = (path, lastmod) => {
    const { priority, changefreq } = classify(path);
    return `  <url>\n    <loc>${xesc(origin + path)}</loc>\n` +
      (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "") +
      `    <changefreq>${changefreq}</changefreq>\n` +
      `    <priority>${priority}</priority>\n  </url>`;
  };

  const parts = [urlTag("/", today)];
  for (const path of urls) {
    if (parts.length >= MAX_URLS) break;
    parts.push(urlTag(path, entries[path]));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    parts.join("\n") + `\n</urlset>\n`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(xml);
};
