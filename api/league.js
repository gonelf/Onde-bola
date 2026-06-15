/*
 * /api/league  (public path: /g/<league>) — evergreen league hub.
 *
 * The durable parent in the URL hierarchy /g/<league>/<date>/<home>-vs-<away>:
 * a server-rendered page listing a competition's upcoming fixtures and where to
 * watch them, e.g. /g/liga-portugal or /g/uefa-champions-league. It updates
 * itself from the live fixtures feed, so unlike the per-match pages it persists
 * and accumulates authority. Each fixture links down to its match page; the
 * match pages link back up here, forming a tight topical cluster.
 *
 * The league is identified by its slug (accent-folded competition name). We
 * gather the next week of fixtures from our own KV-cached /api/fixtures feed and
 * keep the ones whose competition slug matches. Indexing is selective: only
 * notable competitions with upcoming fixtures compete in search.
 */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;
const titleize = (s) => String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Competitions whose hub carries an edition year (periodic tournaments +
// European continental club cups); the SEASON subset is shown as 2026/27.
const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
const SEASON_RE = /champions league|europa league|conference league|nations league|super cup/i;
function editionYear(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + 1 : y; // a season is named by the year it ends
}
function leagueSlugFor(comp, iso) {
  const base = slugify(comp || "");
  if (comp && EDITION_RE.test(comp)) {
    const y = editionYear(iso);
    if (y) return `${base}-${y}`;
  }
  return base;
}
function editionLabel(comp, iso) {
  if (!comp || !EDITION_RE.test(comp)) return "";
  const y = editionYear(iso);
  if (!y) return "";
  return SEASON_RE.test(comp) ? `${y - 1}/${String(y).slice(2)}` : String(y);
}

// Same notability gate as the match page — keeps the long tail of obscure
// competitions out of the index.
const NOTABLE = new RegExp([
  "premier league", "la ?liga", "serie a", "bundesliga", "ligue 1",
  "primeira liga", "liga portugal", "ta[cç]a de portugal",
  "champions league", "europa league", "conference league", "super cup",
  "world cup", "euro", "nations league", "copa am[eé]rica", "copa del rey",
  "fa cup", "efl cup", "carabao", "coppa italia", "dfb.?pokal", "coupe de france",
  "libertadores", "sul.?americana", "brasileir[aã]o|s[eé]rie a", "copa do brasil",
  "eredivisie", "mls", "saudi pro", "primera",
].join("|"), "i");
const isNotable = (comp) => !!comp && NOTABLE.test(comp);

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 5000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// A date in Europe/Lisbon (YYYY-MM-DD), matching the match pages' canonical.
function lisbonYmd(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lisbonTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}
function lisbonDateLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", weekday: "short", day: "numeric", month: "short",
  }).format(d);
}

const DAYS_AHEAD = 8; // today + a week of upcoming fixtures

module.exports = async (req, res) => {
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const leagueSlug = String((req.query || {}).league || "").trim().toLowerCase();
  const canonical = `${origin}/g/${leagueSlug}`;

  // Pull the next week of fixtures (own KV-cached feed) and keep this league's.
  const today = lisbonYmd(new Date());
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  const feeds = await Promise.all(
    dates.map((d) => getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000))
  );

  // De-duplicate the week's fixtures, then split into exact edition matches and
  // (for redirect) bare-slug matches of an edition competition.
  const seen = {};
  const all = [];
  feeds.forEach((feed) => {
    const list = feed && Array.isArray(feed.fixtures) ? feed.fixtures : [];
    list.forEach((f) => {
      if (!f || !f.home || !f.away) return;
      const key = f.id || f.fmid || matchSlug(f.home, f.away) + f.kickoff;
      if (seen[key]) return;
      seen[key] = true;
      all.push(f);
    });
  });

  let games = all.filter((f) => leagueSlugFor(f.competition, f.kickoff) === leagueSlug);

  // Bare /g/<league> for an edition competition (e.g. /g/world-cup) → redirect
  // to the current edition's hub (/g/world-cup-2026), so it never sits empty.
  if (!games.length) {
    const baseMatch = all
      .filter((f) => slugify(f.competition) === leagueSlug && EDITION_RE.test(f.competition || ""))
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
    if (baseMatch) {
      const target = `${origin}/g/${leagueSlugFor(baseMatch.competition, baseMatch.kickoff)}`;
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
      res.setHeader("Location", target);
      res.status(301).end();
      return;
    }
  }

  games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  games = games.slice(0, 80);

  // Display name: authoritative from a fixture (with its edition), else slug.
  const baseName = (games[0] && games[0].competition) || titleize(leagueSlug);
  const edLabel = games[0] ? editionLabel(games[0].competition, games[0].kickoff) : "";
  const leagueName = edLabel ? `${baseName} ${edLabel}` : baseName;
  const indexable = isNotable(leagueName) && games.length > 0;
  const robots = indexable ? "index, follow, max-image-preview:large" : "noindex, follow";

  const title = `${leagueName} on TV — where to watch every match · Hoje Há Bola`;
  const description =
    `Upcoming ${leagueName} fixtures and where to watch them — the TV channels and ` +
    "streaming services broadcasting each match, free or paid.";

  // Group fixtures by their Lisbon date for the listing.
  const byDay = [];
  const dayIndex = {};
  games.forEach((f) => {
    const d = lisbonYmd(new Date(f.kickoff));
    if (!dayIndex[d] && dayIndex[d] !== 0) { dayIndex[d] = byDay.length; byDay.push({ date: d, items: [] }); }
    byDay[dayIndex[d]].items.push(f);
  });

  const rowHtml = (f) => {
    const d = lisbonYmd(new Date(f.kickoff));
    const url = `${origin}/g/${leagueSlug}/${d}/${matchSlug(f.home, f.away)}`;
    const score = (f.homeScore != null && f.homeScore !== "" && f.awayScore != null && f.awayScore !== "")
      ? `${esc(f.homeScore)}–${esc(f.awayScore)}` : esc(lisbonTime(f.kickoff));
    return `<li><a href="${esc(url)}">
      <span class="t">${esc(f.home)}</span>
      <span class="sc">${score}</span>
      <span class="t a">${esc(f.away)}</span>
    </a></li>`;
  };

  const listSection = byDay.length
    ? byDay.map((g) => `<section class="day">
      <h2>${esc(lisbonDateLabel(g.date + "T12:00:00Z"))}</h2>
      <ul class="fixtures">${g.items.map(rowHtml).join("")}</ul>
    </section>`).join("")
    : `<p class="muted">No upcoming ${esc(leagueName)} fixtures in the next week. Check back soon.</p>`;

  // --- structured data: Breadcrumb + ItemList of upcoming matches -----------
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Hoje Há Bola", item: origin + "/" },
      { "@type": "ListItem", position: 2, name: leagueName, item: canonical },
    ],
  };
  const itemList = {
    "@type": "ItemList",
    name: `${leagueName} — upcoming matches`,
    itemListElement: games.slice(0, 30).map((f, i) => {
      const d = lisbonYmd(new Date(f.kickoff));
      return {
        "@type": "ListItem", position: i + 1,
        item: {
          "@type": "SportsEvent",
          name: `${f.home} vs ${f.away}`,
          url: `${origin}/g/${leagueSlug}/${d}/${matchSlug(f.home, f.away)}`,
          startDate: f.kickoff,
          sport: "Soccer",
        },
      };
    }),
  };
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": [breadcrumb, itemList] });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${esc(canonical)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="Hoje Há Bola" />
<meta property="og:title" content="${esc(leagueName + " on TV — where to watch")}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root{--bg:#0f1722;--panel:#16202e;--line:#243244;--txt:#e8eef5;--muted:#9fb0c3;--accent:#16d27a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--txt);line-height:1.5}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:20px 16px 48px}
  header.site{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:12px}
  .crumbs{font-size:.85rem;color:var(--muted);margin-bottom:10px}
  .crumbs a{color:var(--muted)}.crumbs span{color:var(--txt)}
  h1{font-size:1.5rem;margin:.2em 0}
  .lead{color:var(--muted);margin:0 0 18px}
  .day{margin:18px 0}
  .day h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 8px}
  ul.fixtures{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
  ul.fixtures a{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;
    background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 14px;color:var(--txt)}
  ul.fixtures a:hover{border-color:var(--accent)}
  ul.fixtures .t{font-weight:600}.ul-a{}
  ul.fixtures .t.a{text-align:right}
  ul.fixtures .sc{color:var(--accent);font-weight:800;font-variant-numeric:tabular-nums;min-width:54px;text-align:center}
  .muted{color:var(--muted)}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:28px}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a> › <span>${esc(leagueName)}</span>
    </nav>

    <h1>Where to watch ${esc(leagueName)} on TV</h1>
    <p class="lead">${esc(description)}</p>

    ${listSection}

    <footer>
      <a href="/">Hoje Há Bola</a> — football on TV, worldwide. Times shown in Europe/Lisbon.
    </footer>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(html);
};
