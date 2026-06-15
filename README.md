# Hoje Há Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

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
  from the id alone** (`api/cardinfo`, FotMob + Vercel KV cache `card:<id>`), so
  nothing is crammed into the URL. Opening the link drops real visitors straight
  into the app with that match open (`/?match=fm:<id>&date=<YYYY-MM-DD>`).
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

The front end is a static site — no build step — but the **fixtures and TV data
come through the serverless functions in `api/`**, which FotMob requires (it
blocks direct browser calls via CORS). So run it with the Vercel dev server,
which serves both:

```bash
npx vercel dev
# then open the printed http://localhost:3000
```

A plain static server (e.g. `python3 -m http.server`) will serve the page but
won't have the `/api/*` functions, so fixtures won't load — use it only for
front-end-only tweaks. On Vercel, connect KV (below) so the functions cache.

## Project structure

```
index.html                       Page shell
assets/styles.css                Styling
assets/app.js                    Fetching, matching, rendering
assets/data/broadcasters.js      Free-to-air channel classifier (green vs amber)
api/fixtures.js                  Cached FotMob fixtures-by-date proxy (long-term/DB-backed)
api/share.js                     Per-game share page (/g/<id>) — Open Graph card + deep link into the app
api/og.js                        Per-game preview image (/og/<id>) generated on the fly (1200×630 PNG, @vercel/og)
api/cardinfo.js                  Rebuilds a game's share-card data from its match id (FotMob + KV cache)
api/tv.js                        Cached serverless proxy for TV listings
api/sofatv.js                    Unofficial SofaScore TV proxy (on-demand fallback)
api/fmtv.js                      Unofficial FotMob TV proxy (free day-bulk, Portugal-first)
api/cron-highlights.js           Background sweep: collects highlights for finished games into KV (external cron)
api/highlights.js                Reads the collected highlights back as a feed (/api/highlights)
api/geo.js                       Visitor country (Vercel edge header) for the default listings country
api/health.js                    Read-only config/KV diagnostics for the admin page
admin.html                       Connections debugger (live-tests every source, noindex)
assets/og-image.svg              Social share / Open Graph card
robots.txt                       Crawl rules (allows the site, disallows admin.html + /api)
sitemap.xml                      Sitemap (homepage only; admin.html excluded)
llms.txt                         Site summary for LLM/AI crawlers
vercel.json                      Rewrites the public /g/<id> and /og/<id> paths; raises the cron function's time budget
package.json                     Declares the @vercel/og dependency (for the on-the-fly preview image)
.github/workflows/highlights-cron.yml  Free external cron that pings /api/cron-highlights every ~30 min
```

> **Share previews need the Node/Vercel runtime.** `/og` runs on Vercel's edge
> runtime and `@vercel/og` is installed from `package.json` at deploy — so the
> custom per-game images only render on a Vercel deployment (or `vercel dev`),
> not on a plain static server. Each game's preview is also cached hard at the
> CDN. Note FotMob's image CDN can 403 server-side crest fetches; when a crest
> can't be loaded the card falls back to a team-initial monogram, so the image
> always renders.

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
3. **SofaScore** (unofficial) via `api/sofatv.js` — **off by default**
   (`USE_SOFASCORE = false` in `assets/app.js`) now that FotMob covers Portugal;
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
4. **FotMob** (unofficial, free) via `api/fmtv.js` — merged in for every match.
   FotMob's `GET /api/data/tvlistings?countryCode=XX` returns a whole region's
   listings keyed by matchId, each carrying the team names and channel, so one
   call per country yields a full day's broadcasters with no matchId mapping.
   The proxy queries a Portugal-first set of countries (`FOTMOB_COUNTRIES`,
   default `PT,GB,ES,BR,US,FR,DE,IT,NL`), merges by match, and returns a
   per-match map the client merges into every fixture. Like SofaScore it's
   unofficial and best-effort; disable with `FOTMOB_DISABLED=1`. Append
   `&debug=1` to inspect what FotMob returned (per-country counts + a sample).

There is no curated/guessed fallback — if no source has a listing, the match
shows *“No TV listing yet”*.

> Note: **API-Football** (api-sports.io) was evaluated but has **no
> broadcaster/TV data** (fixtures, scores, odds, stats only), so it can't add
> channel listings.

## Highlights of finished games (background cron)

Highlights used to be resolved **only on demand** — you opened a finished match
and the detail modal fetched FotMob for a clip link (or fell back to a YouTube
search). `api/cron-highlights.js` adds a **background sweep** that collects them
ahead of time and stores them in KV, so they're ready instantly and can be
served as a feed (`/api/highlights`).

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
hits play). `api/matchdetails.js` also merges a stored clip/video when FotMob's
live payload doesn't include one yet, and `GET /api/highlights` returns the
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
time. So `api/cron-highlights.js` is a normal endpoint meant to be poked by an
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

`api/fixtures.js` (fixtures) and `api/tv.js` / `api/fmtv.js` (TV) proxy the
upstream calls and cache the responses so repeat loads and visitors don't re-hit
the upstream APIs. Fixtures are additionally **DB-backed** (a permanent backup
per date) so past days are served entirely from KV. The proxies work with no DB
(pass-through), and the client falls back to calling TheSportsDB directly for TV
if the function isn't deployed — but to enable caching on Vercel:

1. In your Vercel project, open **Storage → Create Database → Upstash for Redis**
   (Vercel's first-party "KV" is now provisioned via the Upstash marketplace),
   pick a region near your users, and **Connect** it to the project. This injects
   the REST credentials automatically. The proxies read `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`, falling back to `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN`, so either naming the integration injects will work.
   Verify on `/admin.html` (Health → `KV ✅ PONG`) or an `X-Cache: HIT` header.
2. *(Optional)* set `THESPORTSDB_KEY` if you have a premium key — otherwise it
   defaults to the free `123` key.
3. Redeploy. Responses include an `X-Cache: HIT|MISS` header so you can verify
   caching is working.

> **Before launch — enable KV.** FotMob is fetched once per page load, one
> request per country in `FOTMOB_COUNTRIES` (9 by default). Without KV every
> visitor triggers all of them live, which is slow and risks FotMob
> rate-limiting/blocking the deployment. With KV connected it becomes ~one
> cached fetch per ~30 min for everyone. The `/admin.html` health check shows
> whether KV is reachable.

Cache TTL adapts to the date. For TV: ~10 min for today (so live listings stay
fresh), 1 hour for future dates, and 24 hours for past dates. For fixtures: past
days (and today once all games are finished) are cached permanently, future days
1 hour, and today-with-live-games 90s — plus the permanent per-date backup.

> TV listings are crowd-sourced and can vary by region, platform and individual
> match. Always confirm with your provider.
