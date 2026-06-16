/*
 * cron-sitemap — background sweep that records the canonical SEO URLs so
 * /sitemap.xml is consistent and incremental rather than a per-request window.
 * Dispatched by api/share.js on `?cron=1` (it isn't its own function, to stay
 * under the platform's per-deployment function limit).
 *
 * What it does, per run:
 *   1. Scan the fixtures feed (same source as /api/fixtures) over a recent +
 *      upcoming window.
 *   2. Keep notable competitions, and for each build its match page URL
 *      (/g/<league>/<date>/<home>-vs-<away>) and the league/edition hub
 *      (/g/<league>) — the same slugs the pages canonicalize to.
 *   3. Upsert them into a KV hash (`seo:urls` → path: lastmod). lastmod freezes
 *      to the match date once the game is in the past (its page is immutable);
 *      today/upcoming use today. So URLs accumulate and never silently vanish.
 *   4. Prune entries older than ~400 days so the file stays bounded.
 *
 * The sitemap then just reads this registry. Daily is plenty, so this runs as a
 * native Vercel cron (vercel.json → /api/share?cron=1) — no external scheduler
 * needed. If CRON_SECRET is set, send it as `Authorization: Bearer <secret>`
 * or `?key=`.
 *
 * Env: CRON_SECRET (optional), FOTMOB_DISABLED=1,
 *      KV_REST_API_URL / KV_REST_API_TOKEN (required to store anything),
 *      SITEMAP_DAYS_BACK / SITEMAP_DAYS_AHEAD / SITEMAP_PRUNE_DAYS (optional).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const SECRET = process.env.CRON_SECRET || "";
const REGISTRY = "seo:urls";

const DAYS_BACK = Math.max(0, Number(process.env.SITEMAP_DAYS_BACK) || 3);
const DAYS_AHEAD = Math.max(1, Number(process.env.SITEMAP_DAYS_AHEAD) || 14);
const PRUNE_DAYS = Math.max(30, Number(process.env.SITEMAP_PRUNE_DAYS) || 400);

const str = (x) => (x == null ? "" : String(x)).trim();

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const slugify = (name) => norm(name).replace(/ /g, "-");
const matchSlug = (home, away) => `${slugify(home)}-vs-${slugify(away)}`;

// Kept in sync with api/share.js, api/league.js and api/sitemap.js.
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

async function kv(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(KV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!r.ok) return null;
    return (await r.json()).result;
  } catch (e) { return null; }
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

// Sweep the window into a { path: lastmod } map of canonical SEO URLs. Exported
// so /api/sitemap can reuse it as a read-only fallback before the first run.
async function sweep(origin) {
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

function authorized(req) {
  if (!SECRET) return true; // open if no secret configured
  const auth = str((req.headers && (req.headers.authorization || req.headers.Authorization)) || "");
  const bearer = auth.replace(/^Bearer\s+/i, "");
  const key = str((req.query || {}).key);
  return bearer === SECRET || key === SECRET;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!authorized(req)) { res.status(401).json({ ok: false, error: "unauthorized" }); return; }
  if (DISABLED) { res.status(200).json({ ok: false, disabled: true }); return; }
  if (!KV_URL || !KV_TOKEN) {
    res.status(200).json({ ok: false, error: "KV not configured — nothing to persist" });
    return;
  }

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const { map, today } = await sweep(origin);

  const paths = Object.keys(map);
  let added = 0;
  if (paths.length) {
    const args = ["HSET", REGISTRY];
    paths.forEach((p) => args.push(p, map[p]));
    await kv(args);
    added = paths.length;
  }

  // Prune entries older than the window's tail.
  const cutoff = addDays(today, -PRUNE_DAYS);
  const raw = await kv(["HGETALL", REGISTRY]);
  const reg = {};
  if (Array.isArray(raw)) { for (let i = 0; i < raw.length; i += 2) reg[raw[i]] = raw[i + 1]; }
  else if (raw && typeof raw === "object") Object.assign(reg, raw);
  const stale = Object.keys(reg).filter((p) => String(reg[p]) < cutoff);
  if (stale.length) await kv(["HDEL", REGISTRY].concat(stale));

  res.status(200).json({ ok: true, swept: added, pruned: stale.length, total: Object.keys(reg).length - stale.length });
};

module.exports.sweep = sweep;
