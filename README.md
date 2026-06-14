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
- **Responsive & offline-friendly** — if the live feed can't be reached, a
  sample schedule is shown so the app is always usable.

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
assets/data/sample-fixtures.js   Fallback schedule when the feed is offline
api/tv.js                        Cached serverless proxy for TV listings
```

## Where the TV data comes from

Real per-match channels are sourced from TheSportsDB's free TV feeds:

- `eventstv.php?d=DATE&s=Soccer` — the whole day's TV schedule (one call).
- `lookuptv.php?id=EVENT` — a single match's broadcasts, fetched on demand when
  you open a match, to fill gaps the day feed missed.

There is no curated/guessed fallback — if a match has no crowd-sourced listing,
it shows *“No TV listing yet”*.

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
3. Redeploy. Responses include an `X-Cache: HIT|MISS` header so you can verify
   caching is working.

Cache TTL adapts to the date: ~10 min for today (so live listings stay fresh),
1 hour for future dates, and 24 hours for past dates.

> TV listings are crowd-sourced and can vary by region, platform and individual
> match. Always confirm with your provider.
