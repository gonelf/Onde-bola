/*
 * /api/cardinfo — minimal "share card" data for one match.
 *
 * Lets the share page (/g) and the preview image (/og) rebuild a game's display
 * (teams, crests, competition, score/kickoff, date) without carrying every
 * field in the URL. A match is addressed by a human, SEO-friendly slug:
 *
 *     ?date=YYYY-MM-DD&slug=<home>-vs-<away>     e.g. belgium-vs-egypt
 *
 * which is resolved against the cached fixtures feed for that day. A legacy
 * `?id=<FOTMOB_MATCH_ID>` form (resolved via FotMob matchDetails) is kept for
 * back-compat with links shared before the slug URLs existed. Results are
 * cached in Vercel KV (`card:*`) — long once the game is finished, briefly
 * while it's live/upcoming.
 *
 * Returns: { ok, card: { fmid, home, away, homeBadge, awayBadge, comp,
 *            leagueBadge, score, status, date, isoDate, finished } }
 *
 * Env: FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TEAM_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
const LEAGUE_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;

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
  } catch (e) {
    return null;
  }
}

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA, Accept: "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9", Referer: "https://www.fotmob.com/",
      },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const str = (x) => (x == null ? "" : String(x)).trim();

// Team-name -> URL slug. Must stay byte-for-byte in sync with the client's
// slug() in assets/app.js so a shared /g/<date>/<slug> resolves back here.
function slugify(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
const matchSlug = (fx) => slugify(fx.home) + "-vs-" + slugify(fx.away);

// Lisbon-local labels (the app is Portugal-first) from an ISO kickoff.
function whenLabels(iso) {
  const d = iso ? new Date(iso) : null;
  const valid = d && !isNaN(d.getTime());
  const fmt = (opts) =>
    valid ? new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "Europe/Lisbon" }, opts)).format(d) : "";
  return {
    time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),
    date: fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    iso: valid
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
      : "",
  };
}

// Build a card from a normalised fixture (as returned by /api/fixtures).
function cardFromFixture(fx) {
  const s = str(fx.status).toUpperCase();
  const finished = s === "FT" || /(AET|PEN|FINISHED|FULL TIME)/.test(s);
  const live = !finished && (s === "HT" || /^\d/.test(s) || /(1H|2H|ET|LIVE|IN PLAY)/.test(s));
  const hasScore = fx.homeScore != null && fx.awayScore != null;
  const w = whenLabels(fx.kickoff);

  // FotMob files World Cup / continental groups as their own competition
  // ("World Cup Grp F"); collapse to the tournament for a cleaner label.
  let comp = str(fx.competition);
  const gm = /^(.+?)\s+(?:Grp|Group)\.?\s+([A-Z0-9]+)$/i.exec(comp);
  if (gm) comp = gm[1].trim();

  return {
    fmid: str(fx.fmid),
    home: fx.home, away: fx.away,
    homeBadge: str(fx.homeBadge), awayBadge: str(fx.awayBadge),
    comp, leagueBadge: str(fx.leagueBadgeUrl),
    score: (finished || live) && hasScore ? `${fx.homeScore} - ${fx.awayScore}` : "",
    status: finished ? "FT" : live ? (str(fx.status) || "LIVE") : w.time,
    date: w.date, isoDate: w.iso, finished,
  };
}

// Pull the same fields out of FotMob's matchDetails blob (legacy ?id= path).
function cardFromDetails(fmid, data) {
  const general = data.general || {};
  const header = data.header || {};
  const teams = Array.isArray(header.teams) ? header.teams : [];
  const status = header.status || {};
  const homeT = teams[0] || general.homeTeam || {};
  const awayT = teams[1] || general.awayTeam || {};
  const homeId = homeT.id != null ? homeT.id : general.homeTeam && general.homeTeam.id;
  const awayId = awayT.id != null ? awayT.id : general.awayTeam && general.awayTeam.id;
  const leagueId = general.leagueId != null ? general.leagueId : general.parentLeagueId;

  const finished = !!status.finished;
  const started = !!status.started;
  const scoreStr = str(status.scoreStr).replace(/\s*-\s*/, " - ");
  const reason = str(status.reason && (status.reason.short || status.reason.long));
  const liveT = str(status.liveTime && (status.liveTime.short || status.liveTime.long));
  const w = whenLabels(str(status.utcTime || general.matchTimeUTC));

  return {
    fmid: String(fmid),
    home: str(homeT.name) || str(general.homeTeam && general.homeTeam.name) || "Home",
    away: str(awayT.name) || str(general.awayTeam && general.awayTeam.name) || "Away",
    homeBadge: str(homeT.imageUrl) || (homeId != null ? TEAM_LOGO(homeId) : ""),
    awayBadge: str(awayT.imageUrl) || (awayId != null ? TEAM_LOGO(awayId) : ""),
    comp: str(general.leagueName || general.parentLeagueName),
    leagueBadge: leagueId != null ? LEAGUE_LOGO(leagueId) : "",
    score: (started || finished) && scoreStr ? scoreStr : "",
    status: finished ? reason || "FT" : started ? liveT || "LIVE" : w.time,
    date: w.date, isoDate: w.iso, finished,
  };
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// Primary path: resolve a date + team-name slug against the day's fixtures.
async function getCardBySlug(origin, date, slug) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slug) return { ok: false, error: "bad slug" };
  if (DISABLED) return { ok: false, disabled: true };

  const cacheKey = `card:slug:${date}:${slug}`;
  const cached = await kv(["GET", cacheKey]);
  if (cached) {
    try { return Object.assign(JSON.parse(cached), { _cache: "HIT" }); } catch (e) {}
  }
  if (!origin) return { ok: false, error: "no origin" };

  const data = await fetchJson(`${origin}/api/fixtures?date=${date}`);
  const fixtures = (data && data.fixtures) || [];
  const fx = fixtures.filter((f) => matchSlug(f) === slug)[0];
  if (!fx) return { ok: false };

  const card = cardFromFixture(fx);
  const payload = { ok: true, card };
  await kv(["SET", cacheKey, JSON.stringify(payload), "EX", card.finished ? "604800" : "120"]);
  return payload;
}

// Legacy path: resolve a FotMob match id via matchDetails.
async function getCardById(id) {
  const fmid = String(id || "").replace(/^fm:/, "").trim();
  if (!fmid || !/^\d+$/.test(fmid)) return { ok: false, error: "bad id" };
  if (DISABLED) return { ok: false, disabled: true };

  const cacheKey = `card:id:${fmid}`;
  const cached = await kv(["GET", cacheKey]);
  if (cached) {
    try { return Object.assign(JSON.parse(cached), { _cache: "HIT" }); } catch (e) {}
  }

  let data = await getJson(`${BASE}/data/matchDetails?matchId=${fmid}`);
  if (!data || (!data.header && !data.general)) data = await getJson(`${BASE}/matchDetails?matchId=${fmid}`);
  if (!data || (!data.header && !data.general)) return { ok: false };

  const card = cardFromDetails(fmid, data);
  const payload = { ok: true, card };
  await kv(["SET", cacheKey, JSON.stringify(payload), "EX", card.finished ? "604800" : "120"]);
  return payload;
}

// Single entry point. Prefer the slug form; fall back to the id form.
async function getCard(opts) {
  opts = opts || {};
  if (opts.date && opts.slug) return getCardBySlug(opts.origin, String(opts.date), String(opts.slug));
  if (opts.id) return getCardById(opts.id);
  return { ok: false, error: "no key" };
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const origin = host ? `${proto}://${host}` : "";

  const result = await getCard({ origin, id: q.id, date: q.date, slug: q.slug });
  const ttl = result.ok && result.card && result.card.finished ? 604800 : 120;
  res.setHeader("Cache-Control", `public, s-maxage=${ttl}, stale-while-revalidate=86400`);
  res.setHeader("X-Cache", result._cache || "MISS");
  res.status(200).json(result);
};

module.exports.getCard = getCard;
module.exports.slugify = slugify;
