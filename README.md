# Onde Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

## Features

- **Today's games worldwide** — every soccer fixture for the day from across
  the globe is fetched live from the free [TheSportsDB](https://www.thesportsdb.com)
  API and grouped by competition, each headed with the **championship's logo**
  (falling back to a monogram when the feed has no artwork).
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
- **Date navigation** — jump to previous/next day or back to today.
- **Live scores & status** — in-play matches show the current score, the
  minute (e.g. `67'`) or `HT`, and a pulsing live badge; finished games show
  `FT`. Today's view auto-refreshes from the feed every 60s.
- **Broad coverage** — alongside the worldwide feed, the app also queries a
  set of leagues that commonly run mid-year (MLS, Brazil, Nordic, Asian
  leagues, …) and merges their games, so coverage stays wide even when a big
  tournament like the World Cup pauses the major domestic leagues.
- **League filter** — open **Leagues** to show/hide individual competitions.
  A **Reset filters** button clears the selection, and a **Remember this next
  time** checkbox persists your choices to `localStorage` across visits (leave
  it unchecked to keep the filter for the current session only).
- **Search** — filter by team or competition.
- **Real data only** — no placeholder/sample schedule. When there are no
  fixtures, or the live feed can't be reached, the app shows a clear empty
  state instead of fake games.

## Running it

It's a static site — no build step required.

```bash
# from the project root, any static server works:
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in a browser (live data fetching works best
when served over `http://`).

## Project structure

```
index.html                       Page shell
assets/styles.css                Styling
assets/app.js                    Fetching, matching, rendering
assets/data/broadcasters.js      Free-to-air channel classifier (green vs amber)
api/tv.js                        Cached serverless proxy for TV listings
api/sofatv.js                    Unofficial SofaScore TV proxy (on-demand fallback)
api/fmtv.js                      Unofficial FotMob TV proxy (free day-bulk, Portugal-first)
api/smtv.js                      SportMonks TV proxy (optional, paid; needs SPORTMONKS_KEY)
api/geo.js                       Visitor country (Vercel edge header) for the default listings country
api/health.js                    Read-only config/KV diagnostics for the admin page
admin.html                       Connections debugger (live-tests every source)
```

The card shows the **primary country**'s channels first; the rest fold into the
match-details modal. The primary country defaults to the visitor's country via
`api/geo` (Vercel's `x-vercel-ip-country` edge header — no geolocation prompt),
falls back to Portugal, and can be changed with the country picker in the
toolbar (the choice is remembered in `localStorage`).

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
   default `PT,GB,ES,BR,US,FR,DE,IT,NL`), merges by match, and returns the same
   shape as SportMonks so the client merges it identically. Like SofaScore it's
   unofficial and best-effort; disable with `FOTMOB_DISABLED=1`. Append
   `&debug=1` to inspect what FotMob returned (per-country counts + a sample).
5. **SportMonks** (official, paid) via `api/smtv.js` — *optional*, off unless a
   key is set. SportMonks returns a whole day's fixtures with their TV stations
   in **one call** (`GET /v3/football/fixtures/date/{date}?include=participants;
   tvStations.tvStation;tvStations.country`), so the client fetches it once per
   day and merges broadcasters into every match — no per-match call. Requires a
   SportMonks plan whose subscription includes the `tvStations` entity. Enable
   by setting `SPORTMONKS_KEY`; with no key the endpoint returns an empty map
   and nothing changes.

There is no curated/guessed fallback — if no source has a listing, the match
shows *“No TV listing yet”*.

> Note: **API-Football** (api-sports.io) was evaluated but has **no
> broadcaster/TV data** (fixtures, scores, odds, stats only), so it can't add
> channel listings. SportMonks is the API that exposes `tvStations`.

## Caching (Vercel KV)

`api/tv.js` proxies those calls and caches the responses so repeat loads and
visitors don't re-hit the upstream API. It works with no DB (pass-through), and
the client falls back to calling TheSportsDB directly if the function isn't
deployed — but to enable caching on Vercel:

1. In your Vercel project, create a **KV** store (Storage → Create → KV) and
   connect it to the project. This injects `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically.
2. *(Optional)* set `THESPORTSDB_KEY` if you have a premium key — otherwise it
   defaults to the free `123` key.
3. *(Optional)* set `SPORTMONKS_KEY` to enable the SportMonks broadcaster source
   (`api/smtv.js`). Leave unset to keep it disabled.
4. Redeploy. Responses include an `X-Cache: HIT|MISS` header so you can verify
   caching is working.

> **Before launch — enable KV.** FotMob is fetched once per page load, one
> request per country in `FOTMOB_COUNTRIES` (9 by default). Without KV every
> visitor triggers all of them live, which is slow and risks FotMob
> rate-limiting/blocking the deployment. With KV connected it becomes ~one
> cached fetch per ~30 min for everyone. The `/admin.html` health check shows
> whether KV is reachable.

Cache TTL adapts to the date: ~10 min for today (so live listings stay fresh),
1 hour for future dates, and 24 hours for past dates.

> TV listings are crowd-sourced and can vary by region, platform and individual
> match. Always confirm with your provider.
