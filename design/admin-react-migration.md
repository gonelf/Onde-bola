# Admin → React migration & component reuse plan

> Goal: move the `/admin` console from static HTML to React so it can **reuse
> the production components**, and make the admin the place where we **test
> those components in isolation** (the Match Animation Lab is the first case).

## Status

- **✅ Engine reuse done.** The simulation engine is extracted to
  `public/admin/replay-sim.js` (a framework-free ES module). Both surfaces now
  import the *same* file — the production modal via the `@/public/admin/replay-sim`
  alias, and the static lab via `import … from "/admin/replay-sim.js"`. No more
  duplicated maths. (It lives under `public/` rather than `lib/` precisely so the
  static admin page can import it over HTTP; the `next.config.js` rewrites serve
  `/admin/*.js` from the filesystem before any rewrite, like `admin-nav.js`.)
  Tunables live in `DEFAULT_CONFIG`; the lab passes its own config and exports
  the tuned values to paste back into `DEFAULT_CONFIG`.
- **⏳ Still to do:** component reuse (the pitch *renderer* is still JSX in
  `GamesBrowser.jsx` and re-implemented as DOM in the lab) and the React admin
  shell. Those are Phases 1–3 below.

## Why

The Match Animation Lab (`public/admin/replay.html`) currently **re-implements**
the whole replay simulation in vanilla JS, duplicating the logic that lives in
`components/GamesBrowser.jsx`. Two copies of the same maths will drift. We want
one source of truth: the production component, exercised in admin with knobs and
fixtures.

Tuning we do in the lab (speed, formation movement, jitter, pass interval, …)
should change the **real** component's props/defaults, not a parallel port.

## Current state (facts)

- Admin pages are static HTML in `public/admin/*.html`, each links
  `/admin/admin.css` + `/admin/admin-nav.js` (vanilla, injects the top bar/drawer).
- Routing: `next.config.js` rewrites `/admin → /admin/index.html` and
  `/admin/:page → /admin/:page.html`. Static assets under `public/admin/` are
  served directly.
- Auth: `middleware.js` gates `/admin`, `/admin/:path*`, `/admin.html` and the
  admin write APIs with HTTP Basic Auth (`ADMIN_USER` / `ADMIN_PASSWORD`).
  Unset ⇒ open (read-only debug still works).
- Headers: `/admin/*` is `noindex` + `no-store`.
- The replay simulation + pitch rendering currently live **inline** in
  `components/GamesBrowser.jsx` (functions: `minOf`, `pitchPos`, `markerType`,
  `mulberry32`, `hashRng`, `possShare`, `formationArr`, `teamBase`,
  `attackSpot`, `buildWaypoints`, `simState`, `placePlayers`, `passBall`, plus
  the `MatchReplay` component and pitch JSX). Styles live in `assets/styles.css`
  (`.replay-*`, `.pitch-*`, `.rstat-*`).

## Target architecture

```
lib/replay-sim.js          ← pure, framework-free sim engine (no React, no DOM)
components/MatchPitch.jsx   ← the pitch + players + ball + markers renderer
components/MatchReplay.jsx  ← scoreboard + pitch + controls + chronology + stats
                              (extracted from GamesBrowser.jsx)
app/(admin)/layout.jsx      ← React admin shell (top bar + drawer, ports admin-nav)
app/(admin)/admin/...       ← admin pages as React routes
app/(admin)/admin/replay/   ← Animation Lab: controls drive <MatchReplay> props
```

Key idea: **all tunables become props** on `MatchReplay` / `MatchPitch` with the
current hardcoded values as defaults. A `SimConfig` object:

```
{ durationMs, passMin, jitterAmp, jitterSpeed,
  attackPush, defendDrop, lateral, ballFollow }
```

- Production modal: `<MatchReplay fx={fx} d={d} t={t} />` (uses default config).
- Admin lab: `<MatchReplay data={fixture} config={state} controls />` where the
  lab owns the config state and a control panel mutates it live.

The lab also wants **fixtures** (synthetic matches) and inputs the production
path doesn't (formation pickers, scenario picker). Those stay lab-only; the
shared piece is the renderer + engine.

## Migration phases

### Phase 0 — extract the engine (no behaviour change) ✅ unblock everything
1. Move the pure functions out of `GamesBrowser.jsx` into `lib/replay-sim.js`
   and export them. `placePlayers` / `passBall` take a `config` arg (defaults
   provided) instead of hardcoded constants.
2. `GamesBrowser.jsx` imports from `lib/replay-sim.js`. No visual change.
3. Verify the production modal still behaves identically (`npm run build`, manual
   smoke).

### Phase 1 — extract the components
1. Pull `MatchReplay` (and a `MatchPitch` sub-component) into their own files,
   still consumed by `GamesBrowser.jsx`.
2. Accept an optional `config` prop; default to the production config.
3. Keep `assets/styles.css` classes as-is (shared). Confirm no regression.

### Phase 2 — React admin shell
1. Add an `app/(admin)/` route group with a `layout.jsx` that renders the top
   bar + drawer (port `admin-nav.js`; reuse `admin.css` or migrate to CSS
   modules). Decide routing:
   - **Option A (recommended):** real React routes under `app/(admin)/admin/*`;
     drop the `*.html` rewrites for migrated pages, keep them for not-yet-ported
     ones. Update `next.config.js` rewrites incrementally.
   - Option B: keep static pages, mount React “islands” per page. More plumbing,
     not worth it.
2. **Auth stays as-is** — `middleware.js` already matches `/admin/:path*`, which
   covers React routes too. No change needed. Keep `noindex`/`no-store` headers.

### Phase 3 — port the Animation Lab to React
1. New route `app/(admin)/admin/replay/page.jsx` (client component).
2. Holds `SimConfig` + scenario/formation state; renders the control panel and
   `<MatchReplay data={fixture} config={config} controls />`.
3. Delete `public/admin/replay.html` once parity is confirmed; keep the nav
   entry (now pointing at the React route).
4. Scenarios become shared fixtures in `lib/replay-fixtures.js` so tests and the
   lab use the same data.

### Phase 4 — port the remaining admin pages (incremental, optional)
Order by churn/value: flags → overrides → seo → ads → ad-test → connections.
Each becomes a React page reusing shared fetch/handle helpers (port
`admin-common.js`). Remove its `.html` + rewrite when done. The console can run
**hybrid** (some React, some static) throughout — no big-bang cutover.

## "We test in admin" — the workflow

Admin is the component harness:
- Each reusable component gets an admin route that mounts it with **controls +
  fixtures** (like Storybook, but in-app and behind auth).
- Controls map 1:1 to props; fixtures live in `lib/replay-fixtures.js`.
- The lab's **Export settings** emits the `SimConfig` JSON; we paste the chosen
  values as the component's default config — so tuning in admin literally sets
  production defaults.
- Because admin is `noindex`/`no-store` and auth-gated, it’s safe to ship
  experimental component states there before exposing them on the public app.

## Decisions to confirm

1. **Routing**: React routes under `app/(admin)/` and retire `.html` per page
   (Option A) vs. keep static + islands. → recommend Option A.
2. **Styling**: keep the global `admin.css` / `assets/styles.css`, or move admin
   to CSS Modules during the port. → recommend keep global now, modularize later.
3. **Fixtures location**: `lib/replay-fixtures.js` shared by lab (+ future tests).
4. Whether to add a lightweight test (e.g. snapshot of `simState`/`passBall`
   outputs at fixed clocks) so the engine can't silently drift.

## Risks / notes

- `MatchReplay` is a client component; admin pages that use it must be client
  components (or wrap it). The static-HTML pages don't tree-shake, so moving to
  React should *reduce* duplicated JS overall.
- Don't break Basic Auth: the existing `matcher` already covers nested paths;
  just don't introduce an `/admin` API route that bypasses it.
- Engine duplication is **resolved** (see Status) — both surfaces import
  `public/admin/replay-sim.js`. What remains duplicated is the *rendering* (JSX
  vs. DOM), which Phase 1/3 removes by sharing the React renderer.

## Suggested first PR

Phase 0 + Phase 1 only (extract `lib/replay-sim.js` + `MatchReplay`/`MatchPitch`
components, config-as-props, no admin changes). Small, no behaviour change, and
it removes the divergence risk the moment Phase 3 swaps the lab onto the real
component.
