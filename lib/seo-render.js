/*
 * lib/seo-render — server-side renderers for the per-game (/g/<…>) and league
 * hub (/g/<league>) SEO pages, ported from api/share.js + api/league.js.
 *
 * Each builder resolves a page from the live fixtures feed (+ FotMob match
 * details via getCard / our own KV-cached endpoints) and returns the pieces the
 * App Router page needs: head metadata (title/description/robots/canonical/OG),
 * the inline CSS, the page body as an HTML string, and the JSON-LD graph. The
 * markup, copy and structured data are byte-for-byte the same as the originals
 * so search/indexing behaviour is preserved.
 */

import { getCard } from "./cardinfo";
import { isPaidChannel, canonicalChannelName } from "./broadcasters";
import { registryHas } from "./sitemap-sweep";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Localized credit line with the X/Twitter handles turned into links.
function footerCreditsHtml(c) {
  return esc(c.footerCredits)
    .replace("@gonelf", '<a href="https://x.com/gonelf" target="_blank" rel="noopener">@gonelf</a>')
    .replace("@etyk", '<a href="https://x.com/etyk" target="_blank" rel="noopener">@etyk</a>');
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;
const titleize = (s) => String(s || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
const SEASON_RE = /champions league|europa league|conference league|nations league|super cup/i;

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

// opts: { headers } forwards same-origin auth (see lib/forward-auth) so internal
// fetches survive Deployment Protection on previews; { retries } re-attempts on a
// timeout/non-2xx so one slow upstream doesn't silently de-index a real match.
async function getJson(url, ms, opts) {
  const { headers, retries = 0 } = opts || {};
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 5000);
    try {
      const r = await fetch(url, {
        signal: ctrl.signal,
        headers: Object.assign({ Accept: "application/json" }, headers || {}),
      });
      if (r.ok) return await r.json();
    } catch (e) {
      // fall through to retry / null
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// Pull this match's broadcast rows, grouped by country (Portugal first). Prefer
// the accumulated daily store (keyed by FotMob id, the richest source), then the
// live FotMob feed — joined by id when available, name only as a last resort.
function broadcastsFor(feed, home, away, fmid, rich) {
  let rows = (rich && Array.isArray(rich.rows) && rich.rows.length) ? rich.rows : null;
  if (!rows) {
    const matches = (feed && Array.isArray(feed.matches)) ? feed.matches : [];
    const h = norm(home), a = norm(away);
    const m =
      (fmid && matches.find((x) => x && String(x.id) === String(fmid))) ||
      matches.find((x) => x && x.h === h && x.a === a) ||
      matches.find((x) => x && ((x.h === h && x.a === a) || (x.h === a && x.a === h)));
    rows = (m && Array.isArray(m.rows) && m.rows.length) ? m.rows : null;
  }
  if (!rows) return [];

  const byCountry = {};
  rows.forEach((row) => {
    if (!row || !row.channel) return;
    const c = row.country || "";
    // Fold streaming-brand variants ("Amazon Prime Video" -> "Prime Video") so
    // the per-country Set dedup below shows one pill for the service.
    (byCountry[c] || (byCountry[c] = [])).push(canonicalChannelName(row.channel));
  });
  const order = Object.keys(byCountry).sort((x, y) => {
    if (x === "Portugal") return -1;
    if (y === "Portugal") return 1;
    return x.localeCompare(y);
  });
  return order.map((country) => ({
    country,
    channels: Array.from(new Set(byCountry[country])).sort((x, y) => {
      const px = isPaidChannel(x) ? 1 : 0, py = isPaidChannel(y) ? 1 : 0;
      return px !== py ? px - py : x.localeCompare(y);
    }),
  }));
}

const formDots = (list) =>
  (Array.isArray(list) ? list : [])
    .map((r) => `<span class="form form-${esc(r).toLowerCase()}">${esc(r)}</span>`)
    .join("");

function listJoin(arr, andWord) {
  const a = (arr || []).filter(Boolean);
  if (a.length <= 1) return a.join("");
  return a.slice(0, -1).join(", ") + ` ${andWord || "and"} ` + a[a.length - 1];
}

function kickoffTimes(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const at = (tz) => new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return { pt: at("Europe/Lisbon"), uk: at("Europe/London"), et: at("America/New_York"), utc: at("UTC") };
}

function parseSlug(slug) {
  const m = /^(.+?)-vs-(.+)$/.exec(String(slug || ""));
  return m ? { home: m[1], away: m[2] } : null;
}
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function resolveSlug(origin, date, slug, auth) {
  const p = parseSlug(slug);
  if (!p) return null;
  for (const d of [date, addDays(date, -1), addDays(date, 1)]) {
    const data = await getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000, { headers: auth, retries: 1 });
    const list = data && Array.isArray(data.fixtures) ? data.fixtures : [];
    const fx = list.find((f) => f && slugify(f.home) === p.home && slugify(f.away) === p.away);
    if (fx) return fx;
  }
  return null;
}

// Per-language copy for the SEO pages. Functions cover the interpolated
// strings; the surrounding markup and data are language-neutral.
const COPY = {
  en: {
    crumbHome: "Home", vs: "vs", ftShort: "FT",
    defaultHome: "Home", defaultAway: "Away",
    heading: (vs) => `Where to watch ${vs}`,
    title: (vs, comp) => `Where to watch ${vs}${comp ? " — " + comp : ""} on TV · Hoje Há Bola`,
    descSentence: "See which TV channels and streaming services are broadcasting it — free or paid.",
    introTakeOn: (home, away) => `${home} take on ${away}`,
    introIn: (comp) => ` in ${comp}`,
    introRound: (r) => ` (${r})`,
    introVenue: (v) => `, at ${v}`,
    introKickoff: (pt, utc) => `Kick-off is ${pt} in Portugal (${utc} UTC).`,
    introFinal: (score) => `Final score: ${score}.`,
    introFree: "It's on free-to-air TV in some countries — the full channel list by country is below.",
    introPaid: "Here are the TV channels and streaming services carrying it in each country.",
    tagSub: "Subscription", tagFree: "Free-to-air",
    tvHeading: (vs) => `Where to watch ${vs} on TV`,
    tvNote: (freeAny) => `Listings are detected per country${freeAny ? "; free-to-air channels are marked" : ""}. Open the live app to confirm what's available where you are.`,
    tvFallback: (vs) => `Broadcasters for ${vs} are detected for your country in the live app — including which channels are free-to-air and which need a subscription.`,
    kickoffHeading: (vs) => `${vs} kick-off time`,
    rowPortugal: "Portugal", rowUK: "UK", rowUS: "US Eastern", rowUTC: "UTC",
    matchInfo: "Match info",
    factRound: "Round", factVenue: "Venue", factReferee: "Referee", factAttendance: "Attendance",
    formH2h: "Form & head-to-head",
    h2hLine: (home, h, draw, away, a) => `Head-to-head: ${home} ${h} · ${draw} draws · ${away} ${a}`,
    lineupsConfirmed: "Starting line-ups", lineupsProbable: "Probable line-ups",
    lineupNote: "Predicted from recent selections — confirmed XI is announced ~1h before kick-off.",
    lastMeetings: "Last meetings",
    faqTitle: (vs) => `${vs} — frequently asked questions`,
    faqChannelQ: (vs, country) => `What channel is ${vs} on${country ? " in " + country : ""}?`,
    faqChannelA: (vs, chans, country) => `${vs} is shown on ${chans} in ${country}. Broadcasters in other countries are listed above.`,
    faqChannelNoQ: (vs) => `What channel is ${vs} on?`,
    faqChannelNoA: (vs) => `Broadcasters vary by country — open the live app to see the TV channels and streaming services carrying ${vs} where you are.`,
    faqTimeQ: (vs) => `What time does ${vs} kick off?`,
    faqTimeA: (vs, pt, uk, et, utc, d) => `${vs} kicks off at ${pt} in Portugal (${uk} UK, ${et} US Eastern, ${utc} UTC)${d ? " on " + d : ""}.`,
    faqFreeQ: (vs) => `Is ${vs} free to watch?`,
    faqFreeYesA: (vs) => `Yes — ${vs} is on free-to-air TV in some countries (the channels marked free above). Elsewhere it needs a TV subscription or streaming service.`,
    faqFreeNoA: (vs) => `${vs} is generally only on subscription TV or streaming. Check the listings above for a free option in your country.`,
    faqVenueQ: (vs) => `Where is ${vs} being played?`,
    faqVenueA: (vs, venue) => `${vs} is played at ${venue}.`,
    faqCompQ: (vs) => `What competition is ${vs} in?`,
    faqCompA: (vs, comp) => `${vs} is part of ${comp}.`,
    more: (comp) => `More ${comp || "matches"} on TV →`,
    cta: (vs) => `Open ${vs} in the live app →`,
    footerTail: "football on TV, worldwide. Times shown in Europe/Lisbon.",
    footerCredits: "Made with ❤️ by @gonelf, @etyk, and Claude Code",
    leagueTitle: (name) => `${name} on TV — where to watch every match · Hoje Há Bola`,
    leagueDesc: (name) => `Upcoming ${name} fixtures and where to watch them — the TV channels and streaming services broadcasting each match, free or paid.`,
    leagueNoGames: (name) => `No upcoming ${name} fixtures in the next week. Check back soon.`,
    leagueH1: (name) => `Where to watch ${name} on TV`,
    leagueHeadline: (name) => `${name} on TV — where to watch`,
  },
  pt: {
    crumbHome: "Início", vs: "vs", ftShort: "FIM",
    defaultHome: "Casa", defaultAway: "Fora",
    heading: (vs) => `Onde ver ${vs}`,
    title: (vs, comp) => `Onde ver ${vs}${comp ? " — " + comp : ""} na TV · Hoje Há Bola`,
    descSentence: "Vê em que canais de TV e serviços de streaming passa — grátis ou pago.",
    introTakeOn: (home, away) => `${home} defronta ${away}`,
    introIn: (comp) => ` na ${comp}`,
    introRound: (r) => ` (${r})`,
    introVenue: (v) => `, em ${v}`,
    introKickoff: (pt, utc) => `O pontapé de saída é às ${pt} em Portugal (${utc} UTC).`,
    introFinal: (score) => `Resultado final: ${score}.`,
    introFree: "Passa em sinal aberto nalguns países — a lista completa de canais por país está abaixo.",
    introPaid: "Aqui estão os canais de TV e serviços de streaming que o transmitem em cada país.",
    tagSub: "Subscrição", tagFree: "Sinal aberto",
    tvHeading: (vs) => `Onde ver ${vs} na TV`,
    tvNote: (freeAny) => `As emissões são detetadas por país${freeAny ? "; os canais em sinal aberto estão assinalados" : ""}. Abre a app para confirmares o que está disponível onde estás.`,
    tvFallback: (vs) => `As emissões de ${vs} são detetadas para o teu país na app — incluindo que canais são em sinal aberto e quais precisam de subscrição.`,
    kickoffHeading: (vs) => `Hora de início de ${vs}`,
    rowPortugal: "Portugal", rowUK: "Reino Unido", rowUS: "EUA (Este)", rowUTC: "UTC",
    matchInfo: "Informação do jogo",
    factRound: "Jornada", factVenue: "Estádio", factReferee: "Árbitro", factAttendance: "Assistência",
    formH2h: "Forma e confrontos diretos",
    h2hLine: (home, h, draw, away, a) => `Confrontos diretos: ${home} ${h} · ${draw} empates · ${away} ${a}`,
    lineupsConfirmed: "Onzes iniciais", lineupsProbable: "Onzes prováveis",
    lineupNote: "Previsto a partir das últimas escolhas — o onze confirmado é anunciado ~1h antes do início.",
    lastMeetings: "Últimos confrontos",
    faqTitle: (vs) => `${vs} — perguntas frequentes`,
    faqChannelQ: (vs, country) => `Em que canal passa ${vs}${country ? " em " + country : ""}?`,
    faqChannelA: (vs, chans, country) => `${vs} passa em ${chans} em ${country}. As emissões noutros países estão listadas acima.`,
    faqChannelNoQ: (vs) => `Em que canal passa ${vs}?`,
    faqChannelNoA: (vs) => `As emissões variam por país — abre a app para veres os canais de TV e serviços de streaming que transmitem ${vs} onde estás.`,
    faqTimeQ: (vs) => `A que horas começa ${vs}?`,
    faqTimeA: (vs, pt, uk, et, utc, d) => `${vs} começa às ${pt} em Portugal (${uk} Reino Unido, ${et} EUA Este, ${utc} UTC)${d ? " em " + d : ""}.`,
    faqFreeQ: (vs) => `${vs} é grátis para ver?`,
    faqFreeYesA: (vs) => `Sim — ${vs} passa em sinal aberto nalguns países (os canais assinalados como gratuitos acima). Nos restantes, é preciso uma subscrição de TV ou serviço de streaming.`,
    faqFreeNoA: (vs) => `${vs} normalmente só passa em TV por subscrição ou streaming. Vê as emissões acima para uma opção gratuita no teu país.`,
    faqVenueQ: (vs) => `Onde se joga ${vs}?`,
    faqVenueA: (vs, venue) => `${vs} joga-se em ${venue}.`,
    faqCompQ: (vs) => `Em que competição está ${vs}?`,
    faqCompA: (vs, comp) => `${vs} faz parte de ${comp}.`,
    more: (comp) => `Mais ${comp || "jogos"} na TV →`,
    cta: (vs) => `Abrir ${vs} na app →`,
    footerTail: "futebol na TV, em todo o mundo. Horas em Europe/Lisbon.",
    footerCredits: "Feito com ❤️ por @gonelf, @etyk e o Claude Code",
    leagueTitle: (name) => `${name} na TV — onde ver todos os jogos · Hoje Há Bola`,
    leagueDesc: (name) => `Próximos jogos de ${name} e onde os ver — os canais de TV e serviços de streaming que transmitem cada jogo, grátis ou pago.`,
    leagueNoGames: (name) => `Sem próximos jogos de ${name} na próxima semana. Volta em breve.`,
    leagueH1: (name) => `Onde ver ${name} na TV`,
    leagueHeadline: (name) => `${name} na TV — onde ver`,
  },
};

const SHARE_CSS = `
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
`;

// Build the per-game page. `parts` is the /g/* path segments; `query` is the
// search params as a plain object (legacy /g?home=&away=…).
export async function buildShare({ origin, lang, parts, query, auth }) {
  parts = parts || [];
  query = query || {};
  const c = COPY[lang] || COPY.en;
  const andWord = lang === "pt" ? "e" : "and";
  const get = (k) => (query[k] == null ? "" : String(query[k]));

  // Map the path forms to slug/date/id.
  let slug = "", pathDate = "", idSeg = "";
  if (parts.length === 1) idSeg = parts[0];
  else if (parts.length === 2) { pathDate = parts[0]; slug = parts[1]; }
  else if (parts.length >= 3) { pathDate = parts[1]; slug = parts[2]; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pathDate)) {
    pathDate = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "";
  }

  let resolvedFx = null;
  if (slug && pathDate) {
    resolvedFx = await resolveSlug(origin, pathDate, slug, auth).catch(() => null);
  }
  const slugNames = slug ? parseSlug(slug) : null;

  let fmid = (idSeg || get("id")).replace(/^fm:/, "").trim();
  if (resolvedFx && resolvedFx.fmid) fmid = String(resolvedFx.fmid);
  const hasId = /^\d+$/.test(fmid);

  let card = null;
  if (hasId) {
    const r = await getCard(fmid).catch(() => null);
    if (r && r.ok) card = r.card;
  }

  const home = (card && card.home) || (resolvedFx && resolvedFx.home) ||
    (slugNames && titleize(slugNames.home)) || get("home") || c.defaultHome;
  const away = (card && card.away) || (resolvedFx && resolvedFx.away) ||
    (slugNames && titleize(slugNames.away)) || get("away") || c.defaultAway;
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

  let broadcasts = [];
  let details = null;
  if (hasId) {
    const [tv, listings, md] = await Promise.all([
      isoDate ? getJson(`${origin}/api/fmtv?date=${isoDate}`, 4500, { headers: auth }) : Promise.resolve(null),
      isoDate ? getJson(`${origin}/api/listings?date=${isoDate}`, 4500, { headers: auth }) : Promise.resolve(null),
      getJson(`${origin}/api/matchdetails?id=${fmid}`, 4500, { headers: auth }),
    ]);
    const rich = listings && listings.matches && listings.matches[String(fmid)];
    broadcasts = broadcastsFor(tv, home, away, fmid, rich);
    if (md && md.ok && md.details) details = md.details;
  }

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

  const appParams = new URLSearchParams();
  if (hasId) appParams.set("match", "fm:" + fmid);
  else if (get("id")) appParams.set("match", get("id"));
  if (isoDate) appParams.set("date", isoDate);
  const appUrl = "/" + (appParams.toString() ? "?" + appParams.toString() : "");

  const leagueComp = (resolvedFx && resolvedFx.competition) || comp || "";
  const leagueSlug = leagueComp ? leagueSlugFor(leagueComp, kickoff) : get("league") || "";
  const leagueUrl = leagueSlug ? `${origin}/g/${leagueSlug}` : "";
  const edLabel = editionLabel(leagueComp, kickoff);
  const compDisplay = comp ? (edLabel ? `${comp} ${edLabel}` : comp) : "";

  const shareUrl = isoDate
    ? (leagueSlug
        ? `${origin}/g/${leagueSlug}/${isoDate}/${matchSlug(home, away)}`
        : `${origin}/g/${isoDate}/${matchSlug(home, away)}`)
    : hasId
      ? `${origin}/g/${fmid}`
      : `${origin}/g?${new URLSearchParams(
          Object.keys(query).reduce((o, k) => ((o[k] = get(k)), o), {})
        ).toString()}`;

  const vs = `${home} vs ${away}`;
  const heading = c.heading(vs);
  const headline = vs + (compDisplay ? " — " + compDisplay : "");
  const title = c.title(vs, compDisplay);
  const result = score ? `${score} (${status || c.ftShort})` : status ? status : "";
  const when = [dLabel, result].filter(Boolean).join(" · ");
  const description =
    `${vs}${compDisplay ? " · " + compDisplay : ""}${when ? " · " + when : ""}. ` +
    c.descSentence;

  let indexable = hasId && isNotable(comp);
  // A transient fixtures-feed failure must not de-index a match the daily sweep
  // already registered. If we couldn't resolve a live id but this exact canonical
  // path is in the sitemap registry (which only holds real, notable pages), trust
  // it and keep it indexable instead of flipping the whole pSEO surface to
  // noindex whenever the feed is briefly unreachable.
  if (!indexable && parts.length >= 3) {
    const registryPath = `/g/${parts[0]}/${parts[1]}/${parts[2]}`;
    if (await registryHas(registryPath).catch(() => false)) indexable = true;
  }
  const robots = indexable ? "index, follow, max-image-preview:large" : "noindex, follow";

  // structured data
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

  // visible body
  const badge = (url, name) => url
    ? `<img class="crest" src="${esc(url)}" alt="${esc(name)} crest" width="40" height="40" loading="lazy" />`
    : "";

  const times = kickoff ? kickoffTimes(kickoff) : null;
  const freeAny = broadcasts.some((g) => g.channels.some((c) => !isPaidChannel(c)));
  const primaryTv = broadcasts.find((g) => g.country === "Portugal") || broadcasts[0] || null;

  const introBits = [];
  introBits.push(
    c.introTakeOn(home, away) +
    (compDisplay ? c.introIn(compDisplay) : "") +
    (details && details.round ? c.introRound(details.round) : "") +
    (details && details.venue ? c.introVenue(details.venue) : "") + "."
  );
  if (times) introBits.push(c.introKickoff(times.pt, times.utc));
  introBits.push(
    finished && score
      ? c.introFinal(score)
      : freeAny
        ? c.introFree
        : c.introPaid
  );
  const intro = introBits.join(" ");

  const channelLi = (ch) => {
    const paid = isPaidChannel(ch);
    return `<li class="ch ${paid ? "paid" : "free"}">${esc(ch)}` +
      `<span class="tag">${paid ? c.tagSub : c.tagFree}</span></li>`;
  };
  const tvSection = broadcasts.length
    ? `<section class="card">
    <h2>${esc(c.tvHeading(vs))}</h2>
    ${broadcasts.map((g) => `<div class="country">
      <h3>${esc(g.country)}</h3>
      <ul class="chans">${g.channels.map(channelLi).join("")}</ul>
    </div>`).join("")}
    <p class="muted">${esc(c.tvNote(freeAny))}</p>
  </section>`
    : `<section class="card">
    <h2>${esc(c.tvHeading(vs))}</h2>
    <p>${esc(c.tvFallback(vs))}</p>
  </section>`;

  const kickoffSection = times
    ? `<section class="card">
    <h2>${esc(c.kickoffHeading(vs))}</h2>
    <table class="facts">
      <tr><th>${esc(c.rowPortugal)}</th><td>${esc(times.pt)}${dLabel ? " · " + esc(dLabel) : ""}</td></tr>
      <tr><th>${esc(c.rowUK)}</th><td>${esc(times.uk)}</td></tr>
      <tr><th>${esc(c.rowUS)}</th><td>${esc(times.et)}</td></tr>
      <tr><th>${esc(c.rowUTC)}</th><td>${esc(times.utc)}</td></tr>
    </table>
  </section>`
    : "";

  const factRows = [];
  if (details) {
    if (details.round) factRows.push([c.factRound, details.round]);
    if (details.venue) factRows.push([c.factVenue, details.venue]);
    if (details.referee) factRows.push([c.factReferee, details.referee]);
    if (details.attendance) factRows.push([c.factAttendance, details.attendance]);
  }
  const factsSection = factRows.length
    ? `<section class="card">
    <h2>${esc(c.matchInfo)}</h2>
    <table class="facts">${factRows.map(([k, v]) =>
      `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
  </section>`
    : "";

  const h2h = details && details.h2h;
  const form = details && details.form;
  const compareSection = (h2h || form)
    ? `<section class="card">
    <h2>${esc(c.formH2h)}</h2>
    ${form ? `<div class="compare">
      <div><strong>${esc(home)}</strong> ${formDots(form.home)}</div>
      <div><strong>${esc(away)}</strong> ${formDots(form.away)}</div>
    </div>` : ""}
    ${h2h ? `<p class="muted">${esc(c.h2hLine(home, h2h.home, h2h.draw, away, h2h.away))}</p>` : ""}
  </section>`
    : "";

  const lineups = details && details.lineups;
  const xi = (side) => (side && Array.isArray(side.starters) ? side.starters : [])
    .map((p) => `<li>${p.num ? `<span class="num">${esc(p.num)}</span>` : ""}${esc(p.name)}</li>`).join("");
  const lineupSection = (lineups && (lineups.home || lineups.away))
    ? `<section class="card">
    <h2>${esc(lineups.confirmed ? c.lineupsConfirmed : c.lineupsProbable)}</h2>
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
    ${lineups.confirmed ? "" : `<p class="muted">${esc(c.lineupNote)}</p>`}
  </section>`
    : "";

  const meetings = (details && Array.isArray(details.h2hMatches)) ? details.h2hMatches : [];
  const meetingsSection = meetings.length
    ? `<section class="card">
    <h2>${esc(c.lastMeetings)}</h2>
    <ul class="meetings">${meetings.map((m) => `<li>
      ${m.date ? `<span class="when">${esc(m.date)}</span>` : ""}
      <span class="mt">${esc(m.home)} <strong>${esc(m.score || "v")}</strong> ${esc(m.away)}</span>
      ${m.comp ? `<span class="muted comp">${esc(m.comp)}</span>` : ""}
    </li>`).join("")}</ul>
  </section>`
    : "";

  const faqs = [];
  if (primaryTv) {
    faqs.push([
      c.faqChannelQ(vs, primaryTv.country),
      c.faqChannelA(vs, listJoin(primaryTv.channels, andWord), primaryTv.country),
    ]);
  } else {
    faqs.push([
      c.faqChannelNoQ(vs),
      c.faqChannelNoA(vs),
    ]);
  }
  if (times) {
    faqs.push([
      c.faqTimeQ(vs),
      c.faqTimeA(vs, times.pt, times.uk, times.et, times.utc, dLabel),
    ]);
  }
  faqs.push([
    c.faqFreeQ(vs),
    freeAny ? c.faqFreeYesA(vs) : c.faqFreeNoA(vs),
  ]);
  if (details && details.venue) {
    faqs.push([c.faqVenueQ(vs), c.faqVenueA(vs, details.venue)]);
  }
  if (compDisplay) {
    faqs.push([c.faqCompQ(vs), c.faqCompA(vs, compDisplay)]);
  }
  const faqSection = `<section class="card faq">
    <h2>${esc(c.faqTitle(vs))}</h2>
    ${faqs.map(([qq, a]) => `<details><summary>${esc(qq)}</summary><p>${esc(a)}</p></details>`).join("")}
  </section>`;
  graph.push({
    "@type": "FAQPage",
    mainEntity: faqs.map(([qq, a]) => ({
      "@type": "Question", name: qq,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  });

  const moreSection = leagueUrl
    ? `<p class="more"><a href="${esc(leagueUrl)}">${esc(c.more(compDisplay))}</a></p>`
    : "";

  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>

    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">${esc(c.crumbHome)}</a>${comp && leagueUrl ? ` › <a href="${esc(leagueUrl)}">${esc(compDisplay)}</a>` : ""} › <span>${esc(vs)}</span>
    </nav>

    <h1>${esc(heading)}</h1>
    <div class="teams">
      <span class="t">${badge(homeBadge, home)}${esc(home)}</span>
      <span class="vs">${esc(c.vs)}</span>
      <span class="t">${badge(awayBadge, away)}${esc(away)}</span>
    </div>
    ${score ? `<div class="score">${esc(score)}</div>` : ""}
    <p class="meta">${esc([compDisplay, when].filter(Boolean).join(" · "))}</p>

    <p class="intro">${esc(intro)}</p>

    <a class="cta" href="${esc(appUrl)}">${esc(c.cta(vs))}</a>

    ${tvSection}
    ${kickoffSection}
    ${lineupSection}
    ${meetingsSection}
    ${factsSection}
    ${compareSection}
    ${faqSection}
    ${moreSection}

    <footer>
      <a href="/">Hoje Há Bola</a> — ${esc(c.footerTail)}
      <br>${footerCreditsHtml(c)}
    </footer>
  </div>`;

  return {
    ok: true,
    robots, title, description, headline,
    canonical: shareUrl, ogType: "article", ogImage: imageUrl,
    css: SHARE_CSS, bodyHtml, jsonLd,
  };
}

// ---- League hub (/g/<league>) ------------------------------------------

const LEAGUE_CSS = `
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
`;

function lisbonYmd(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
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

const DAYS_AHEAD = 8;

export async function buildLeague({ origin, lang, leagueSlug, auth }) {
  const c = COPY[lang] || COPY.en;
  leagueSlug = String(leagueSlug || "").trim().toLowerCase();
  const canonical = `${origin}/g/${leagueSlug}`;

  const today = lisbonYmd(new Date());
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  const feeds = await Promise.all(
    dates.map((d) => getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000, { headers: auth, retries: 1 }))
  );

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

  // Bare /g/<league> for an edition competition → redirect to the current edition.
  if (!games.length) {
    const baseMatch = all
      .filter((f) => slugify(f.competition) === leagueSlug && EDITION_RE.test(f.competition || ""))
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))[0];
    if (baseMatch) {
      return { redirect: `${origin}/g/${leagueSlugFor(baseMatch.competition, baseMatch.kickoff)}` };
    }
  }

  games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  games = games.slice(0, 80);

  const baseName = (games[0] && games[0].competition) || titleize(leagueSlug);
  const edLabel = games[0] ? editionLabel(games[0].competition, games[0].kickoff) : "";
  const leagueName = edLabel ? `${baseName} ${edLabel}` : baseName;
  const indexable = isNotable(leagueName) && games.length > 0;
  const robots = indexable ? "index, follow, max-image-preview:large" : "noindex, follow";

  const title = c.leagueTitle(leagueName);
  const description = c.leagueDesc(leagueName);

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
    : `<p class="muted">${esc(c.leagueNoGames(leagueName))}</p>`;

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

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">${esc(c.crumbHome)}</a> › <span>${esc(leagueName)}</span>
    </nav>

    <h1>${esc(c.leagueH1(leagueName))}</h1>
    <p class="lead">${esc(description)}</p>

    ${listSection}

    <footer>
      <a href="/">Hoje Há Bola</a> — ${esc(c.footerTail)}
      <br>${footerCreditsHtml(c)}
    </footer>
  </div>`;

  return {
    ok: true,
    robots, title, description,
    headline: c.leagueHeadline(leagueName),
    canonical, ogType: "website", ogImage: "",
    css: LEAGUE_CSS, bodyHtml, jsonLd,
  };
}
