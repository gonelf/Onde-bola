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
 *     the probable (or confirmed) starting line-ups, the last meetings between
 *     the sides, and match facts (venue, head-to-head, recent form). It carries
 *     SportsEvent + BroadcastEvent JSON-LD so the fixture is eligible for
 *     rich results. A clear call-to-action opens the live app.
 *
 * The display is rebuilt server-side from the match id alone (lib/cardinfo +
 * api/matchdetails + api/fmtv, all FotMob, all KV-cached), so the shared link
 * stays short: /g/4667790. A legacy query form (?home=&away=&…) is still
 * honoured for back-compat and for the rare match that has no FotMob id.
 *
 * Indexing is selective: only fixtures in notable competitions (top leagues +
 * major cups/internationals) are marked `index`; the long tail is
 * `noindex, follow` so the crawl budget isn't spent on obscure games.
 */

const { getCard } = require("../lib/cardinfo.js");
const { renderDigestPage } = require("../lib/digest-page.js");
const { isPaidChannel } = require("../assets/data/broadcasters.js");

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

// "A", "A and B", "A, B and C".
function listJoin(arr) {
  const a = (arr || []).filter(Boolean);
  if (a.length <= 1) return a.join("");
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

// Kick-off across the markets that matter for these queries.
function kickoffTimes(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const at = (tz) => new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return {
    pt: at("Europe/Lisbon"), uk: at("Europe/London"),
    et: at("America/New_York"), utc: at("UTC"),
  };
}

// --- pretty URLs: /g/<league>/<date>/<home>-vs-<away> ---------------------
// A team's URL slug (same normalization the client uses), and the matchup slug.
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;

// Competitions that carry an edition year (periodic tournaments + European
// continental club cups); the SEASON subset is shown as 2026/27 vs a plain year.
const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
const SEASON_RE = /champions league|europa league|conference league|nations league|super cup/i;
function editionYear(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + 1 : y; // a season is named by the year it ends
}
// League slug with the edition appended where it matters (else evergreen).
function leagueSlugFor(comp, iso) {
  const base = slugify(comp || "");
  if (comp && EDITION_RE.test(comp)) {
    const y = editionYear(iso);
    if (y) return `${base}-${y}`;
  }
  return base;
}
// Human edition label: "2026" for one-off tournaments, "2026/27" for seasons.
function editionLabel(comp, iso) {
  if (!comp || !EDITION_RE.test(comp)) return "";
  const y = editionYear(iso);
  if (!y) return "";
  return SEASON_RE.test(comp) ? `${y - 1}/${String(y).slice(2)}` : String(y);
}
// Split "home-vs-away" at the first "-vs-" (team names don't contain a bare "vs").
function parseSlug(slug) {
  const m = /^(.+?)-vs-(.+)$/.exec(String(slug || ""));
  return m ? { home: m[1], away: m[2] } : null;
}
// Readable fallback names when a slug can't be resolved to a fixture.
const titleize = (s) => String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Resolve a /g/<date>/<home>-vs-<away> URL to that day's fixture (and its
// FotMob id) by matching the day's feed. Checks ±1 day so a timezone bucket
// difference between the slug date and FotMob's grouping doesn't lose the game.
async function resolveSlug(origin, date, slug) {
  const p = parseSlug(slug);
  if (!p) return null;
  for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
    const data = await getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000);
    const list = data && Array.isArray(data.fixtures) ? data.fixtures : [];
    const fx = list.find((f) => f && slugify(f.home) === p.home && slugify(f.away) === p.away);
    if (fx) return fx;
  }
  return null;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const get = (k) => (q[k] == null ? "" : String(q[k]));

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  // Day-digest pages share this function (Hobby plan's 12-function cap): /today
  // (?view=today) and the /image download tool (?view=image). Both unfurl with
  // the /og/today digest image.
  const view = get("view");
  if (view === "today" || view === "image") {
    return renderDigestPage(req, res, { view, origin, get });
  }

  // The sitemap and its daily cron also share this function to stay within the
  // 12-function cap; they live as plain modules under lib/.
  if (get("sitemap") === "1") return require("../lib/sitemap.js")(req, res);
  if (get("cron") === "1") return require("../lib/cron-sitemap.js")(req, res);

  const slug = get("slug");
  const pathDate = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "";

  // The canonical URL is /g/<date>/<home>-vs-<away>; resolve it to the day's
  // fixture so the page enriches exactly like the legacy /g/<id> form. The
  // short id form (and the legacy ?home=&away= query) are still honoured.
  let resolvedFx = null;
  if (slug && pathDate) {
    resolvedFx = await resolveSlug(origin, pathDate, slug).catch(() => null);
  }
  const slugNames = slug ? parseSlug(slug) : null;

  let fmid = get("id").replace(/^fm:/, "").trim();
  if (resolvedFx && resolvedFx.fmid) fmid = String(resolvedFx.fmid);
  const hasId = /^\d+$/.test(fmid);

  // Prefer rebuilding from the id; fall back to the resolved fixture, the slug,
  // then any display fields in the query.
  let card = null;
  if (hasId) {
    const r = await getCard(fmid).catch(() => null);
    if (r && r.ok) card = r.card;
  }

  const home = (card && card.home) || (resolvedFx && resolvedFx.home) ||
    (slugNames && titleize(slugNames.home)) || get("home") || "Home";
  const away = (card && card.away) || (resolvedFx && resolvedFx.away) ||
    (slugNames && titleize(slugNames.away)) || get("away") || "Away";
  const comp = (card && card.comp) || (resolvedFx && resolvedFx.competition) || get("comp");
  const score = (card && card.score) || get("score");
  const status = (card && card.status) || get("status");
  const dLabel = (card && card.date) || get("d");
  const kickoff = (card && card.kickoff) || (resolvedFx && resolvedFx.kickoff) || "";
  const homeBadge = (card && card.homeBadge) || (resolvedFx && resolvedFx.homeBadge) || "";
  const awayBadge = (card && card.awayBadge) || (resolvedFx && resolvedFx.awayBadge) || "";
  const isoDate = (card && card.isoDate) || pathDate ||
    (/^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "");
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

  // Preview image: short /og/<id> when we have one, else build from the fields.
  let imageUrl;
  if (hasId) {
    imageUrl = `${origin}/og/${fmid}`;
  } else {
    const p = new URLSearchParams();
    if (home) p.set("home", home);
    if (away) p.set("away", away);
    if (homeBadge) p.set("hb", homeBadge);
    if (awayBadge) p.set("ab", awayBadge);
    if (comp) p.set("comp", comp);
    if (get("cb")) p.set("cb", get("cb"));
    if (score) p.set("score", score);
    if (status) p.set("status", status);
    if (dLabel) p.set("date", dLabel);
    imageUrl = `${origin}/og?${p.toString()}`;
  }

  // Where a real visitor lands when they open the live app on this match.
  const appParams = new URLSearchParams();
  if (hasId) appParams.set("match", "fm:" + fmid);
  else if (get("id")) appParams.set("match", get("id"));
  if (isoDate) appParams.set("date", isoDate);
  const appUrl = "/" + (appParams.toString() ? "?" + appParams.toString() : "");

  // League slug for the URL hierarchy. Derive it from the resolved fixture's
  // competition first: that's the same value the card links and the league hub
  // slugify, so the canonical always matches the URLs that point at it. Fall
  // back to the card's competition, then the league segment from the URL. The
  // edition year is appended for tournaments/continental cups (see EDITION_RE).
  const leagueComp = (resolvedFx && resolvedFx.competition) || comp || "";
  const leagueSlug = leagueComp ? leagueSlugFor(leagueComp, kickoff) : get("league") || "";
  const leagueUrl = leagueSlug ? `${origin}/g/${leagueSlug}` : "";
  // Competition name with its edition for display, e.g. "Champions League 2026/27".
  const edLabel = editionLabel(leagueComp, kickoff);
  const compDisplay = comp ? (edLabel ? `${comp} ${edLabel}` : comp) : "";

  // Canonical: the pretty /g/<league>/<date>/<home>-vs-<away> URL (drops the
  // league segment if the competition is unknown). Old /g/<id> and ?home=&away=
  // links still render, but point search engines here.
  const shareUrl = isoDate
    ? (leagueSlug
        ? `${origin}/g/${leagueSlug}/${isoDate}/${matchSlug(home, away)}`
        : `${origin}/g/${isoDate}/${matchSlug(home, away)}`)
    : hasId
      ? `${origin}/g/${fmid}`
      : `${origin}/g?${new URLSearchParams(
          Object.keys(q).reduce((o, k) => ((o[k] = get(k)), o), {})
        ).toString()}`;

  const vs = `${home} vs ${away}`;
  const heading = `Where to watch ${vs}`;
  const headline = vs + (compDisplay ? " — " + compDisplay : "");
  const title = `Where to watch ${vs}${compDisplay ? " — " + compDisplay : ""} on TV · Hoje Há Bola`;
  const result = score ? `${score} (${status || "FT"})` : status ? status : "";
  const when = [dLabel, result].filter(Boolean).join(" · ");
  const description =
    `${vs}${compDisplay ? " · " + compDisplay : ""}${when ? " · " + when : ""}. ` +
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
  if (comp) {
    sportsEvent.superEvent = Object.assign(
      { "@type": "SportsEvent", name: compDisplay },
      leagueUrl ? { url: leagueUrl } : {}
    );
  }
  if (details && details.venue) {
    sportsEvent.location = { "@type": "Place", name: details.venue };
  }
  sportsEvent.eventStatus = /postpon/i.test(status) ? "https://schema.org/EventPostponed"
    : /cancel/i.test(status) ? "https://schema.org/EventCancelled"
    : "https://schema.org/EventScheduled";

  // Breadcrumb: Home › League › Match — reinforces the URL hierarchy.
  const crumbs = [{ name: "Hoje Há Bola", item: origin + "/" }];
  if (comp && leagueUrl) crumbs.push({ name: compDisplay, item: leagueUrl });
  crumbs.push({ name: vs, item: shareUrl });
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem", position: i + 1, name: c.name, item: c.item,
    })),
  };

  const graph = [sportsEvent, breadcrumb];
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
  // jsonLd is stringified later, after the FAQ page node is appended below.

  // --- visible body sections ------------------------------------------------
  const badge = (url, name) => url
    ? `<img class="crest" src="${esc(url)}" alt="${esc(name)} crest" width="40" height="40" loading="lazy" />`
    : "";

  const times = kickoff ? kickoffTimes(kickoff) : null;
  const freeAny = broadcasts.some((g) => g.channels.some((c) => !isPaidChannel(c)));
  const primaryTv = broadcasts.find((g) => g.country === "Portugal") || broadcasts[0] || null;

  // Unique intro copy so each page reads differently (not a thin template).
  const introBits = [];
  introBits.push(
    `${home} take on ${away}` +
    (compDisplay ? ` in ${compDisplay}` : "") +
    (details && details.round ? ` (${details.round})` : "") +
    (details && details.venue ? `, at ${details.venue}` : "") + "."
  );
  if (times) introBits.push(`Kick-off is ${times.pt} in Portugal (${times.utc} UTC).`);
  introBits.push(
    finished && score
      ? `Final score: ${score}.`
      : freeAny
        ? "It's on free-to-air TV in some countries — the full channel list by country is below."
        : "Here are the TV channels and streaming services carrying it in each country."
  );
  const intro = introBits.join(" ");

  const channelLi = (c) => {
    const paid = isPaidChannel(c);
    return `<li class="ch ${paid ? "paid" : "free"}">${esc(c)}` +
      `<span class="tag">${paid ? "Subscription" : "Free-to-air"}</span></li>`;
  };
  const tvSection = broadcasts.length
    ? `<section class="card">
    <h2>Where to watch ${esc(vs)} on TV</h2>
    ${broadcasts.map((g) => `<div class="country">
      <h3>${esc(g.country)}</h3>
      <ul class="chans">${g.channels.map(channelLi).join("")}</ul>
    </div>`).join("")}
    <p class="muted">Listings are detected per country${freeAny ? "; free-to-air channels are marked" : ""}. Open the live app to confirm what's available where you are.</p>
  </section>`
    : `<section class="card">
    <h2>Where to watch ${esc(vs)} on TV</h2>
    <p>Broadcasters for ${esc(vs)} are detected for your country in the live app — including which channels are free-to-air and which need a subscription.</p>
  </section>`;

  const kickoffSection = times
    ? `<section class="card">
    <h2>${esc(vs)} kick-off time</h2>
    <table class="facts">
      <tr><th>Portugal</th><td>${esc(times.pt)}${dLabel ? " · " + esc(dLabel) : ""}</td></tr>
      <tr><th>UK</th><td>${esc(times.uk)}</td></tr>
      <tr><th>US Eastern</th><td>${esc(times.et)}</td></tr>
      <tr><th>UTC</th><td>${esc(times.utc)}</td></tr>
    </table>
  </section>`
    : "";

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

  // Probable (or confirmed) starting line-ups, side by side.
  const lineups = details && details.lineups;
  const xi = (side) => (side && Array.isArray(side.starters) ? side.starters : [])
    .map((p) => `<li>${p.num ? `<span class="num">${esc(p.num)}</span>` : ""}${esc(p.name)}</li>`).join("");
  const lineupSection = (lineups && (lineups.home || lineups.away))
    ? `<section class="card">
    <h2>${lineups.confirmed ? "Starting line-ups" : "Probable line-ups"}</h2>
    <div class="lineups">
      <div class="xi">
        <h3>${esc(home)}${lineups.home && lineups.home.formation ? ` <span class="muted">${esc(lineups.home.formation)}</span>` : ""}</h3>
        <ol>${xi(lineups.home)}</ol>
      </div>
      <div class="xi">
        <h3>${esc(away)}${lineups.away && lineups.away.formation ? ` <span class="muted">${esc(lineups.away.formation)}</span>` : ""}</h3>
        <ol>${xi(lineups.away)}</ol>
      </div>
    </div>
    ${lineups.confirmed ? "" : `<p class="muted">Predicted from recent selections — confirmed XI is announced ~1h before kick-off.</p>`}
  </section>`
    : "";

  // Last meetings between the two sides.
  const meetings = (details && Array.isArray(details.h2hMatches)) ? details.h2hMatches : [];
  const meetingsSection = meetings.length
    ? `<section class="card">
    <h2>Last meetings</h2>
    <ul class="meetings">${meetings.map((m) => `<li>
      ${m.date ? `<span class="when">${esc(m.date)}</span>` : ""}
      <span class="mt">${esc(m.home)} <strong>${esc(m.score || "v")}</strong> ${esc(m.away)}</span>
      ${m.comp ? `<span class="muted comp">${esc(m.comp)}</span>` : ""}
    </li>`).join("")}</ul>
  </section>`
    : "";

  // FAQ — targets the "what channel / what time / is it free" long-tail queries.
  const faqs = [];
  if (primaryTv) {
    faqs.push([
      `What channel is ${vs} on${primaryTv.country ? " in " + primaryTv.country : ""}?`,
      `${vs} is shown on ${listJoin(primaryTv.channels)} in ${primaryTv.country}. ` +
      `Broadcasters in other countries are listed above.`,
    ]);
  } else {
    faqs.push([
      `What channel is ${vs} on?`,
      `Broadcasters vary by country — open the live app to see the TV channels and streaming services carrying ${vs} where you are.`,
    ]);
  }
  if (times) {
    faqs.push([
      `What time does ${vs} kick off?`,
      `${vs} kicks off at ${times.pt} in Portugal (${times.uk} UK, ${times.et} US Eastern, ${times.utc} UTC)` +
      (dLabel ? ` on ${dLabel}` : "") + ".",
    ]);
  }
  faqs.push([
    `Is ${vs} free to watch?`,
    freeAny
      ? `Yes — ${vs} is on free-to-air TV in some countries (the channels marked free above). Elsewhere it needs a TV subscription or streaming service.`
      : `${vs} is generally only on subscription TV or streaming. Check the listings above for a free option in your country.`,
  ]);
  if (details && details.venue) {
    faqs.push([`Where is ${vs} being played?`, `${vs} is played at ${details.venue}.`]);
  }
  if (compDisplay) {
    faqs.push([`What competition is ${vs} in?`, `${vs} is part of ${compDisplay}.`]);
  }
  const faqSection = `<section class="card faq">
    <h2>${esc(vs)} — frequently asked questions</h2>
    ${faqs.map(([qq, a]) => `<details><summary>${esc(qq)}</summary><p>${esc(a)}</p></details>`).join("")}
  </section>`;
  graph.push({
    "@type": "FAQPage",
    mainEntity: faqs.map(([qq, a]) => ({
      "@type": "Question", name: qq,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  });

  // More matches in the same competition (internal link up to the hub).
  const moreSection = leagueUrl
    ? `<p class="more"><a href="${esc(leagueUrl)}">More ${esc(compDisplay || "matches")} on TV →</a></p>`
    : "";

  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });

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
  .crumbs{font-size:.85rem;color:var(--muted);margin-bottom:8px}
  .crumbs a{color:var(--muted)}
  .crumbs span{color:var(--txt)}
  .intro{margin:6px 0 4px}
  .chans{list-style:none;display:flex;flex-direction:column;gap:6px;padding:0;margin:0}
  .chans .ch{display:flex;align-items:center;gap:10px;
    background:#0f1a26;border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:.92rem}
  .chans .ch::before{content:"";width:8px;height:8px;border-radius:50%;flex:0 0 8px}
  .chans .ch.free::before{background:var(--accent)}
  .chans .ch.paid::before{background:#e0a23b}
  .chans .ch .tag{margin-left:auto;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;
    padding:2px 8px;border-radius:999px;white-space:nowrap}
  .chans .ch.free .tag{color:var(--accent);background:rgba(22,210,122,.14)}
  .chans .ch.paid .tag{color:#e0a23b;background:rgba(224,162,59,.14)}
  .faq details{border-top:1px solid var(--line);padding:10px 0}
  .faq details:first-of-type{border-top:0}
  .faq summary{cursor:pointer;font-weight:600;list-style:none}
  .faq summary::-webkit-details-marker{display:none}
  .faq summary::after{content:"+";float:right;color:var(--muted)}
  .faq details[open] summary::after{content:"–"}
  .faq p{color:var(--muted);margin:8px 0 0}
  .more{margin:18px 0 0;font-weight:700}
  .lineups{display:flex;gap:16px;flex-wrap:wrap}
  .xi{flex:1;min-width:140px}
  .xi h3{margin:0 0 8px}
  .xi ol{margin:0;padding:0;list-style:none;counter-reset:none}
  .xi li{padding:4px 0;border-bottom:1px solid var(--line);font-size:.95rem}
  .xi li:last-child{border-bottom:0}
  .xi .num{display:inline-block;min-width:1.6em;color:var(--muted);font-variant-numeric:tabular-nums}
  .meetings{list-style:none;padding:0;margin:0}
  .meetings li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:8px 0;border-bottom:1px solid var(--line)}
  .meetings li:last-child{border-bottom:0}
  .meetings .when{color:var(--muted);font-size:.82rem;min-width:92px}
  .meetings .mt strong{font-variant-numeric:tabular-nums}
  .meetings .comp{font-size:.82rem}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>

    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a>${comp && leagueUrl ? ` › <a href="${esc(leagueUrl)}">${esc(compDisplay)}</a>` : ""} › <span>${esc(vs)}</span>
    </nav>

    <h1>${esc(heading)}</h1>
    <div class="teams">
      <span class="t">${badge(homeBadge, home)}${esc(home)}</span>
      <span class="vs">vs</span>
      <span class="t">${badge(awayBadge, away)}${esc(away)}</span>
    </div>
    ${score ? `<div class="score">${esc(score)}</div>` : ""}
    <p class="meta">${esc([compDisplay, when].filter(Boolean).join(" · "))}</p>

    <p class="intro">${esc(intro)}</p>

    <a class="cta" href="${esc(appUrl)}">Open ${esc(vs)} in the live app →</a>

    ${tvSection}
    ${kickoffSection}
    ${lineupSection}
    ${meetingsSection}
    ${factsSection}
    ${compareSection}
    ${faqSection}
    ${moreSection}

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
