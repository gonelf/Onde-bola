# Hoje Há Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

Built with **Next.js (App Router)** and **React**, deployed on **Vercel**. The
home page is a server-rendered shell that mounts a React client island for the
live games browser; the per-game and league pages are server-rendered for SEO,
and the data sources are Next.js route handlers under `app/api/`.

## Features

- **Today's games worldwide** — every soccer fixture for the day from across
  the globe comes from [FotMob](https://www.fotmob.com)'s day feed (one call,
  via the cached `/api/fixtures` proxy) and is grouped by competition, each
  headed with the **championship's logo** (falling back to a monogram when the
  feed has no artwork). Past days are served from a long-term cache/DB backup,
  so browsing history doesn't re-hit upstream.
- **Where to watch (real data only)** — per-match broadcast channels, grouped
  by country, come from TheSportsDB's free TV feeds — the day schedule
  (`eventstv.php`) plus an on-demand per-event lookup (`lookuptv.php`) when you
  open a match. There is **no curated guesswork**: coverage is crowd-sourced,
  so matches without a listing simply show *“No TV listing yet”*. **Free-to-air**
  channels are shown in green and **paid cable / subscription** in amber with a 🔒.
- **Cached** — TV data is fetched through a small Vercel serverless function
  (`/api/tv`) that caches results in a Vercel KV store, so repeat loads and
  visitors don't re-hit the upstream API (with a direct fallback when the
  function isn't deployed).
- **Click for details** — click (or keyboard-activate) any match to open a
  detail view with the score/status, full date, time and venue, and the
  complete free-vs-paid where-to-watch breakdown per country.
- **Share any game** — every card (and the detail modal) has a share button.
  It uses the native share sheet on mobile / modern desktop and falls back to
  copying the link. The link is short — **`/g/<match-id>`** (e.g.
  `/g/4667790`) — a server-rendered page that carries **that game's own social
  preview**: a custom 1200×630 image generated on the fly (`/og/<match-id>`, via
  `@vercel/og`) showing the two teams, crests, competition, score/kickoff and
  date — so pasting it into WhatsApp, X/Twitter, Facebook, iMessage, Slack or
  Discord unfurls a per-match card. The game's data is rebuilt **server-side
  from the id alone** (`lib/cardinfo`, FotMob + Vercel KV cache `card:<id>`), so
  nothing is crammed into the URL. Opening the link drops real visitors straight
  into the app with that match open (`/?match=fm:<id>&date=<YYYY-MM-DD>`).
- **Share today's top games** — a one-tap daily digest for social: **`/today`**
  is a server-rendered page whose social preview is a single **1200×630 image of
  the day's biggest fixtures** (`/og/today`, via `@vercel/og`) — each row with
  crests, the score or kickoff time and a LIVE/FT badge. The games are pulled
  from the same cached `/api/fixtures` feed and **ranked by competition
  prominence, live-ness and kickoff**, so pasting `/today` into WhatsApp, X,
  Slack, etc. unfurls a "what's on today?" card. `?date=YYYY-MM-DD` shares a
  specific day and `?n=1..6` controls how many games are shown. A small tool
  page at **`/image`** lets you pick any date, preview the card and **download
  the PNG** (named `hojehabola-top-games-<date>.png`) ready to post. For
  automated posting, the finished card is also served directly as a PNG at
  **`/image/landscape`**, **`/image/square`** and **`/image/portrait`**.
- **Daily games as a text post** — **`/text`** returns a ready-to-post plain-text
  version of the same ranked selection, for WhatsApp / X / Instagram captions:

  ```
  ⚽ Jogos de hoje! 🏆

  🇨🇿 República Checa 1-0 🇿🇦 África do Sul (a decorrer) na SIC
  🇨🇭 Suíça vs 🇧🇦 Bósnia às 20h na SIC
  🇨🇦 Canadá vs 🇶🇦 Qatar às 23h na Sport TV 5

  Vê todos os jogos e onde ver na TV 👉 hojehabola.com
  ```

  Each game carries a **flag per team** (national sides resolve via
  `lib/country-flags`; club sides render with none) and **one Portuguese TV
  channel** — free-to-air if available, otherwise the cheapest cable option,
  resolved from the same TV feeds the site uses. `?date=YYYY-MM-DD`, `?n=1..20`
  and `?lang=pt|en` (default Portuguese) are honoured. The same caption is also
  served per-day at **`/image/<date>/text`** (the text sibling of
  `/image/<date>/square`), so an automated client can pull the card and its
  caption from matching URLs. The **`/image`** tool page
  also shows this text below the preview with a **Copy** button — built in the
  browser from the same fixtures the canvas drew, so it always matches the image
  and fills in as games load. Every digest surface (page, image, social card and
  text) shares one selection rule (`lib/digest-select`): **only well-known
  leagues and competitions**, ranked by prominence, live-ness and kickoff.
- **Scheduled social posts (Buffer)** — **`/api/cron-buffer`** is poked daily by
  a GitHub Actions cron (`.github/workflows/buffer-cron.yml`, 07:00 UTC) that
  schedules tomorrow's post on [Buffer](https://buffer.com): it pairs
  the square card (`/image/<tomorrow>/square`, which Buffer fetches itself via
  `imageUrl`) with the caption (`/image/<tomorrow>/text`) and queues the post for
  **09:00 UTC** the next day. Uses Buffer's **GraphQL API**
  (`https://api.buffer.com`): a `createPost` per channel with
  `mode: customScheduled` + a `dueAt` timestamp. Set `BUFFER_ACCESS_TOKEN` (a
  Buffer personal API key), plus `CRON_SECRET` if used; pass `?date=YYYY-MM-DD`
  to target another day. **Which channels** to post to is managed from
  **`/admin/buffer`** (saved in KV) — resolution is saved selection →
  `BUFFER_CHANNEL_IDS` env (legacy `BUFFER_PROFILE_IDS` still read) → otherwise
  **auto-default to your Facebook, Instagram and Twitter/X channels**. Every run
  is recorded in a KV log. The admin page shows the config and that log,
  discovers/selects channels, previews a day's card + caption, and schedules a
  post on demand (gated by Basic Auth, like the other admin pages). See
  `lib/buffer-post`.
- **Date navigation** — jump to previous/next day or back to today.
- **Live scores & status** — in-play matches show the current score, the
  minute (e.g. `67'`) or `HT`, and a pulsing live badge; finished games show
  `FT`. Today's view auto-refreshes from the feed every 60s.
- **Broad coverage** — FotMob's day feed returns every competition for the
  date in a single call, so coverage stays wide (domestic leagues, cups and
  internationals) without per-league fan-out.
- **League filter** — open **Leagues** to show/hide individual competitions.
  A **Reset filters** button clears the selection, and a **Remember this next
  time** checkbox persists your choices to `localStorage` across visits (leave
  it unchecked to keep the filter for the current session only).
- **Search** — filter by team or competition.
- **Real data only** — no placeholder/sample schedule. When there are no
  fixtures, or the live feed can't be reached, the app shows a clear empty
  state instead of fake games.

## Running it

It's a Next.js app, so install dependencies and run the dev server:

```bash
npm install
npm run dev          # http://localhost:3000
```

`npm run build && npm run start` runs the production build locally. The
**fixtures and TV data come through the route handlers in `app/api/`** — FotMob
requires this (it blocks direct browser calls via CORS) — so they're served by
the same dev/prod server, no separate process needed. On Vercel, connect KV
(below) so the data routes cache.

## Project structure

```
app/
  layout.js                      Minimal root layout (<html>/<body> shell)
  (app)/layout.js                App layout: global styles.css, page metadata, WebSite/WebApplication JSON-LD, Analytics
  (app)/page.js                  Home page — server shell that mounts the games browser
  (seo)/g/[[...slug]]/page.js    Per-game + league SEO pages (/g/<id>, /g/<league>, /g/<date>/<slug>, /g/<league>/<date>/<slug>)
  (seo)/today/page.js            Shareable "today's top games" digest page
  (seo)/image/page.js            Download tool for the digest image (date picker + buttons)
  og/[[...seg]]/route.js         Preview images: /og, /og/<id>, /og/today (1200×630 PNG, next/og, edge)
  image/{landscape,square,portrait}/route.js  Ready-to-post PNGs of the day's games (delegate to /og/today)
  image/[date]/text/route.js     Ready-to-post caption for a date (text sibling of /image/<date>/square)
  text/route.js                  Ready-to-post plain-text digest of the day's games (/text)
  sitemap.xml/route.js           Sitemap from the KV URL registry (live-sweep fallback)
  api/fixtures/route.js          Cached FotMob fixtures-by-date proxy (long-term/DB-backed)
  api/tv/route.js                Cached proxy for TheSportsDB TV listings
  api/fmtv/route.js              Unofficial FotMob TV proxy (free day-bulk, Portugal-first)
  api/sofatv/route.js            Unofficial SofaScore TV proxy (on-demand fallback)
  api/listings/route.js          Serves tv:rich:<date>; revalidates on visit (Next after()); folds in manual overrides
  api/overrides/route.js         Admin CRUD for manual TV overrides (Basic Auth: ADMIN_USER / ADMIN_PASSWORD)
  api/ads/route.js               Admin CRUD for the ad units list (lib/ads-store.js), consumed by <AdSlot> (Basic Auth)
  api/flags/route.js             Admin CRUD for feature flags (lib/flags.js), consumed via isEnabled() (Basic Auth)
  api/buffer/route.js            Admin Buffer management + schedule log; schedule a post on demand (Basic Auth)
  api/matchdetails/route.js      Per-match FotMob detail (venue, timeline, lineups, h2h, stats)
  api/highlights/route.js        Reads the collected highlights back as a feed
  api/cron-listings/route.js     Daily pre-warm of the upcoming window (shares lib/listings-build.js with on-visit refresh)
  api/cron-highlights/route.js   Background sweep: collects highlights for finished games into KV (external cron)
  api/cron-sitemap/route.js      Daily sweep: records canonical SEO URLs into the KV registry (Vercel cron)
  api/cron-buffer/route.js       Daily: schedules tomorrow's games post (square + caption) on Buffer for 09:00 UTC (external GitHub Actions cron)
  api/seo/route.js               Admin endpoint to inspect/sweep/prune the pSEO sitemap registry (Basic Auth)
  api/geo/route.js               Visitor country (Vercel edge header) for the default listings country
  api/health/route.js            Read-only config/KV diagnostics for the admin page
components/GamesBrowser.jsx      The interactive games browser (client island): date nav, country picker, league filter, search, cards, detail modal
components/AdSlot.jsx             Server component: renders the admin-managed ad units assigned to one layout slot
components/AdUnits.jsx            Client component: injects parsed ad markup/scripts after mount (avoids hydration mismatches from self-placing loaders)
components/AdDebug.jsx            Opt-in (?addebug=1) on-page panel: watches script loads/errors and ad-blocker signals for live debugging
lib/app-data.js                  Client data layer: fetch/merge fixtures + TV, match details, highlights, ordering
lib/format.js                    Shared helpers (dates, slugs, status, share links)
lib/i18n.js                      EN/PT translation table + language helpers
lib/broadcasters.js              Free-to-air channel classifier (green vs amber)
lib/ads-store.js                 Ad unit store (KV-backed): admin-managed snippets + slot assignment, read by <AdSlot> and /api/ads
lib/flags.js                     Feature flags (KV-backed): off/dev/staging/production per-env switch read via isEnabled(), e.g. <AdSlot>'s "ads" flag — see "Feature flags" below
lib/ads.js                       Legacy AdSense config — unused; superseded by lib/ads-store.js + /admin/ads
lib/kv.js                        Vercel KV (Upstash Redis REST) client, shared by the data routes
lib/cardinfo.js                  Rebuilds a game's share-card data from its match id (FotMob + KV cache)
lib/seo-render.js                Renders the /g per-game + league HTML pages (metadata, JSON-LD, body)
lib/digest-render.js             Renders the /today and /image pages
lib/digest-select.js             Shared "day's top games" selection (well-known competitions + ranking) for every digest surface
lib/digest-image-endpoint.js     Factory for the /image/{landscape,square,portrait} ready-to-post PNGs
lib/digest-text.js               Builds the /text plain-text digest (ranking, flags, one PT channel per game)
lib/buffer-post.js               Buffer GraphQL client: schedule a post per channel (createPost) + channel discovery + a KV schedule log; used by /api/cron-buffer and /api/buffer
lib/country-flags.js             National-team name → flag emoji (EN + PT names) for the text digest
lib/sitemap-sweep.js             Builds the canonical SEO URL map + KV registry helpers, shared by the sitemap, its cron and /api/seo
assets/styles.css                Styling (imported by the app layout)
public/admin/                    Admin console (noindex): /admin connections debugger, /admin/overrides, /admin/seo, /admin/ads, /admin/ad-test, /admin/flags, /admin/buffer
public/assets/og-image.svg       Default social share / Open Graph card
public/robots.txt                Crawl rules (allows the site, disallows /admin + /api)
public/llms.txt                  Site summary for LLM/AI crawlers
middleware.js                    Edge HTTP Basic Auth gating /admin + /api/overrides + /api/ads + /api/seo + /api/flags + /api/buffer (ADMIN_USER / ADMIN_PASSWORD)
vercel.json                      Crons → /api/cron-sitemap + /api/cron-listings + /api/cron-tick (all daily; listings also revalidates on visit)
next.config.js                   Next.js config
package.json                     next, react, @vercel/og, @vercel/analytics
.github/workflows/highlights-cron.yml  Free external cron that pings /api/cron-highlights every ~30 min
.github/workflows/buffer-cron.yml      Free external cron that pings /api/cron-buffer daily at 07:00 UTC
```

> **Routing is file-based.** Each public path maps to a file under `app/` (no
> rewrites). The old `api/share.js` + `api/league.js` (which shared one function
> to serve several pages) are now the `app/(seo)/…` pages and `app/api/…` route
> handlers; the sitemap is `app/sitemap.xml/route.js`. Shared logic stays in
> `lib/` so it's imported, not duplicated per route.

## Programmatic SEO (the `/g/…` pages + sitemap)

The per-game (`/g/<id>`, `/g/<date>/<slug>`) and league-hub (`/g/<league>`)
pages are server-rendered **programmatic SEO** (pSEO): `lib/seo-render.js` builds
each one from the live fixtures feed and only marks it **indexable** when it has
real data for a *notable* competition (`index, follow` then, `noindex, follow`
otherwise — so empty/obscure pages never enter the index). Their canonical URLs
are collected into a KV registry (`seo:urls`) that `/sitemap.xml` serves;
`app/api/cron-sitemap` refreshes it daily (with `lib/sitemap-sweep` providing the
sweep and the registry read/write/prune helpers).

**Managing it — `/admin/seo`** (and its API, `/api/seo`, Basic-Auth gated like
the rest of the admin surface). The page shows the registry status (total URLs,
hubs vs match pages, lastmod range), and lets the owner **sweep** on demand
(same scan as the cron), **rebuild** (clear + sweep), **prune** stale entries
(older than `SITEMAP_PRUNE_DAYS`), browse/filter the registered URLs by prefix,
or remove a single URL / clear everything — useful to confirm the pSEO pages are
being registered without waiting for the daily cron. Needs KV connected to
persist; needs the fixtures feed reachable for a sweep to find anything.

> **Share previews need the Node/Vercel runtime.** `/og` runs on the edge
> runtime via `next/og` (`@vercel/og`) — so the custom images render on a Vercel
> deployment or `npm run dev`. Each game's preview is cached hard at the CDN.
> Note FotMob's image CDN can 403 server-side crest fetches; when a crest can't
> be loaded the card falls back to a team-initial monogram, so the image always
> renders.

The card shows the **primary country**'s channels first; the rest fold into the
match-details modal. The primary country defaults to the visitor's country via
`api/geo` (Vercel's `x-vercel-ip-country` edge header — no geolocation prompt),
falls back to Portugal, and can be changed with the country picker in the
toolbar (the choice is remembered in `localStorage`).

## Where the fixtures come from

The day's games come from **FotMob** (unofficial, free) via the cached
`/api/fixtures` proxy. FotMob's `GET /api/data/matches?date=YYYYMMDD` returns
every match for a date grouped by league in a **single call**, each carrying
team names + ids, league name + id, kickoff, score and live status — so the app
gets the whole day's fixtures, logos and live scores without the per-league
fan-out that used to get TheSportsDB's free key rate-limited (the original
*“load fixtures failing”*). Like the other FotMob feeds it's best-effort and can
be disabled with `FOTMOB_DISABLED=1`; append `&debug=1` to inspect what it
returned.

By default `/api/fixtures` keeps only the **major competitions** (`MAJOR_LEAGUE_IDS`)
so the app isn't flooded with thousands of low-interest worldwide fixtures.
**Exception:** if a date has games but *none* of them are major — e.g. mid-summer,
when domestic leagues are finished and the only football is the World Cup / Euro —
it falls back to returning every competition for that day rather than showing a
blank app (`_debug.majorFallback` flags it). Pass `?all=1` to always get
everything.

It's **long-term cached / DB-backed** (Vercel KV) so calls stay minimal:

- **Past dates**, and **today once every match is finished**, are cached
  permanently — results are final, so they never re-hit upstream.
- **Future dates** cache for 1 hour; **today with unfinished games** caches for
  90s so live scores stay fresh (only days that actually have live/upcoming
  matches pay the refresh cost).
- Every successful fetch also writes a permanent `fx:bak:DATE` **backup** that is
  served if a later fetch fails or FotMob is blocked, so any date seen once keeps
  rendering offline-from-upstream.

TheSportsDB is no longer used for fixtures — only for TV listings (below).

## Where the TV data comes from

Real per-match channels are **merged** from several free feeds, then surfaced
**Portugal-first** (this is a Portuguese app). Listings load in the background
for every visible match, so they appear on the cards without a click.

1. **TheSportsDB** `eventstv.php?d=DATE&s=Soccer` — the whole day's TV schedule
   (one call), loaded up front for every match.
2. **TheSportsDB** `lookuptv.php?id=EVENT` — a single match's broadcasts, used
   to fill gaps the day feed missed.
3. **SofaScore** (unofficial) via `app/api/sofatv/route.js` — **off by default**
   (`USE_SOFASCORE = false` in `lib/app-data.js`) now that FotMob covers Portugal;
   kept as an optional per-match fallback. When enabled it maps a fixture to its
   SofaScore event by date + team names, then uses these endpoints (confirmed
   against several open-source SofaScore clients on GitHub):
   - `GET /api/v1/sport/football/scheduled-events/{date}` — the day's events.
   - `GET /api/v1/tv/event/{eventId}/country-channels` — `{ countryChannels:
     { "PT": [channelId, …] } }`.
   - `GET /api/v1/tv/country/{code}/popular-channels` — batch id→name per
     country (one call instead of one per channel).
   - `GET /api/v1/tv/channel/{id}` — per-id name fallback.

   ⚠️ SofaScore is **unofficial and against its ToS**; it may be blocked at any
   time and degrades gracefully to nothing. Disable it with
   `SOFASCORE_DISABLED=1`.
4. **FotMob** (unofficial, free) via `app/api/fmtv/route.js` — merged in for every match.
   FotMob's `GET /api/data/tvlistings?countryCode=XX` returns a whole region's
   listings keyed by matchId, each carrying the team names and channel, so one
   call per country yields a full day's broadcasters with no matchId mapping.
   The proxy queries a Portugal-first set of countries (`FOTMOB_COUNTRIES`,
   default `PT,GB,ES,BR,US,FR,DE,IT,NL`), merges by match, and returns a
   per-match map the client merges into every fixture. Like SofaScore it's
   unofficial and best-effort; disable with `FOTMOB_DISABLED=1`. Append
   `&debug=1` to inspect what FotMob returned (per-country counts + a sample);
   add `&home=<team>&away=<team>` to see that one match's channels grouped by
   country (and any `nearMisses` where a team-name mismatch dropped a listing) —
   this is what the `/admin` match picker drives to debug a missing
   broadcaster like "Sport TV 5 not showing for Switzerland vs Bosnia".

   Listings join onto fixtures **by FotMob match id** (the `tvlistings` map key
   is the same global id as a fixture's `fmid`), with name matching only as a
   fallback. This is robust against per-country localized team names — FotMob's
   PT feed may say "Suíça"/"Bósnia e Herzegovina" where GB says
   "Switzerland"/"Bosnia & Herzegovina", which used to fragment a match and drop
   the Portuguese listing.
5. **Accumulated daily store** — `lib/listings-build.js` builds a merged store
   per date and two paths keep it filled. No single free source is complete, and
   broadcasters publish listings piecemeal as kickoff nears (which is why Sport
   TV 5 can appear late). One build joins FotMob listings by match id and **fills
   gaps from SofaScore** (Portugal-first, budgeted), then **merges into the
   previous result** so coverage only grows — once a channel is seen it sticks.
   It writes `tv:rich:<date>` (keyed by `fmid`, 14-day TTL); `/api/listings?date=`
   serves it and the client/SEO pages merge it in as the richest source.

   It is refreshed two ways, so no high-frequency cron is needed:
   - **On-visit revalidation** (`app/api/listings/route.js`): each read serves
     the cached store instantly, then — for today/upcoming dates — rebuilds *that
     date* in the background via Next's `after`, off the response path. A KV
     `tv:rich:lock:<date>` (NX+EX, `LISTINGS_REVALIDATE_SEC`, default 30 min)
     debounces it to once per window however heavy the traffic, so the current
     visitor may see slightly stale data and the next ones get it fresher.
   - **Daily sweep** (`app/api/cron-listings/route.js`, in `vercel.json`):
     pre-warms the upcoming window (`LISTINGS_DAYS`, default 3) once a day so
     dates nobody has visited yet are populated. Pokeable externally too; protect
     with `CRON_SECRET`.

   Env: `LISTINGS_SOFA_BUDGET` (40, cron), `LISTINGS_VISIT_SOFA_BUDGET` (12,
   on-visit), `LISTINGS_REVALIDATE_SEC` (1800). Inspect it in `/admin` via
   the **Merged store (api/listings)** test.
6. **Manual overrides** (`lib/overrides.js`, `app/api/overrides/route.js`) — the
   highest-trust source, for the rare match no free feed covers in a country
   (e.g. FotMob's PT feed occasionally omits a single World Cup game while
   carrying all the others, and SofaScore is blocked from the server). The owner
   adds broadcasters by hand in `/admin` (the **Manual TV override** card);
   they're stored in KV under `tv:overrides` and merged into the listings store
   (at build) and `/api/listings` (instantly, so they show without waiting for a
   rebuild). The admin surface is gated by HTTP Basic Auth — set `ADMIN_USER` /
   `ADMIN_PASSWORD` in the env (see `middleware.js`). Until those are set the
   debug page stays open but overrides can't be written (fail-closed).

There is no automatic guessed fallback — if no source (or override) has a
listing, the match shows *“No TV listing yet”*.

> Note: **API-Football** (api-sports.io) was evaluated but has **no
> broadcaster/TV data** (fixtures, scores, odds, stats only), so it can't add
> channel listings.

## Highlights of finished games (background cron)

Highlights used to be resolved **only on demand** — you opened a finished match
and the detail modal fetched FotMob for a clip link (or fell back to a YouTube
search). `app/api/cron-highlights/route.js` adds a **background sweep** that
collects them ahead of time and stores them in KV, so they're ready instantly
and can be served as a feed (`/api/highlights`).

Each run it:

1. Scans FotMob's day feed for **today + yesterday** (UTC) — yesterday is kept so
   late-night finishes get picked up on the next run.
2. Keeps **finished** matches in the major competitions (same `MAJOR_LEAGUE_IDS`
   set as fixtures).
3. Resolves a highlights link per match — FotMob's own clip URL when present,
   plus a keyless **YouTube search** fallback that's always attached.
4. Resolves an **embeddable YouTube video id** so the client can play the clip
   inline: it reads the id straight out of FotMob's clip when that's a YouTube
   link (the common case, no API needed), and otherwise — if `YOUTUBE_API_KEY`
   is set — asks the **YouTube Data API** for the top embeddable result. It also
   records each clip's `provider` (youtube / x / streamable / host) so you can
   see the real source mix in the run summary.
5. Writes `hl:<fmid>` (per match) and `hl:day:<date>` (the day's map) to KV with a
   90-day TTL. It only re-fetches match details / re-resolves a video for games
   that don't already have one, so repeat runs are cheap and **don't burn YouTube
   quota**. Detail fetches are capped by `HL_DETAIL_LIMIT` (default 40) and Data
   API searches by `HL_YT_LIMIT` (default 25) per run.

On the client, finished games whose highlight has been collected show a
**▶ Highlights button on the game card** (the app indexes `/api/highlights` by
match id on load), and the **match-details modal embeds the video inline**
(click-to-load via `youtube-nocookie.com`, so no YouTube cookies until the user
hits play). `app/api/matchdetails/route.js` also merges a stored clip/video when
FotMob's live payload doesn't include one yet, and `GET /api/highlights` returns the
collected list (most-recent first; `?date=YYYY-MM-DD`, `?days=N`, or `?withUrl=1`
for only real clips).

> **Embedding without a key:** most football highlights on FotMob are already
> YouTube links, so inline playback works with **no `YOUTUBE_API_KEY`** for those
> games. The key only adds coverage for matches whose FotMob clip is on another
> host (or missing). Get a free key from the Google Cloud console (enable
> *YouTube Data API v3*) and add it as `YOUTUBE_API_KEY` in the Vercel env — the
> free tier's 10k units/day ≈ 100 searches, and the cap + reuse above keep usage
> well under that.

**Triggering it — use an external cron.** Vercel's free (Hobby) plan only allows
a **daily** cron, which is too coarse for clips that appear minutes after full
time. So `api/cron-highlights.js` is a normal route handler meant to be poked by an
external scheduler every ~30 min:

```
GET /api/cron-highlights            # today + yesterday
GET /api/cron-highlights?date=2026-06-15
GET /api/cron-highlights?days=3&debug=1
```

- **Protect it:** set `CRON_SECRET` in the Vercel env, and send it as
  `Authorization: Bearer <secret>` (or `?key=<secret>`). With no secret set the
  endpoint is open.
- **Included scheduler:** `.github/workflows/highlights-cron.yml` runs every 30
  minutes on GitHub Actions (free). Add repo secrets `SITE_URL` (your deployment
  URL) and `CRON_SECRET`, and it `curl`s the endpoint for you. You can also run
  it from the Actions tab. *(GitHub schedules can be delayed under load and pause
  after 60 days of repo inactivity — for strict timing point [cron-job.org](https://cron-job.org)
  or EasyCron at the same URL instead.)*
- Storing anything **requires KV** (see below); without it the endpoint returns
  `{ ok: false }` and does nothing.

## Caching (Vercel KV)

`app/api/fixtures/route.js` (fixtures) and `app/api/tv/route.js` /
`app/api/fmtv/route.js` (TV) proxy the upstream calls and cache the responses so
repeat loads and visitors don't re-hit the upstream APIs. Fixtures are
additionally **DB-backed** (a permanent backup per date) so past days are served
entirely from KV. The routes work with no DB (pass-through), and the client falls
back to calling TheSportsDB directly for TV if the route isn't deployed — but to
enable caching on Vercel:

1. In your Vercel project, open **Storage → Create Database → Upstash for Redis**
   (Vercel's first-party "KV" is now provisioned via the Upstash marketplace),
   pick a region near your users, and **Connect** it to the project. This injects
   the REST credentials automatically. The proxies read `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`, falling back to `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN`, so either naming the integration injects will work.
   Verify on `/admin` (Health → `KV ✅ PONG`) or an `X-Cache: HIT` header.
2. *(Optional)* set `THESPORTSDB_KEY` if you have a premium key — otherwise it
   defaults to the free `123` key.
3. Redeploy. Responses include an `X-Cache: HIT|MISS` header so you can verify
   caching is working.

> **Before launch — enable KV.** FotMob is fetched once per page load, one
> request per country in `FOTMOB_COUNTRIES` (9 by default). Without KV every
> visitor triggers all of them live, which is slow and risks FotMob
> rate-limiting/blocking the deployment. With KV connected it becomes ~one
> cached fetch per ~30 min for everyone. The `/admin` health check shows
> whether KV is reachable.

Cache TTL adapts to the date. For TV: ~10 min for today (so live listings stay
fresh), 1 hour for future dates, and 24 hours for past dates. For fixtures: past
days (and today once all games are finished) are cached permanently, future days
1 hour, and today-with-live-games 90s — plus the permanent per-date backup.

> TV listings are crowd-sourced and can vary by region, platform and individual
> match. Always confirm with your provider.

## Feature flags

`lib/flags.js` is a small KV-backed store of per-environment switches the owner
can flip from **`/admin/flags`** without a deploy — no env var, no redeploy.
Flags are read fresh from KV on every request (no time-based cache, unlike
ads/overrides), so a save is live immediately. Reads are de-duped within a
single render via React `cache()`, so multiple `isEnabled()` checks on one page
share one KV read.

Each flag names exactly **where it's on** (four states):

- **`off`** — on nowhere.
- **`dev`** — on **only** in local dev.
- **`staging`** — on **only** on staging.
- **`production`** — on **all hosts**.

The environment is resolved per-request from the host: `localhost` / `127.0.0.1`
→ **dev**, `hojehabola.cfd` → **staging**, every other host (`hojehabola.com`,
`footietoday.com`, `footytoday.co`, …) → **production**. `dev` and `staging` are
*exact* matches — a `staging` flag is off on localhost and off in production.
Only `production` is on everywhere. Legacy boolean overrides from the old on/off
scheme are read as `true → production`, `false → off`. Current flags:

- **`ads`** — ad slots (home-top, home-bottom, fixtures-feed, detail-top,
  detail-bottom) rendered by `<AdSlot>` and the in-feed/detail injections. A
  kill switch independent of the ad-unit list in `/admin/ads` — off hides every
  placement immediately. Defaults **production** (on everywhere).
- **`homepage-debug-banner`** — a hardcoded test banner in the homepage
  footer that bypasses the ads manager entirely, for checking whether a real
  ad creative renders outside the ad-units pipeline. Defaults **off**.

**Adding a new flag, every time:**

1. Add one entry to `FLAG_DEFS` in `lib/flags.js`: `{ id, label, description,
   default }`, where `default` is a state string (`"off"`, `"dev"`, `"staging"`,
   or `"production"`). `/api/flags` and `/admin/flags` read this list, so the new
   flag shows up there automatically — no other admin-surface changes needed.
2. At the point you want to gate, check it:
   ```js
   import { isEnabled } from "@/lib/flags";
   if (!(await isEnabled("your-flag-id"))) return null; // or skip the branch
   ```
   `isEnabled()` resolves the flag's state against the current environment and
   fails closed to `false` on any error (KV down, misconfigured, etc.). It reads
   the request host, so calling it opts the surrounding server component into
   dynamic rendering.
