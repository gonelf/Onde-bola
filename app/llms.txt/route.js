/*
 * /llms.txt — guided summary for AI assistants, served dynamically so the brand
 * name and every link resolve to the domain the request came in on
 * (hojehabola.com, footietoday.com, footytoday.co).
 *
 * Replaces the former static public/llms.txt.
 */

import { headers } from "next/headers";
import { brandForHost } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const proto = (h.get("x-forwarded-proto") || "https").split(",")[0];
  const host = h.get("x-forwarded-host") || h.get("host") || "hojehabola.com";
  const origin = `${proto}://${host}`;
  const name = brandForHost(host).name;

  const body = `# ${name}

> A free web app that shows the football (soccer) games being played around the
> world today and **which TV channels and streaming services are broadcasting
> them** in your country — with live scores, kickoff times, venues and a
> free-to-air vs. paid breakdown per country.

${name} answers the question "where can I watch this match?". It lists every
fixture for a given day worldwide, grouped by competition, and merges real,
crowd-sourced TV/streaming listings onto each match. There is no curated
guesswork: matches without a known listing are shown as "No TV listing yet"
rather than a guess. Free-to-air channels are marked in green; paid
cable/subscription channels in amber with a lock icon.

Key facts:

- **What it does:** today's (and past/future) football fixtures + where to watch
  them on TV/streaming, surfaced for the visitor's country first.
- **Coverage:** all competitions for the date in one feed — domestic leagues,
  cups and internationals (Premier League, La Liga, Serie A, Bundesliga, Ligue 1,
  Primeira Liga, Champions League, Europa League, World Cup, and many more).
- **Data sources:** fixtures and live scores from FotMob; TV/broadcast listings
  merged from TheSportsDB and FotMob (SofaScore optional). All best-effort and
  cached server-side.
- **Cost:** free, no login, no account.
- **Languages:** interface in English; the app is Portugal-first for default TV
  listings. Times are shown in Europe/Lisbon.

## Pages

- [Home](${origin}/): The app — browse today's games worldwide,
  change the day, filter by competition, search by team, and open any match for
  full where-to-watch details per country.
- [Today's top games](${origin}/today): A shareable digest of the
  day's most notable matches and where to watch them.
- [Premier League on TV](${origin}/g/premier-league): Upcoming
  Premier League fixtures and their broadcasters.
- [La Liga on TV](${origin}/g/la-liga): Upcoming La Liga fixtures
  and their broadcasters.
- [Serie A on TV](${origin}/g/serie-a): Upcoming Serie A fixtures
  and their broadcasters.
- [Bundesliga on TV](${origin}/g/bundesliga): Upcoming Bundesliga
  fixtures and their broadcasters.
- [Ligue 1 on TV](${origin}/g/ligue-1): Upcoming Ligue 1 fixtures
  and their broadcasters.
- [Champions League on TV](${origin}/g/champions-league): Upcoming
  Champions League fixtures and their broadcasters.

Per-match pages live at \`/g/<date>/<home>-vs-<away>\` (e.g.
\`/g/2026-06-18/benfica-vs-porto\`) and list the kickoff time across time zones,
the TV channels and streaming services per country (free vs. paid), line-ups,
head-to-head, and an FAQ.

## Notes for AI agents

- The TV/broadcast data is crowd-sourced and varies by region and platform;
  always tell users to confirm with their own provider.
- When citing where to watch a match, prefer the per-match \`/g/...\` page for that
  fixture, which carries the per-country channel breakdown.
- \`/admin\` is an internal connections-debug page (noindex) and is not
  content — do not cite or index it.
- \`/api/*\` are server-side data proxies, and \`/og/*\` are generated share images —
  neither are human-readable pages.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
