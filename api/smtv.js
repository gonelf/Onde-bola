/*
 * /api/smtv — SportMonks TV broadcaster source (official, paid API).
 *
 * Unlike SofaScore (one call per event), SportMonks returns a whole day's
 * fixtures WITH their TV stations in a single call, so this proxy builds the
 * entire day's broadcaster map in one go and caches it. The client fetches it
 * once per day and merges the results into every match.
 *
 * Gated behind SPORTMONKS_KEY: with no key it is fully disabled and returns an
 * empty map, so deploying it changes nothing until a key is configured. The key
 * must come from a SportMonks plan that includes the `tvStations` entity.
 *
 * Query: ?date=YYYY-MM-DD
 * Returns: { matches: [ { h, a, rows: [{channel, country}] } ] }  (h/a normalized)
 *
 * Env: SPORTMONKS_KEY (required to enable), KV_REST_API_URL / KV_REST_API_TOKEN
 *      (optional caching).
 */

const KEY = process.env.SPORTMONKS_KEY;
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const BASE = "https://api.sportmonks.com/v3/football";
const MAX_PAGES = 5; // bound runtime; ~250 fixtures/day at per_page=50

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

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

// Pull home/away names out of the participants include.
function teams(fx) {
  let home = "", away = "";
  (fx.participants || []).forEach((p) => {
    const loc = p && p.meta && p.meta.location;
    if (loc === "home") home = p.name || home;
    else if (loc === "away") away = p.name || away;
  });
  return [home, away];
}

// Pull broadcaster rows out of the (defensively-shaped) tvStations include.
function stations(fx) {
  const tvs = fx.tvStations || fx.tvstations || [];
  const rows = [];
  const seen = {};
  (Array.isArray(tvs) ? tvs : []).forEach((t) => {
    const st = (t && (t.tvStation || t.tvstation)) || t;
    const name = st && st.name;
    if (!name) return;
    let country = "International";
    const c = (t && t.country) || (st && st.country);
    if (c && c.name) country = c.name;
    const k = name + "|" + country;
    if (seen[k]) return;
    seen[k] = true;
    rows.push({ channel: name, country: country });
  });
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=1800");

  if (!KEY) { res.status(200).json({ matches: [], disabled: true }); return; }

  const { date } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "Pass ?date=YYYY-MM-DD" });
    return;
  }

  const cacheKey = `sm:day:${date}`;
  const cached = await kv(["GET", cacheKey]);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(JSON.parse(cached));
    return;
  }

  const include = "participants;tvStations.tvStation;tvStations.country";
  const matches = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}/fixtures/date/${date}?api_token=${encodeURIComponent(KEY)}` +
        `&include=${encodeURIComponent(include)}&per_page=50&page=${page}`;
      const data = await getJson(url);
      const list = (data && data.data) || [];
      list.forEach((fx) => {
        const rows = stations(fx);
        if (!rows.length) return;
        const [h, a] = teams(fx);
        if (!h || !a) return;
        matches.push({ h: norm(h), a: norm(a), rows: rows });
      });
      const pg = data && data.pagination;
      if (!pg || !pg.has_more) break;
    }
  } catch (e) { /* fail safe to whatever we collected */ }

  const payload = { matches };
  // Cache 30 min (even when empty, briefly) to limit paid-API usage.
  await kv(["SET", cacheKey, JSON.stringify(payload), "EX", matches.length ? "1800" : "600"]);

  res.setHeader("X-Cache", "MISS");
  res.status(200).json(payload);
};
