/*
 * lib/sitemap-sweep — the SEO URL registry sweep, ported from lib/cron-sitemap.
 *
 * Scans the fixtures feed over a recent + upcoming window and builds a
 * { path: lastmod } map of canonical SEO URLs (match pages + league/edition
 * hubs) for notable competitions. The sitemap route reads the KV registry the
 * cron maintains; before the first cron run it falls back to this live sweep.
 *
 * The KV registry helpers (read/write/prune) live here too so the daily cron
 * (api/cron-sitemap) and the admin endpoint (api/seo) share one implementation.
 */

import { kv } from "./kv";
import { db } from "@/lib/db/client";
import { seoUrls } from "@/lib/db/schema";
import { eq, lt, inArray, sql } from "drizzle-orm";
import { isMigrated, markMigrated } from "@/lib/config-migrate";

const DAYS_BACK = Math.max(0, Number(process.env.SITEMAP_DAYS_BACK) || 3);
const DAYS_AHEAD = Math.max(1, Number(process.env.SITEMAP_DAYS_AHEAD) || 14);

export const REGISTRY = "seo:urls";
const PRUNE_DAYS = Math.max(30, Number(process.env.SITEMAP_PRUNE_DAYS) || 400);

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;

const NOTABLE = new RegExp([
  "premier league", "la ?liga", "serie a", "bundesliga", "ligue 1",
  "primeira liga", "liga portugal", "ta[cç]a de portugal",
  "champions league", "europa league", "conference league", "super cup",
  "world cup", "euro", "nations league", "copa am[eé]rica", "copa del rey",
  "fa cup", "efl cup", "carabao", "coppa italia", "dfb.?pokal", "coupe de france",
  "libertadores", "sul.?americana", "brasileir[aã]o|s[eé]rie a", "copa do brasil",
  "eredivisie", "mls", "saudi pro", "primera",
].join("|"), "i");
const isNotable = (comp) => !!comp && NOTABLE.test(comp);

const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
function editionYear(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + 1 : y;
}
function leagueSlugFor(comp, iso) {
  const base = slugify(comp || "");
  if (comp && EDITION_RE.test(comp)) {
    const y = editionYear(iso);
    if (y) return `${base}-${y}`;
  }
  return base;
}

// opts: { headers } forwards same-origin auth (see lib/forward-auth); { retries }
// re-attempts on a timeout/non-2xx so one slow/blocked upstream response doesn't
// drop a date from the sweep.
async function getJson(url, ms, opts) {
  const { headers, retries = 0 } = opts || {};
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 6000);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: Object.assign({ Accept: "application/json" }, headers || {}),
      });
      if (r.ok) return await r.json();
    } catch (e) {
      // fall through to retry / null
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

export function lisbonYmd(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
export function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Sweep the window into a { path: lastmod } map of canonical SEO URLs. `auth`
// (from lib/forward-auth) keeps the same-origin fixtures fetch authenticated on
// protected preview deployments.
export async function sweep(origin, auth) {
  const today = lisbonYmd(new Date());
  const dates = [];
  for (let i = -DAYS_BACK; i <= DAYS_AHEAD; i++) dates.push(addDays(today, i));

  const feeds = await Promise.all(
    dates.map((d) => getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000, { headers: auth, retries: 1 }))
  );

  const map = {};
  feeds.forEach((feed) => {
    const list = feed && Array.isArray(feed.fixtures) ? feed.fixtures : [];
    list.forEach((f) => {
      if (!f || !f.home || !f.away || !isNotable(f.competition)) return;
      const d = lisbonYmd(new Date(f.kickoff));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const league = leagueSlugFor(f.competition, f.kickoff);
      map[`/g/${league}`] = today; // hub, always "fresh"
      map[`/g/${league}/${d}/${matchSlug(f.home, f.away)}`] = d < today ? d : today;
    });
  });
  return { map, today };
}

// ---- SEO registry (seo:urls → { path: lastmod }) ----
// Backed by Postgres (seo_urls), falling back to the KV hash when the DB is
// unset/unreachable. The first DB read/write backfills the existing KV hash once
// (guarded by a per-store marker; see lib/config-migrate), after which Postgres
// is the source of truth and KV is only the fail-soft fallback.

// --- KV implementations (also the pre-migration / fallback path) ---
async function readRegistryKV() {
  const raw = await kv(["HGETALL", REGISTRY]);
  const reg = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) reg[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(reg, raw);
  return reg;
}
async function registryHasKV(path) {
  const v = await kv(["HGET", REGISTRY, path]);
  return v != null && v !== "";
}
async function writeRegistryKV(map, paths) {
  const args = ["HSET", REGISTRY];
  paths.forEach((p) => args.push(p, map[p]));
  await kv(args);
  return paths.length;
}

// --- DB implementations ---
async function readRegistryDB() {
  const rows = await db.select({ url: seoUrls.url, lastmod: seoUrls.lastmod }).from(seoUrls);
  const reg = {};
  for (const r of rows) reg[r.url] = r.lastmod;
  return reg;
}
async function upsertRegistryDB(map, paths) {
  await db.insert(seoUrls)
    .values(paths.map((p) => ({ url: p, lastmod: String(map[p]) })))
    .onConflictDoUpdate({ target: seoUrls.url, set: { lastmod: sql`excluded.lastmod`, updatedAt: sql`now()` } });
  return paths.length;
}
// One-time copy of the existing KV hash into Postgres (does not clobber rows
// already there, so it's safe to retry).
async function backfillRegistry() {
  const kvReg = await readRegistryKV();
  const paths = Object.keys(kvReg);
  if (paths.length) {
    await db.insert(seoUrls)
      .values(paths.map((p) => ({ url: p, lastmod: String(kvReg[p]) })))
      .onConflictDoNothing();
  }
}

// Read the whole registry as a plain { path: lastmod } object.
export async function readRegistry() {
  if (!db) return readRegistryKV();
  try {
    if (!(await isMigrated(REGISTRY))) { await backfillRegistry(); await markMigrated(REGISTRY); }
    return await readRegistryDB();
  } catch (e) {
    return readRegistryKV();
  }
}

// True when `path` is currently registered. The sweep only records real,
// *notable* match/hub pages, so membership is a trustworthy "this page exists"
// signal — used by the SEO render to keep a known page indexable even when a
// live fixtures fetch momentarily fails (instead of flipping it to noindex).
// Hot path (per /g render): no backfill here — it just reads whichever store is
// live (DB once migrated, else KV).
export async function registryHas(path) {
  if (!path) return false;
  if (!db) return registryHasKV(path);
  try {
    if (!(await isMigrated(REGISTRY))) return await registryHasKV(path);
    const rows = await db.select({ url: seoUrls.url }).from(seoUrls).where(eq(seoUrls.url, path)).limit(1);
    return rows.length > 0;
  } catch (e) {
    return registryHasKV(path);
  }
}

// Upsert a { path: lastmod } map into the registry; returns how many it wrote.
export async function writeRegistry(map) {
  const paths = Object.keys(map || {});
  if (!paths.length) return 0;
  if (!db) return writeRegistryKV(map, paths);
  try {
    if (!(await isMigrated(REGISTRY))) { await backfillRegistry(); await markMigrated(REGISTRY); }
    return await upsertRegistryDB(map, paths);
  } catch (e) {
    if (await isMigrated(REGISTRY)) throw e;
    return writeRegistryKV(map, paths);
  }
}

// Drop entries whose lastmod is older than PRUNE_DAYS before `today`; returns
// the removed paths. Pass an already-read registry to avoid a second read.
export async function pruneRegistry(today, reg) {
  const cutoff = addDays(today, -PRUNE_DAYS);
  if (db) {
    try {
      if (await isMigrated(REGISTRY)) {
        const stale = await db.select({ url: seoUrls.url }).from(seoUrls).where(lt(seoUrls.lastmod, cutoff));
        const paths = stale.map((r) => r.url);
        if (paths.length) await db.delete(seoUrls).where(lt(seoUrls.lastmod, cutoff));
        return paths;
      }
    } catch (e) { /* fall through to KV */ }
  }
  const r = reg || (await readRegistryKV());
  const stale = Object.keys(r).filter((p) => String(r[p]) < cutoff);
  if (stale.length) await kv(["HDEL", REGISTRY].concat(stale));
  return stale;
}

// Remove specific paths from the registry; returns how many were requested.
export async function removeFromRegistry(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (!list.length) return 0;
  if (db) {
    try {
      if (await isMigrated(REGISTRY)) {
        await db.delete(seoUrls).where(inArray(seoUrls.url, list));
        return list.length;
      }
    } catch (e) { /* fall through to KV */ }
  }
  await kv(["HDEL", REGISTRY].concat(list));
  return list.length;
}

// Clear the whole registry.
export async function clearRegistry() {
  if (db) {
    try {
      if (await isMigrated(REGISTRY)) { await db.delete(seoUrls); return; }
    } catch (e) { /* fall through to KV */ }
  }
  await kv(["DEL", REGISTRY]);
}
