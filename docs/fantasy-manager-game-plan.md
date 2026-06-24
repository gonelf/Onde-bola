# Plan: Fantasy-meets-Elifoot Football Manager Game (accounts + async PvP)

> Design plan for a new game mode on the `Onde-bola` ("Hoje Há Bola") Next.js site.
> Status: **planned, not yet implemented.** Reference this doc when starting the build.

## Context

The site already ships a **deterministic, top-down match animation** —
`components/MatchPitch.jsx` + `public/admin/replay-sim.js` + `components/useReplayClock.js`
(`assets/replay.css`). It renders a full 90' match as a *pure function of a clock + seed* from an
**event list** (`{side, min, kind, player, note}`) plus **stats** (`[{key, home, away}]`) and
lineups. The admin "Animation Lab" (`app/(admin)/admin/replay/page.js`) already drives it from
hand-authored synthetic events — proof the animation works with no real tracking data.

The goal: build a **full-season football management game** (Elifoot-style: own a club, league
table, fixtures, transfers/finances, promotion/relegation) with **user accounts** and
**async PvP** (managers set lineups/tactics ahead of time; the server simulates fixtures on a
schedule or instantly on challenge — never requires both players online).

Decisions locked in with the user:
- **Depth:** full season manager.
- **PvP:** async leagues/challenges (never needs both players online).
- **Squad data:** real teams/players from FotMob, snapshotted into our DB for stability.
- **Infra:** add a real database.

The animation is the reusable asset. The missing piece is a **headless simulator** that
*generates* the event+stats timeline the animation already plays. Everything else (accounts, DB,
leagues) is standard plumbing around that bridge.

## Key principle: reuse, don't rebuild the renderer

The animation stack is reused **unchanged**: `public/admin/replay-sim.js`,
`components/MatchPitch.jsx`, `components/useReplayClock.js`, `assets/replay.css`. The new
simulator *outputs into* the exact shape these consume. KV (`lib/kv.js`) stays for caching only;
Postgres is the source of truth.

## Architecture

### 1. Match simulator (the bridge) — `lib/game/simMatch.js` (new)
Pure, headless (no React/DOM). Imports only the PRNG from the existing engine so there is one
source of randomness: `import { mulberry32, hashRng } from "@/public/admin/replay-sim"`.

`simulateMatch({ home, away, seed })` → `{ events, stats, score, homeLineup, awayLineup }`,
where each side is `{ name, formation, color, tactics, players:[{name, pos, rating}] }`.

Model (deterministic, seed-in → identical-out):
1. **Strength** — `lib/game/ratings.js`: weighted means of player ratings by line (attack/mid/
   defence) + formation/tactic modifiers → `xgFor`/`xgAgainst` per side.
2. **Match shape** — differential → `possession`, `shots`, `sot`, `xg`, `corners`, `fouls`
   (the `stats[]` rows `possShare`/`addShotEvents` already read; clamp possession 15–85 to match
   `possShare`).
3. **Timeline** — seeded Poisson goal counts via `mulberry32(seed)`, placed at seeded minutes,
   scorers sampled weighted toward higher-rated attackers; seeded cards (from `fouls`) and subs.
   Leave shot markers to the renderer's existing `addShotEvents` (avoid double-counting).
4. **Output** the `events`+`stats` arrays.

Determinism is double-guaranteed: (a) `fixtures.seed` + ratings snapshot reproduce the run;
(b) the resolved `events_json`/`stats_json` are frozen on the result row (`sim_version` stored
too), so a replay is byte-identical forever.

### 2. Database — Neon Postgres + Drizzle ORM
- **Neon** (`@neondatabase/serverless` HTTP driver): serverless-native, survives Vercel's
  ephemeral per-request lifecycle without pool exhaustion. **Drizzle** (`drizzle-orm` +
  `drizzle-kit`): no binary/codegen, tiny cold start, SQL-first, fits a plain-JS/no-build repo.
- Files: `lib/db/client.js` (guarded `db` export, degrades when `DATABASE_URL` unset, mirroring
  `lib/kv.js`), `lib/db/schema.js` (all tables), `drizzle.config.js`, `lib/db/migrations/*`.
  `package.json` scripts `db:generate`/`db:push`/`db:studio`.
- Tables: `users` (+ Auth.js `accounts`/`sessions`/`verification_tokens`), `managers`, `clubs`,
  `players`, `snapshots` (frozen roster set), `leagues`, `league_membership` (materialized
  standings), `fixtures` (with `seed`, `status`), `match_results` (frozen `events_json`/
  `stats_json` → reproducible replay), `lineups` (formation + XI/bench + tactics JSON),
  `transfers`, `finances`, `challenges` (async PvP one-offs).

### 3. Auth — Auth.js (NextAuth v5) + Drizzle adapter, magic-link
- `next-auth@beta` + `@auth/drizzle-adapter`, **database sessions**, email magic-link first
  (no password storage); OAuth optional later. First login provisions `users` + empty `managers`.
- **Coexists with existing admin Basic Auth**: leave `middleware.js` matchers untouched
  (admin stays Basic-Auth). Do **not** add Auth.js to the edge middleware. Gate the game at the
  layout/handler level: `auth()` in `app/(game)/layout.js` and a `lib/game/requireManager.js`
  helper at the top of every `app/api/game/*` route. Keeps the public/SEO routes session-free.
- `lib/game/auth.js` (config: `handlers/auth/signIn/signOut`) + `app/api/auth/[...nextauth]/route.js`.

### 4. Squad ingestion — `lib/game/fotmobSquad.js` + `lib/game/deriveRatings.js`
Lift the existing defensive FotMob helpers (`lineupSide`, `teamColorsFrom`, `positionLabel`,
UA/Referer/AbortController fetch pattern in `lib/cardinfo.js` / `app/api/matchdetails/route.js`).
`fetchSquad(teamId)` → players with FotMob rating/pos/age (KV-cache raw). `deriveRatings.js`
maps FotMob 0–10 → our 40–99 integer scale + market value; **missing-data policy**: fall back to
a position/tier baseline (never empty), skip a wholly-failed squad and continue (degrade, never
throw). Driven by Basic-Auth-gated `app/api/admin/seed-squads/route.js` (gate inline with
`isAdmin()` to avoid touching middleware) + admin UI `app/(admin)/admin/game-seed/page.js`.
Note: FotMob lineups in the current parser carry name/number/position but **not** ratings — use
the team/squad endpoint and extend the parser; this is the main ingestion risk.

### 5. Game loop & async PvP
- League activation generates a **double round-robin** fixture list with a frozen `seed` per
  fixture, spread across matchdays (`app/api/game/league/[id]/start/route.js`).
- **Heartbeat**: `app/api/cron-tick/route.js` (`CRON_SECRET`-gated, in `vercel.json`, pattern from
  `app/api/cron-listings`). Picks due `scheduled` fixtures, reads each side's stored `lineups`
  (fallback `club.base_formation` + auto-XI), runs `simulateMatch`, freezes `match_results`,
  recomputes `league_membership` standings + busts KV cache. **Idempotent + batched** within
  `maxDuration` (sim is microsecond-fast → hundreds of fixtures per invocation). On Hobby's
  daily-cron limit, run one matchday/day (also better pacing).
- **Instant challenge**: `app/api/game/challenge/route.js` reads both managers' pre-set lineups,
  sims immediately with a fresh seed. The async-PvP property holds because lineups/tactics are
  persisted, so neither player need be online.

### 6. UI — new `app/(game)/` route group (gated by `auth()` in its layout)
`login`, `play` (dashboard), `play/squad`, `play/lineup` (lineup+tactics editor),
`play/league` (standings), `play/fixtures`, `play/transfers`, `play/challenge`, and
**`play/match/[resultId]`** — the replay viewer that wires a frozen `match_results` row into the
reused `MatchPitch` + `useReplayClock` (identical to the admin lab). New thin components under
`components/game/`: `LineupEditor`, `LeagueTable`, `FixtureList`, `ReplayViewer`.

## Phasing (ship value early)

- **M1 — Accounts + DB foundation.** Neon + Drizzle, Auth.js magic-link, core tables,
  `(game)` layout guard. *Log in, see an empty dashboard.*
- **M2 — Simulate-and-watch (THE PROOF, smallest vertical slice).** `lib/game/simMatch.js` +
  `ratings.js`; ingest a few real squads; a "friendly" page that picks two clubs → sims → freezes
  a `match_results` row → plays it in the reused `MatchPitch` viewer. Validates the simulator
  output against the renderer with near-zero risk (the lab already proves the renderer).
- **M3 — Leagues + fixtures + standings.** Round-robin generator, `cron-tick`, materialized
  standings + KV cache, league/fixtures UI.
- **M4 — Transfers + finances + training.** Market UI, gate/prize money, rating progression.
- **M5 — Async PvP + promotion/relegation.** `challenges` instant-sim, per-fixture lineup
  persistence, end-of-season tier movement.

## Critical files
**Create:** `lib/game/simMatch.js` (most important — the bridge), `lib/game/ratings.js`,
`lib/db/schema.js`, `lib/db/client.js`, `lib/game/auth.js` + `app/api/auth/[...nextauth]/route.js`,
`lib/game/fotmobSquad.js` + `lib/game/deriveRatings.js`, `app/api/admin/seed-squads/route.js`,
`app/api/cron-tick/route.js`, `app/(game)/` route group + `components/game/ReplayViewer.jsx`.
**Modify:** `vercel.json` (add crons), `package.json` (add `@neondatabase/serverless`,
`drizzle-orm`, `drizzle-kit`, `next-auth@beta`, `@auth/drizzle-adapter` + `db:*` scripts).
**Reuse unchanged:** `public/admin/replay-sim.js`, `components/MatchPitch.jsx`,
`components/useReplayClock.js`, `assets/replay.css`, FotMob helpers in `lib/cardinfo.js`.

## Verification
- **Simulator (M2, the linchpin):** run `simulateMatch` with a fixed seed in a Node script;
  assert same seed → identical `events`/`stats`; feed the output into the existing
  `app/(admin)/admin/replay` lab and confirm it animates — goals/cards/subs render and the
  scoreline matches `runningScore`.
- **DB/Auth (M1):** `npm run db:push` against a Neon branch; sign in via magic-link; confirm a
  `users` + `managers` row is created and `/play` is gated (redirects when logged out).
- **Ingestion:** hit `seed-squads` for one league; verify `clubs`/`players` populate with sane
  40–99 ratings and no crash on a partial/missing squad.
- **Game loop (M3):** start a small league, run `cron-tick` manually with the `CRON_SECRET`;
  confirm due fixtures flip to `simulated`, `match_results` rows freeze, and standings update;
  open `play/match/[resultId]` and watch the replay.
- Run `npm run lint` and `npm run build` after each milestone (matches existing CI scripts).
