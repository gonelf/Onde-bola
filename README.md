# Onde Bola ⚽

A web app that shows the football games being played around the world right now
and **which TV channels and streaming services are broadcasting them** in your
country — inspired by [ondebola.com](https://ondebola.com/).

## Features

- **Today's games worldwide** — fixtures are fetched live from the free
  [TheSportsDB](https://www.thesportsdb.com) API, grouped by competition.
- **Where to watch** — every match is matched against a curated broadcaster
  rights table, so you see the channels/streaming services that carry it.
- **Country selector** — switch between Portugal 🇵🇹, UK 🇬🇧, USA 🇺🇸,
  Spain 🇪🇸 and Brazil 🇧🇷; listings update instantly. Your choice is
  remembered, and the app guesses a sensible default from your timezone.
- **Date navigation** — jump to previous/next day or back to today.
- **Live status** — matches in progress show a pulsing `LIVE` badge.
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
