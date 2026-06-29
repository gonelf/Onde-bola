/*
 * Manual TV-listing overrides — the highest-trust source.
 *
 * Some matches have no listing in any free feed for a given country (e.g.
 * FotMob's Portugal feed occasionally omits a single World Cup game while
 * carrying all the others, and SofaScore is blocked from the server). The admin
 * page lets the owner attach broadcasters to a match by hand; they're stored in
 * one KV key and merged into the listings store (at build time) and the read
 * path (instantly), exactly like any other source.
 *
 * Shape: tv:overrides -> { <fmid>: { date, home, away, rows:[{country,channel}], updatedAt } }
 */

import { kv } from "@/lib/kv";
import { db } from "@/lib/db/client";
import { tvOverrides } from "@/lib/db/schema";
import { isMigrated, markMigrated } from "@/lib/config-migrate";

export const OVERRIDES_KEY = "tv:overrides";

// --- Backed by Postgres (tv_overrides, one row per match), falling back to KV ---
// when the DB is unset/unreachable. First DB read backfills the existing KV map
// once; see lib/config-migrate.

async function loadOverridesKV() {
  const raw = await kv(["GET", OVERRIDES_KEY]);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

async function readOverridesDB() {
  const rows = await db.select().from(tvOverrides);
  const map = {};
  for (const r of rows) {
    map[r.fmid] = { date: r.date || "", home: r.home || "", away: r.away || "", rows: r.rows || [], updatedAt: r.updatedAt };
  }
  return map;
}

// Replace the whole set in a transaction (the admin saves the full map).
async function writeOverridesDB(map) {
  const m = (map && typeof map === "object") ? map : {};
  const values = Object.keys(m).map((fmid) => {
    const o = m[fmid] || {};
    return { fmid: String(fmid), date: o.date || null, home: o.home || null, away: o.away || null, rows: Array.isArray(o.rows) ? o.rows : [] };
  });
  await db.transaction(async (tx) => {
    await tx.delete(tvOverrides);
    if (values.length) await tx.insert(tvOverrides).values(values);
  });
}

export async function loadOverrides() {
  if (!db) return loadOverridesKV();
  try {
    if (!(await isMigrated(OVERRIDES_KEY))) {
      const kvMap = await loadOverridesKV();
      if (Object.keys(kvMap).length) await writeOverridesDB(kvMap);
      await markMigrated(OVERRIDES_KEY);
    }
    return await readOverridesDB();
  } catch (e) {
    return loadOverridesKV();
  }
}

export async function saveOverrides(map) {
  if (!db) { await kv(["SET", OVERRIDES_KEY, JSON.stringify(map || {})]); return; }
  try {
    await writeOverridesDB(map);
    await markMigrated(OVERRIDES_KEY);
  } catch (e) {
    // Once migrated, reads ignore KV — surface the failure rather than writing a
    // KV value nothing will read; only fall back to KV while still pre-migration.
    if (await isMigrated(OVERRIDES_KEY)) throw e;
    await kv(["SET", OVERRIDES_KEY, JSON.stringify(map || {})]);
  }
}
