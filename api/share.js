/*
 * /api/share  (public path: /g/<id>) — per-game page.
 *
 * Two audiences, one server-rendered page:
 *
 *  1. Social crawlers (WhatsApp, X, Facebook, iMessage, Slack, Discord) don't
 *     run JavaScript, so they can't see the app's client-rendered match view.
 *     This page gives each game its own Open Graph / Twitter card — title,
 *     description and a custom preview image (/og/<id>).
 *
 *  2. Search engines + readers. The page renders the real content a visitor
 *     searches for — "where to watch <home> vs <away>" — server-side: the
 *     matchup, kickoff in local time, the TV/streaming channels per country,
 *     and match facts (venue, head-to-head, recent form). It carries
 *     SportsEvent + BroadcastEvent JSON-LD so the fixture is eligible for
 *     rich results. A clear call-to-action opens the live app.
 *
 * The display is rebuilt server-side from the match id alone (api/cardinfo +
 * api/matchdetails + api/fmtv, all FotMob, all KV-cached), so the shared link
 * stays short: /g/4667790. A legacy query form (?home=&away=&…) is still
 * honoured for back-compat and for the rare match that has no FotMob id.
 *
 * Indexing is selective: only fixtures in notable competitions (top leagues +
 * major cups/internationals) are marked `index`; the long tail is
 * `noindex, follow` so the crawl budget isn't spent on obscure games.
 */

const { getCard } = require("./cardinfo.js");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// Normalize a team name for matching against the broadcast feed (mirrors fmtv).
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Competitions worth indexing a per-fixture page for. Everything else stays
// noindex,follow — the page still works and shares, it just doesn't compete in
// search with thousands of low-interest worldwide fixtures.
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

// Best-effort internal JSON fetch (our own serverless endpoints). Never throws;
// a timeout or bad shape just yields null and the section degrades gracefully.
async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 4000);
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

// Pull this match's broadcast rows out of the day's FotMob TV feed by matching
// normalized team names, then group channels by country (Portugal first).
function broadcastsFor(feed, home, away) {
  const matches = (feed && Array.isArray(feed.matches)) ? feed.matches : [];
  const h = norm(home), a = norm(away);
  const m = matches.find((x) => x && x.h === h && x.a === a) ||
    matches.find((x) => x && ((x.h === h && x.a === a) || (x.h === a && x.a === h)));
  if (!m || !Array.isArray(m.rows) || !m.rows.length) return [];

  const byCountry = {};
  m.rows.forEach((row) => {
    if (!row || !row.channel) return;
    const c = row.country || "";
    (byCountry[c] || (byCountry[c] = [])).push(row.channel);
  });
  const order = Object.keys(byCountry).sort((x, y) => {
    if (x === "Portugal") return -1;
    if (y === "Portugal") return 1;
    return x.localeCompare(y);
  });
  return order.map((country) => ({
    country,
    channels: Array.from(new Set(byCountry[country])).sort(),
  }));
}

const formDots = (list) =>
  (Array.isArray(list) ? list : [])
    .map((r) => `<span class="form form-${esc(r).toLowerCase()}">${esc(r)}</span>`)
    .join("");

module.exports = async (req, res) => {
  const q = req.query || {};
  const get = (k) => (q[k] == null ? "" : String(q[k]));

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const fmid = get("id").replace(/^fm:/, "").trim();
  const hasId = /^\d+$/.test(fmid);

  // Prefer rebuilding from the id; fall back to any display fields in the query.
  let card = null;
  if (hasId) {
    const r = await getCard(fmid).catch(() => null);
    if (r && r.ok) card = r.card;
  }

  const home = (card && card.home) || get("home") || "Home";
  const away = (card && card.away) || get("away") || "Away";
  const comp = (card && card.comp) || get("comp");
  const score = (card && card.score) || get("score");
  const status = (card && card.status) || get("status");
  const dLabel = (card && card.date) || get("d");
  const kickoff = (card && card.kickoff) || "";
  const homeBadge = (card && card.homeBadge) || "";
  const awayBadge = (card && card.awayBadge) || "";
  const isoDate = (card && card.isoDate) || (/^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "");
  const finished = !!(card && card.finished);

  // Enrich (best-effort, parallel): TV listings for the day + match facts.
  // Both come from our own KV-cached endpoints, so this is cheap on a warm day.
  let broadcasts = [];
  let details = null;
  if (hasId) {
    const [tv, md] = await Promise.all([
      isoDate ? getJson(`${origin}/api/fmtv?date=${isoDate}`, 4500) : Promise.resolve(null),
      getJson(`${origin}/api/matchdetails?id=${fmid}`, 4500),
    ]);
    broadcasts = broadcastsFor(tv, home, away);
    if (md && md.ok && md.details) details = md.details;
  }

  // Preview image: short /og/<id> when we have one, else legacy query form.
  let imageUrl;
  if (hasId) {
    imageUrl = `${origin}/og/${fmid}`;
  } else {
    const p = new URLSearchParams();
    ["home", "away", "hb", "ab", "comp", "cb", "score", "status"].forEach((k) => {
      if (get(k)) p.set(k, get(k));
    });
    if (dLabel) p.set("date", dLabel);
    imageUrl = `${origin}/og?${p.toString()}`;
  }

  // Where a real visitor lands when they open the live app on this match.
  const appParams = new URLSearchParams();
  if (hasId) appParams.set("match", "fm:" + fmid);
  else if (get("id")) appParams.set("match", get("id"));
  if (isoDate) appParams.set("date", isoDate);
  const appUrl = "/" + (appParams.toString() ? "?" + appParams.toString() : "");

  const shareUrl = hasId ? `${origin}/g/${fmid}` : `${origin}/g?${new URLSearchParams(
    Object.keys(q).reduce((o, k) => ((o[k] = get(k)), o), {})
  ).toString()}`;

  const vs = `${home} vs ${away}`;
  const heading = `Where to watch ${vs}`;
  const headline = vs + (comp ? " — " + comp : "");
  const title = `Where to watch ${vs}${comp ? " — " + comp : ""} on TV · Hoje Há Bola`;
  const result = score ? `${score} (${status || "FT"})` : status ? status : "";
  const when = [dLabel, result].filter(Boolean).join(" · ");
  const description =
    `${vs}${comp ? " · " + comp : ""}${when ? " · " + when : ""}. ` +
    "See which TV channels and streaming services are broadcasting it — free or paid.";

  // Selective indexing: only notable competitions compete in search.
  const indexable = hasId && isNotable(comp);
  const robots = indexable ? "index, follow, max-image-preview:large" : "noindex, follow";

  // --- structured data: SportsEvent (+ BroadcastEvent per channel) ----------
  const eventId = shareUrl + "#event";
  const team = (name, logo) => {
    const t = { "@type": "SportsTeam", name };
    if (logo) t.logo = logo;
    return t;
  };
  const sportsEvent = {
    "@type": "SportsEvent",
    "@id": eventId,
    name: vs + (comp ? " — " + comp : ""),
    url: shareUrl,
    sport: "Soccer",
    homeTeam: team(home, homeBadge),
    awayTeam: team(away, awayBadge),
    competitor: [team(home, homeBadge), team(away, awayBadge)],
    isAccessibleForFree: true,
    image: imageUrl,
  };
  if (kickoff) sportsEvent.startDate = kickoff;
  if (comp) sportsEvent.superEvent = { "@type": "SportsEvent", name: comp };
  if (details && details.venue) {
    sportsEvent.location = { "@type": "Place", name: details.venue };
  }
  sportsEvent.eventStatus = /postpon/i.test(status) ? "https://schema.org/EventPostponed"
    : /cancel/i.test(status) ? "https://schema.org/EventCancelled"
    : "https://schema.org/EventScheduled";

  const graph = [sportsEvent];
  broadcasts.slice(0, 4).forEach((grp) => {
    grp.channels.slice(0, 4).forEach((ch) => {
      graph.push({
        "@type": "BroadcastEvent",
        name: `${vs} on ${ch}`,
        isLiveBroadcast: !finished,
        broadcastOfEvent: { "@id": eventId },
        publishedOn: { "@type": "BroadcastService", name: ch, areaServed: grp.country },
      });
    });
  });
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });

  // --- visible body sections ------------------------------------------------
  const badge = (url, name) => url
    ? `<img class="crest" src="${esc(url)}" alt="${esc(name)} crest" width="40" height="40" loading="lazy" />`
    : "";

  const tvSection = broadcasts.length
    ? `<section class="card">
    <h2>Where to watch on TV</h2>
    ${broadcasts.map((g) => `<div class="country">
      <h3>${esc(g.country)}</h3>
      <ul class="chips">${g.channels.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    </div>`).join("")}
    <p class="muted">Channels are detected per country. Open the app to see listings for your location.</p>
  </section>`
    : `<section class="card">
    <h2>Where to watch on TV</h2>
    <p>Broadcasters for ${esc(vs)} are detected for your country in the live app — including which channels are free-to-air and which need a subscription.</p>
  </section>`;

  const factRows = [];
  if (details) {
    if (details.round) factRows.push(["Round", details.round]);
    if (details.venue) factRows.push(["Venue", details.venue]);
    if (details.referee) factRows.push(["Referee", details.referee]);
    if (details.attendance) factRows.push(["Attendance", details.attendance]);
  }
  const factsSection = factRows.length
    ? `<section class="card">
    <h2>Match info</h2>
    <table class="facts">${factRows.map(([k, v]) =>
      `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
  </section>`
    : "";

  const h2h = details && details.h2h;
  const form = details && details.form;
  const compareSection = (h2h || form)
    ? `<section class="card">
    <h2>Form &amp; head-to-head</h2>
    ${form ? `<div class="compare">
      <div><strong>${esc(home)}</strong> ${formDots(form.home)}</div>
      <div><strong>${esc(away)}</strong> ${formDots(form.away)}</div>
    </div>` : ""}
    ${h2h ? `<p class="muted">Head-to-head: ${esc(home)} ${h2h.home} · ${h2h.draw} draws · ${esc(away)} ${h2h.away}</p>` : ""}
  </section>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="${robots}" />
<link rel="canonical" href="${esc(shareUrl)}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="Hoje Há Bola" />
<meta property="og:title" content="${esc(headline)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(headline)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(headline)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(imageUrl)}" />
<meta name="twitter:image:alt" content="${esc(headline)}" />

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
<script type="application/ld+json">${jsonLd}</script>
<style>
  :root{--bg:#0f1722;--panel:#16202e;--line:#243244;--txt:#e8eef5;--muted:#9fb0c3;--accent:#16d27a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--txt);line-height:1.5}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:20px 16px 48px}
  header.site{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:20px}
  h1{font-size:1.5rem;margin:.2em 0}
  .teams{display:flex;align-items:center;justify-content:center;gap:16px;margin:8px 0}
  .teams .t{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;font-weight:700}
  .crest{object-fit:contain}
  .vs{color:var(--muted);font-weight:600}
  .score{font-size:1.6rem;font-weight:800;text-align:center}
  .meta{text-align:center;color:var(--muted);margin-bottom:8px}
  .cta{display:block;text-align:center;background:var(--accent);color:#062013;font-weight:800;
    padding:12px 16px;border-radius:10px;margin:18px 0}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
    padding:16px;margin:14px 0}
  .card h2{font-size:1.05rem;margin:0 0 10px}
  .card h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:12px 0 6px}
  .chips{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0}
  .chips li{background:#0f1a26;border:1px solid var(--line);border-radius:999px;padding:5px 12px;font-size:.9rem}
  .muted{color:var(--muted);font-size:.9rem}
  table.facts{width:100%;border-collapse:collapse}
  table.facts th{text-align:left;color:var(--muted);font-weight:600;padding:6px 0;width:40%}
  table.facts td{padding:6px 0}
  .compare div{display:flex;align-items:center;gap:8px;margin:6px 0}
  .form{display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:5px;
    font-size:.7rem;font-weight:800;color:#fff}
  .form-w{background:#16a34a}.form-d{background:#6b7280}.form-l{background:#dc2626}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:24px}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>

    <h1>${esc(heading)}</h1>
    <div class="teams">
      <span class="t">${badge(homeBadge, home)}${esc(home)}</span>
      <span class="vs">vs</span>
      <span class="t">${badge(awayBadge, away)}${esc(away)}</span>
    </div>
    ${score ? `<div class="score">${esc(score)}</div>` : ""}
    <p class="meta">${esc([comp, when].filter(Boolean).join(" · "))}</p>

    <a class="cta" href="${esc(appUrl)}">Open ${esc(vs)} in the live app →</a>

    ${tvSection}
    ${factsSection}
    ${compareSection}

    <footer>
      <a href="/">Hoje Há Bola</a> — football on TV, worldwide. Times shown in Europe/Lisbon.
    </footer>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
};
