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

export const OVERRIDES_KEY = "tv:overrides";

export async function loadOverrides() {
  const raw = await kv(["GET", OVERRIDES_KEY]);
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
}

export async function saveOverrides(map) {
  await kv(["SET", OVERRIDES_KEY, JSON.stringify(map || {})]);
}
