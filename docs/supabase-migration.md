# Supabase migration plan

Status: **proposed** — awaiting a Supabase project + scope sign-off. Nothing in
the running app has been switched yet.

This documents what would move to Supabase, what should stay where it is, and the
exact steps + code changes. It came out of a full sweep of the app's data-store
touchpoints.

## Current data architecture

The app uses **two** backends today:

### ① Neon Postgres + Drizzle — the relational system-of-record
- Code: `lib/db/client.js` (driver), `lib/db/schema.js` (tables),
  `lib/db/migrations/*` (SQL), `drizzle.config.js`.
- Driver: `drizzle-orm/neon-http` + `@neondatabase/serverless` (one HTTP request
  per query — chosen for Vercel's ephemeral serverless invocations).
- Env: `DATABASE_URL`.
- Tables:
  - **Auth.js** (NextAuth v5 magic-link): `users`, `accounts`, `sessions`,
    `verificationTokens` — see `lib/game/auth.js`, `@auth/drizzle-adapter`.
  - **Fantasy game**: `managers`, `clubs`, `players`, `leagues`,
    `leagueMembership`, `fixtures`, `matchResults`, `lineups`, `transfers`,
    `finances`, `challenges`, `snapshots`.

### ② Upstash Redis / KV — best-effort store, 23 consumers
- Code: `lib/kv.js`. Env: `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  (or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`).
- Two **distinct** kinds of data live here:

| Kind | KV keys | Migrate? |
|---|---|---|
| **Durable config / source-of-truth** (admin- & cron-written) | `ads:loaders`, `flags:overrides`, `tv:overrides`, `replay:config`, `seo:urls`, `buffer:channels`, `buffer:log` | **Yes → Supabase tables** |
| **Ephemeral upstream caches** (TTL'd, keyed by date/id) | `fx:day:*`, `fx:bak:*`, `tv:rich:*`, `tv:date:*`, `tv:id:*`, `fm:day:*`, `sofa:*`, `md:*`, `hl:*`, `card:*`, `squad:*`, `tsdb*` | **No — keep on Redis** |

Consumers of the durable config:
`lib/ads-store.js` (+ `/api/ads`), `lib/flags.js` (+ `/api/flags`),
`lib/overrides.js` (+ `/api/overrides`), `lib/replay-config.js`
(+ `/api/replay-config`), `lib/sitemap-sweep.js` (+ `/api/cron-sitemap`),
`lib/buffer-post.js` (+ `/api/buffer`, `/api/cron-buffer`).

The caches are read on nearly every request and are pure TTL caches of
FotMob/SofaScore/TheSportsDB. Postgres is the wrong tool for them; Supabase has
no Redis, so **Upstash stays as the cache layer**.

## Target architecture

- **Supabase Postgres** = system-of-record: the game + Auth tables (migrated from
  Neon) **plus** new tables for the durable config currently in KV.
- **Upstash Redis** = cache only (the ephemeral keys above), unchanged.

Bonus: moving Postgres off Neon should resolve the recurring Vercel preview
failures — the Neon↔Vercel integration creates a DB branch per preview deploy and
hit the "branch limit reached" wall. Supabase doesn't auto-branch per preview.

## Phase 1 — Postgres host: Neon → Supabase

1. **Create the Supabase project** (you) and grab two connection strings from
   *Project Settings → Database*:
   - **Pooled / Transaction** (Supavisor, port `6543`) — for the serverless app.
   - **Direct** (port `5432`) — for migrations (`drizzle-kit`).
2. **Swap the driver** in `lib/db/client.js` from `neon-http` to `postgres-js`
   (Supabase has no neon-http equivalent):
   ```js
   import { drizzle } from "drizzle-orm/postgres-js";
   import postgres from "postgres";
   const url = process.env.DATABASE_URL;
   // Supavisor transaction mode doesn't support prepared statements.
   const client = url ? postgres(url, { prepare: false }) : null;
   export const db = client ? drizzle(client, { schema }) : null;
   ```
   Add the `postgres` dependency; drop `@neondatabase/serverless` once nothing
   else imports it.
3. **Env**: point `DATABASE_URL` at the Supabase **pooled** string in Vercel
   (Production + Preview + Dev). Use the **direct** string only for
   `drizzle-kit` (migrations).
4. **Apply the schema**: `npm run db:push` (or `db:generate` + migrate) against
   the Supabase DB. The schema and existing migrations port unchanged — it's
   Postgres-to-Postgres.
5. **Data**: if there is live data in Neon, `pg_dump` the Neon DB and restore into
   Supabase (include the Auth `sessions`/`verificationTokens` if you don't want to
   sign everyone out). If pre-launch, skip — the tables come up empty.
6. **Verify** Auth sign-in and a game route end-to-end on a preview, then remove
   the Neon integration.

## Phase 2 — durable config: KV → Supabase tables

Add tables and switch each store's read/write from `kv()` to Drizzle. Keep each
store's public function signatures identical so callers (the API routes + the
app) don't change. Suggested tables (single-row or key/value where it's just a
blob):

| Store | New table | Shape |
|---|---|---|
| `lib/ads-store.js` | `ad_units` | one row per unit: `id, script, banner(jsonb), label, enabled, slot, every_n` |
| `lib/flags.js` | `feature_flags` | `id, state` |
| `lib/overrides.js` | `tv_overrides` | per override row (keyed by match/date) |
| `lib/replay-config.js` | `replay_config` | single row / `jsonb` blob |
| `lib/sitemap-sweep.js` | `seo_urls` | `url, lastmod` (replaces the `seo:urls` registry; gains real pruning queries) |
| `lib/buffer-post.js` | `buffer_channels`, `buffer_log` | channels: `channel_id`; log: a real append-only table (no 50-row cap, queryable, no JSON-blob write race) |

Notes:
- Keep the fall-soft posture: every store should degrade gracefully when the DB
  is unset, exactly as it does for KV today.
- `ads:active-units` is a derived cache (`unstable_cache`) — keep it; it just
  reads from the new table instead of KV.
- The `buffer_log` table is the clearest win: it removes the JSON read-modify-
  write race and the 50-row cap, and makes history queryable.

## What does NOT move

- All ephemeral caches in the table above → stay on Upstash Redis.
- `lib/kv.js` stays (the cache layer still uses it).

## Rollout

1. Phase 1 behind a preview deploy; verify Auth + game; cut `DATABASE_URL` over.
2. Phase 2 store-by-store (each is independent and reversible): ads → flags →
   overrides → replay → seo → buffer. Migrate any existing KV values with a tiny
   one-off backfill per store.
3. Once Phase 2 is done, the only thing left in KV is caching.

## What I need from you to execute

- A Supabase project + the pooled & direct connection strings (set
  `DATABASE_URL` in Vercel; share the direct string for migrations).
- Confirm: is there **live data** in Neon to migrate, or recreate fresh?
- Confirm scope: Phase 1 only, or Phase 1 + 2 (recommended).
