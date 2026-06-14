# Onde Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

## Features

- **Today's games worldwide** — fixtures are fetched live from the free
  [TheSportsDB](https://www.thesportsdb.com) API, grouped by competition.
- **Where to watch, everywhere** — every match lists the channels/streaming
  services that carry it in each covered country (🇵🇹 Portugal, 🇬🇧 UK,
  🇺🇸 USA, 🇪🇸 Spain, 🇧🇷 Brazil), with each country's flag in front of
  its channels — all in one combined list.
- **Date navigation** — jump to previous/next day or back to today.
- **Live scores & status** — in-play matches show the current score, the
  minute (e.g. `67'`) or `HT`, and a pulsing live badge; finished games show
  `FT`. Today's view auto-refreshes from the feed every 60s.
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
