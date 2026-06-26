# Fantasy Manager Game — Build Record & Decisions

As-built documentation for the football management game added to Onde-bola
("Hoje Há Bola"). Companion to `docs/fantasy-manager-game-plan.md` (the
forward-looking plan); this file records **what was actually built and why**.

- **Branch:** `claude/fantasy-football-game-plan-ejquvy`
- **Status:** Milestones **M1–M6 complete** (accounts → simulator → leagues →
  economy → async PvP & promotion/relegation → admin console). Ships **dark**
  behind the `game` feature flag.
- **Player entry point:** `/fantasygame` · **Admin:** `/admin/game*`

---

## 1. What it is

A full-season football manager (Elifoot-style) with **accounts** and **async
PvP**, built *on top of the site's existing match animation*. The animation
(`components/MatchPitch.jsx` + `public/admin/replay-sim.js`) is a deterministic,
pure-function renderer that plays a match from an **event list + stats**. The
game's job was to *generate* that event/stats data from squads, then layer
leagues, an economy and PvP around it. The renderer was reused **unchanged**.

Player loop: claim a club → build the squad in the transfer market & train
players → a scheduled tick simulates league fixtures (paying gate/prize money)
and updates the table → watch any match in the animation → challenge other
clubs → promotion/relegation at season's end.

---

## 2. Key decisions (and why)

| # | Decision | Rationale | Alternatives rejected |
|---|----------|-----------|-----------------------|
| D1 | **Reuse the existing animation unchanged**; build a *headless* simulator that outputs its exact `events[]`/`stats[]` shape | The renderer was the asset to leverage; the only new engine work is generating data it already knows how to play | Building a new renderer; real tracking data (doesn't exist) |
| D2 | **Deterministic, seeded simulator** (`mulberry32` from the existing engine) | Same seed → identical result, so replays are byte-reproducible and frozen results never drift | Live/random sim (non-reproducible) |
| D3 | **Freeze results** (`match_results.events_json`/`stats_json`) | A played match is immutable history; the viewer needs zero recompute and is stable across `sim_version` changes | Recompute on view |
| D4 | **Neon Postgres + Drizzle ORM** | Serverless HTTP driver survives Vercel's ephemeral per-request lifecycle (no pool exhaustion); Drizzle has no binary/codegen, fits a plain-JS repo | Vercel Postgres direct; Prisma (engine binary, cold start); KV-only (relational queries hard) |
| D5 | **Auth.js v5, Google OAuth, database sessions** | App-Router-native; user chose Google-only (dropped the email/magic-link + nodemailer path mid-build) | Magic-link email (needs SMTP); credentials/passwords (own the security) |
| D6 | **Coexist with the existing admin Basic-Auth, don't fight over middleware** | `/admin` stays Basic-Auth in `middleware.js`; the game is gated at the layout/route level with `auth()` — keeps public/SEO routes session-free | Putting Auth.js in the edge middleware |
| D7 | **Whole mode behind the existing `game` feature flag** (default off) | Deploys dark; owner flips it on at `/admin/flags` with no redeploy; reuses the app's generic flag system (one `FLAG_DEFS` entry) | A bespoke gate; env-var toggle |
| D8 | **Multi-source ingestion, FotMob as source of truth, merged** | FotMob's squad/league endpoints are frequently **blocked from Vercel IPs**; merging Football-Data + TheSportsDB fills clubs/rosters/badges so seeding always yields the best available data | Single source (fragile); FotMob-only (failed in practice) |
| D9 | **Snapshot rosters into Postgres** | Gameplay must be stable even as live feeds drift; once seeded, the game never depends on a live feed again | Live lookups during play |
| D10 | **Generated fallback squads + a one-click demo seeder** | Guarantees the game is playable even when every external source is blocked/empty | Hard dependency on real data |
| D11 | **Async PvP only** (server simulates from stored lineups) | Never requires both players online; fits Vercel serverless (no websockets/long-lived processes) | Real-time live matches |
| D12 | **Cron-tick is idempotent + batched; one matchday/day** | Vercel Hobby limits cron frequency; the sim is microsecond-fast so a daily tick drains a league; daily cadence is also more game-like | Hourly/continuous ticking |
| D13 | **Club alias table is authoritative when both names resolve** | Fixes cross-source misses (Wolves↔Wolverhampton) AND blocks false merges of token-sharing clubs (Sheffield United/Wednesday, Sporting CP/Braga) | Pure fuzzy matching (over/under-merges) |
| D14 | **Scope limited to Portugal + UK leagues** (per user) | Keeps ingestion focused and the `ALLOWED_LEAGUES` allowlist is the enforcement point | All competitions |

---

## 3. Architecture as built

```
Data sources ── ingest (merge) ──> Postgres (snapshot: clubs+players)
   FotMob (truth)                      │
   Football-Data.org                   ├─ leagues + fixtures (round-robin, seeded)
   TheSportsDB                         │
   (generated fallback)                ▼
                          cron-tick / challenge / friendly
                                       │  simMatch(seed) -> events[]+stats[]
                                       ▼
                          match_results (frozen)  ──>  MatchPitch + useReplayClock
                                       │                 (existing animation, reused)
                                       └─ standings, finances (gate/prize)
```

- **Simulator** `lib/game/simMatch.js` + `lib/game/ratings.js`: squad strength
  (attack/mid/defence + formation/tactic mods) → expected goals/possession/shots
  → seeded Poisson goal timeline + cards + subs, in the renderer's exact shape.
- **Ingestion** `lib/game/ingest.js` merges `fotmobSquad` + `footballDataSquad` +
  `sportsdbSquad`, matched via `clubAliases.js`; `deriveRatings.js` maps FotMob
  0–10 → our 40–99 (baseline when missing). Snapshotted into `clubs`/`players`.
- **Season engine** `lib/game/schedule.js` (double round-robin),
  `lib/game/runFixture.js` (sim one fixture + standings + finances),
  `lib/game/season.js` (promotion/relegation rollover).
- **Economy** `lib/game/economy.js` (wallet + ledger), transfers/training/finances.
- **Auth/guard** `lib/game/auth.js`, `lib/game/requireManager.js`.

---

## 4. Data model (Postgres, `lib/db/schema.js`)

Auth.js: `users`, `accounts`, `sessions`, `verification_tokens`.
Game: `managers` (wallet), `snapshots` (a frozen import), `clubs`, `players`,
`leagues`, `league_membership` (materialized standings), `fixtures` (seeded),
`match_results` (frozen `events_json`/`stats_json` + `meta_json` team
descriptors), `lineups`, `transfers`, `finances` (ledger), `challenges`.

Migrations in `lib/db/migrations/` (`0000` base, `0001` adds `match_results.meta_json`).
A consolidated idempotent `schema.sql` was provided for running in the Neon SQL
editor without a local connection string.

---

## 5. Routes

**Player (`/fantasygame`, flag + auth gated):** dashboard (claim club),
`squad` (+train), `transfers`, `league`, `fixtures`, `challenge`, `friendly`,
`match/[resultId]` (replay viewer).

**Player APIs (`/api/game/*`):** `club`, `clubs`, `friendly`, `transfers`,
`train`, `finances`, `challenge`.

**Admin (`/admin/*`, Basic-Auth):**
- `game` — console: overview, manager/club tools, league tools, **wipe**
- `game-seed` — multi-source squad import (source selector + provenance)
- `game-league` — seed demo season, create league, advance tick, end season
- APIs: `/api/admin/{game,seed-squads,seed-demo,league,season}`

**Cron:** `/api/cron-tick` (daily in `vercel.json`; CRON_SECRET or admin auth).

**Diagnostics:** `/api/health` now reports a `game` block (db ping, auth, sources).

---

## 6. Environment variables

| Var | Purpose | Required |
|-----|---------|----------|
| `DATABASE_URL` | Neon Postgres (app reads this name) | Yes (game) |
| `AUTH_SECRET` | Auth.js session secret | Yes (game) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google OAuth | Yes (sign-in) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Admin Basic-Auth | Yes (admin) |
| `FOOTBALL_DATA_TOKEN` | Real rosters (PL/ELC/PPL) | Optional |
| `THESPORTSDB_KEY` | Defaults to free `123` | Optional |
| `CRON_SECRET` | Protect the tick | Optional |

Without DB/auth env the mode stays inert (the public site is unaffected — the DB
client degrades to `null` like `lib/kv.js`).

---

## 7. How to run (deployment)

1. Set the env vars above; **redeploy** (Vercel injects on deploy).
2. Create tables — run the consolidated `schema.sql` in the Neon SQL editor, or
   `npm run db:push` locally (the Drizzle config auto-loads `.env.local`).
3. Verify at `/api/health` → `game.db.ping: true`, `auth.google: true`.
4. Enable the **Manager game** flag at `/admin/flags`.
5. Seed: `/admin/game-league → Seed demo season` (no external deps), or
   `/admin/game-seed` (real PT/UK clubs, source **Auto**) then create a league.
6. Sign in (Google), open `/fantasygame`, claim a club, play.

---

## 8. Verification performed

All offline (the sandbox can't reach the DB or football APIs — proxy policy
blocks them), via a small ESM loader that resolves the `@/` alias:

- **Simulator** — same seed → identical output; valid renderer shape; sensible
  scorelines (stronger squad wins more).
- **Full pipeline** — derive (missing ratings) → auto-XI (exactly 11) →
  simulate → deterministic, renderer-valid.
- **Scheduler** — correct round/game counts (N=18 → 34 rounds, 306 games), no
  duplicate pairings, home/away balanced, deterministic seeds.
- **Demo season** — full 14-game-per-club season, consistent standings (3·W+D).
- **Club matcher** — 9/9 incl. `Man City`↔`Manchester City`, and the
  disambiguation blocks (`Sheffield United`✗`Wednesday`, `Sporting CP`✗`Braga`).
- **Promotion/relegation** — correct club swap, sizes conserved, label increment.
- `npm run build` compiles clean after every milestone.

> Note: no end-to-end run against a live Postgres/OAuth deployment was possible
> from the build environment — that step is the deployer's (section 7).

---

## 9. Known limitations / risks

- **External data is best-effort.** Free tiers are rate-limited and incomplete;
  FotMob is often blocked from server IPs. Mitigated by the merge + generated
  fallback + demo seeder, but real-roster completeness varies by league/day.
- **No lineup/tactics editor yet** — matches use an auto-picked best XI. The
  `lineups`/`tactics` tables exist; per-fixture editing is a natural next step.
- **Cross-source name matching is heuristic** beyond the alias table; odd names
  may not enrich-match (they just use their primary source).
- **Wages/contracts/morale not modelled** — the economy is gate/prize income vs
  transfer/training spend only.
- **`ALLOWED_LEAGUES`** is PT/UK only by design; Football-Data's free tier omits
  Liga Portugal 2 (falls back to other sources).

---

## 10. Commit history (this work, on the branch)

Plan → M1 (accounts+DB) → health check → M2 (simulate-and-watch) → M3
(leagues/fixtures/standings) → move to `/fantasygame` + demo seeder → env
auto-load → Google-only auth → TheSportsDB source → real rosters → multi-source
merge → club aliases → M4 (economy) → M5 (PvP + promotion/relegation) → M6
(admin console). Each milestone was built, verified, committed and pushed
separately.
