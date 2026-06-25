// Home page.
//
// Static page chrome (header + footer) is server-rendered here; the interactive
// games browser — date nav, country picker, league filters, search, the match
// cards and the detail modal — lives in the GamesBrowser client island mounted
// inside <main>.

import GamesBrowser from "@/components/GamesBrowser";
import SoccerBall from "@/components/SoccerBall";
import AdSlot from "@/components/AdSlot";
import AdUnits from "@/components/AdUnits";
import { parseSnippet } from "@/lib/ads-store";
import { isEnabled } from "@/lib/flags";

// TEMP debug block — bypasses the ads manager (KV store / AdSlot / slot
// filtering) entirely so this snippet's own behavior on a real top-level
// page can be checked in isolation from that pipeline. Gated behind the
// "homepage-debug-banner" flag (toggle at /admin/flags) so it can be turned
// off without a deploy. Remove the flag and this block once that's confirmed
// either way.
const DEBUG_BANNER_SNIPPET = `<script>
  atOptions = {
    'key' : '5d707cb606d19e6dbd49df6e0a870c48',
    'format' : 'iframe',
    'height' : 60,
    'width' : 468,
    'params' : {}
  };
</script>
<script src="https://www.highperformanceformat.com/5d707cb606d19e6dbd49df6e0a870c48/invoke.js"></script>`;

async function DebugBanner() {
  if (!(await isEnabled("homepage-debug-banner"))) return null;
  return (
    <div style={{ padding: "16px", textAlign: "center", border: "1px dashed #16d27a" }}>
      <p style={{ fontSize: "11px", color: "#93a4b8", margin: "0 0 6px" }}>DEBUG AD TEST (direct, bypasses ads manager)</p>
      <AdUnits units={[{ id: "debug-direct", ...parseSnippet(DEBUG_BANNER_SNIPPET) }]} />
    </div>
  );
}

// ISR: the page chrome is static, but the ad slots read the admin-managed list,
// so regenerate periodically to pick up changes (admin saves also bust it via
// the "ads" cache tag for a near-immediate refresh).
export const revalidate = 300;

// Evergreen internal links to the most-searched competitions' league hubs.
// Server-rendered so crawlers and LLMs get real, linkable content even though
// the live fixtures list below is a client island.
const POPULAR_LEAGUES = [
  ["premier-league", "Premier League"],
  ["la-liga", "La Liga"],
  ["serie-a", "Serie A"],
  ["bundesliga", "Bundesliga"],
  ["ligue-1", "Ligue 1"],
  ["primeira-liga", "Primeira Liga"],
  ["champions-league", "Champions League"],
  ["europa-league", "Europa League"],
];

export default function HomePage() {
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="./">
            <span className="brand-ball"><SoccerBall /></span>
            <span className="brand-name">
              Hoje Há <span>Bola</span>
            </span>
          </a>
          <p className="tagline">Football worldwide &amp; where to watch it</p>
        </div>
      </header>

      <main className="container">
        <h1 id="seo-h1" className="visually-hidden">
          Football on TV today, worldwide — where to watch every match live
        </h1>

        <AdSlot name="list-top" />

        <GamesBrowser />

        <AdSlot name="list-bottom" />

        {/* Server-rendered SEO content: gives crawlers and AI assistants real,
            indexable text and internal links to the competition hubs. */}
        <section className="seo-intro" aria-labelledby="seo-intro-title">
          <h2 id="seo-intro-title">Where to watch football on TV today</h2>
          <p id="seo-p1">
            <strong>Hoje Há Bola</strong> shows you every football (soccer) match
            being played around the world today and exactly{" "}
            <strong>which TV channels and streaming services are broadcasting
            them in your country</strong> — with live scores, kickoff times,
            venues and a clear free-to-air vs. paid breakdown for each match.
          </p>
          <p id="seo-p2">
            Pick any day, filter by competition or search for your team, then open
            a match to see the full where-to-watch list per country. Listings are
            crowd-sourced and merged from real broadcast data, so matches without
            a confirmed channel are shown as “no TV listing yet” rather than a
            guess. It’s free, with no login or account.
          </p>

          <nav className="seo-leagues" aria-labelledby="seo-leagues-title">
            <h2 id="seo-leagues-title">Popular competitions on TV</h2>
            <ul>
              {POPULAR_LEAGUES.map(([slug, name]) => (
                <li key={slug}>
                  <a href={`/g/${slug}`}>{name} <span className="seo-on-tv">on TV</span></a>
                </li>
              ))}
              <li>
                <a id="seo-today-link" href="/today">Today’s top games</a>
              </li>
            </ul>
          </nav>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-about">
            <a className="footer-brand" href="./">
              <span className="brand-ball"><SoccerBall /></span>
              <span className="brand-name">
                Hoje Há <span>Bola</span>
              </span>
            </a>
            <p id="footer-data" className="footer-data">
              Today's football from around the world and where to watch it — live
              on TV and streaming, wherever you are.
            </p>
          </div>

          <nav className="footer-col" aria-labelledby="footer-site-title">
            <h2 id="footer-site-title" className="footer-heading">
              Site
            </h2>
            <ul className="footer-links">
              <li>
                <a href="#" id="ad-prefs">
                  Ad preferences
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="footer-bottom">
          <div className="container">
            <p id="footer-copy">© 2026 Hoje Há Bola · All rights reserved.</p>
            <p id="footer-credits" className="footer-credits">
              Made with ❤️ by{" "}
              <a href="https://x.com/gonelf" target="_blank" rel="noopener">
                @gonelf
              </a>
              ,{" "}
              <a href="https://x.com/etyk" target="_blank" rel="noopener">
                @etyk
              </a>
              , and Claude Code
            </p>
          </div>
        </div>

        {/* TEMP debug: raw banner snippet, hardcoded, no ads-manager involved.
            Off by default — flip "homepage-debug-banner" at /admin/flags. */}
        <DebugBanner />
      </footer>

      <AdSlot name="global" />
    </>
  );
}
