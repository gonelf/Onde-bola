/*
 * /sitemap.xml — reads the SEO URL registry (KV hash `seo:urls` → path:lastmod)
 * the daily cron maintains, falling back to a one-off live sweep before the
 * first cron run. Ported from lib/sitemap.js.
 */

import { headers } from "next/headers";
import { kv } from "@/lib/kv";
import { sweep, lisbonYmd } from "@/lib/sitemap-sweep";

export const dynamic = "force-dynamic";

const REGISTRY = "seo:urls";
const MAX_URLS = 45000;

function xesc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function classify(path) {
  if (path === "/") return { priority: "1.0", changefreq: "hourly" };
  const segs = path.split("/").filter(Boolean);
  if (segs.length <= 2) return { priority: "0.8", changefreq: "daily" }; // hub
  return { priority: "0.6", changefreq: "daily" }; // match
}

export async function GET() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;
  const today = lisbonYmd(new Date());

  let entries = {};
  const raw = await kv(["HGETALL", REGISTRY]);
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) entries[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(entries, raw);

  if (!Object.keys(entries).length) {
    const swept = await sweep(origin).catch(() => null);
    if (swept && swept.map) entries = swept.map;
  }

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

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
