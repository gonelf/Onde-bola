/*
 * lib/sitemap-sweep — the SEO URL registry sweep, ported from lib/cron-sitemap.
 *
 * Scans the fixtures feed over a recent + upcoming window and builds a
 * { path: lastmod } map of canonical SEO URLs (match pages + league/edition
 * hubs) for notable competitions. The sitemap route reads the KV registry the
 * cron maintains; before the first cron run it falls back to this live sweep.
 */

const DAYS_BACK = Math.max(0, Number(process.env.SITEMAP_DAYS_BACK) || 3);
const DAYS_AHEAD = Math.max(1, Number(process.env.SITEMAP_DAYS_AHEAD) || 14);

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;

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

const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
function editionYear(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + 1 : y;
}
function leagueSlugFor(comp, iso) {
  const base = slugify(comp || "");
  if (comp && EDITION_RE.test(comp)) {
    const y = editionYear(iso);
    if (y) return `${base}-${y}`;
  }
  return base;
}

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
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

export function lisbonYmd(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
export function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Sweep the window into a { path: lastmod } map of canonical SEO URLs.
export async function sweep(origin) {
  const today = lisbonYmd(new Date());
  const dates = [];
  for (let i = -DAYS_BACK; i <= DAYS_AHEAD; i++) dates.push(addDays(today, i));

  const feeds = await Promise.all(
    dates.map((d) => getJson(`${origin}/api/fixtures?date=${d}&all=1`, 5000))
  );

  const map = {};
  feeds.forEach((feed) => {
    const list = feed && Array.isArray(feed.fixtures) ? feed.fixtures : [];
    list.forEach((f) => {
      if (!f || !f.home || !f.away || !isNotable(f.competition)) return;
      const d = lisbonYmd(new Date(f.kickoff));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      const league = leagueSlugFor(f.competition, f.kickoff);
      map[`/g/${league}`] = today; // hub, always "fresh"
      map[`/g/${league}/${d}/${matchSlug(f.home, f.away)}`] = d < today ? d : today;
    });
  });
  return { map, today };
}
