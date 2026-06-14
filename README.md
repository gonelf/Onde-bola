# Onde Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

## Features

- **Today's games worldwide** — every soccer fixture for the day from across
  the globe is fetched live from the free [TheSportsDB](https://www.thesportsdb.com)
  API and grouped by competition, each headed with the **championship's logo**
  (falling back to a monogram when the feed has no artwork).
- **Where to watch** — real per-match broadcast channels (with country) come
  from TheSportsDB's free TV feed (`eventstv.php`) and are tagged **📡 Listings**.
  Coverage is crowd-sourced, so matches without a real listing fall back to a
  curated **Guide** of the primary rights holder per country (🇵🇹 Portugal,
  🇬🇧 UK, 🇺🇸 USA, 🇪🇸 Spain, 🇧🇷 Brazil). **Free-to-air** channels are
  shown in green and **paid cable / subscription** channels in amber with a 🔒.
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
index.html                  Page shell
assets/styles.css           Styling
assets/app.js               Fetching, matching, rendering
assets/data/broadcasters.js Competition → TV channel rights per country
assets/data/sample-fixtures.js  Fallback schedule when the feed is offline
```

## How "where to watch" works

Fixtures come from a sports data feed; the TV answer comes from a per-country
rights table in `assets/data/broadcasters.js`. To add a country or update
listings, edit that file — keys are normalised competition names and the
special `_default` key is the per-country fallback.

> TV listings are an indicative rights guide and can vary by region, platform
> and individual match. Always confirm with your provider.
