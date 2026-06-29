/*
 * lib/config-migrate — a one-time "this store has moved to Postgres" marker, so
 * the durable-config stores (flags, ads, overrides, replay) can lazily backfill
 * their existing Upstash KV value into Postgres on first read and then serve from
 * Postgres thereafter.
 *
 * Why a marker at all: the relational tables can't tell "empty because the admin
 * cleared everything" from "empty because we haven't migrated yet". The marker
 * removes that ambiguity — once set, an empty table is honoured as empty (no
 * re-backfill, so an intentional clear can't be undone by stale KV).
 *
 * The marker itself lives in KV (`migrated:<store>`): it's tiny metadata, not
 * config, and keeping it in KV avoids a bespoke Postgres table. An in-process
 * memo means the hot path (e.g. feature-flag checks) does at most one KV GET per
 * serverless instance, then nothing.
 */

import { kv } from "@/lib/kv";

const memo = new Set();

export async function isMigrated(store) {
  if (memo.has(store)) return true;
  try {
    const v = await kv(["GET", `migrated:${store}`]);
    if (v === "1") {
      memo.add(store);
      return true;
    }
  } catch (e) {
    // Treat an unreachable marker as "not migrated" — the caller falls back to KV.
  }
  return false;
}

export async function markMigrated(store) {
  memo.add(store);
  try {
    await kv(["SET", `migrated:${store}`, "1"]);
  } catch (e) {
    // Best-effort: if the marker write fails we just re-backfill next time
    // (idempotent), so this never blocks a read or save.
  }
}
