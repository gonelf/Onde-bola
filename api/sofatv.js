/*
 * /api/sofatv — best-effort, UNOFFICIAL secondary TV source (SofaScore).
 *
 * SofaScore's web API blocks browser CORS, so the page can't call it directly;
 * this server proxy does, caches results in Vercel KV, and is used only on
 * demand (when a match is opened) to fill gaps TheSportsDB didn't cover.
 *
 * It is unofficial and against SofaScore's ToS, so it may be blocked at any
 * time. Every failure degrades gracefully to an empty result — it never breaks
 * the page. Returns TheSportsDB-shaped rows: { tvevent: [{strChannel, strCountry}] }.
 *
 * Query: ?date=YYYY-MM-DD&home=<team>&away=<team>
 * Env (optional): KV_REST_API_URL / KV_REST_API_TOKEN to enable caching.
 *   SOFASCORE_DISABLED=1 to turn this source off entirely.
 */

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const DISABLED = process.env.SOFASCORE_DISABLED === "1";
const BASE = "https://api.sofascore.com/api/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const CODE_TO_COUNTRY = {
  PT: "Portugal", GB: "United Kingdom", IE: "Ireland", US: "United States",
  ES: "Spain", BR: "Brazil", FR: "France", DE: "Germany", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", AR: "Argentina", MX: "Mexico", CA: "Canada",
  AU: "Australia", SA: "Saudi Arabia", TR: "Turkey", GR: "Greece", CH: "Switzerland",
  AT: "Austria", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark",
  FI: "Finland", JP: "Japan", KR: "South Korea", CN: "China", IN: "India",
  RU: "Russia", HR: "Croatia", RS: "Serbia", RO: "Romania", UA: "Ukraine",
  CZ: "Czech Republic", HU: "Hungary",
};

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
  const t = setTimeout(() => ctrl.abort(), ms || 4500);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.sofascore.com/" },
    });
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

function teamMatch(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// Build (and cache) a small index of the day's events: [normHome, normAway, id].
async function getDayIndex(date) {
  const key = `sofa:idx:${date}`;
  const cached = await kv(["GET", key]);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  const data = await getJson(`${BASE}/sport/football/scheduled-events/${date}`);
  const events = (data && data.events) || [];
  const index = events.map((e) => [
    norm(e.homeTeam && e.homeTeam.name), norm(e.awayTeam && e.awayTeam.name), e.id,
  ]).filter((row) => row[0] && row[1] && row[2]);

  if (index.length) await kv(["SET", key, JSON.stringify(index), "EX", "3600"]);
  return index;
}

// Batch resolver: one call per country returns that country's channels as
// id -> name. Much cheaper and more reliable than resolving ids one by one,
// which is what was dropping Portuguese channel names. Cached 7 days.
async function getCountryChannelNames(code) {
  const key = `sofa:pop:${code}`;
  const cached = await kv(["GET", key]);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }

  const data = await getJson(`${BASE}/tv/country/${code}/popular-channels`);
  const arr = data && (data.tvChannels || data.channels || data.popularChannels);
  const map = {};
  if (Array.isArray(arr)) {
    arr.forEach((c) => { if (c && c.id != null && c.name) map[c.id] = c.name; });
  }
  await kv(["SET", key, JSON.stringify(map), "EX", "604800"]);
  return map;
}

// Per-id fallback for channels the batch list didn't include.
async function resolveChannelName(id) {
  const key = `sofa:ch:${id}`;
  const cached = await kv(["GET", key]);
  if (cached !== null && cached !== undefined) return cached || null;

  const data = await getJson(`${BASE}/tv/channel/${id}`);
  const ch = data && (data.tvChannel || data.channel || data);
  const name = (ch && ch.name) || "";
  await kv(["SET", key, name, "EX", "604800"]); // cache 7 days (incl. empties)
  return name || null;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  if (DISABLED) { res.status(200).json({ tvevent: [] }); return; }

  const { date, home, away } = req.query || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !home || !away) {
    res.status(400).json({ error: "Pass ?date=YYYY-MM-DD&home=&away=" });
    return;
  }

  const resultKey = `sofa:res:${date}:${norm(home)}|${norm(away)}`;
  const cached = await kv(["GET", resultKey]);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    res.status(200).json(JSON.parse(cached));
    return;
  }

  let tvevent = [];
  try {
    const index = await getDayIndex(date);
    const hit = index.find((row) => teamMatch(home, row[0]) && teamMatch(away, row[1]));
    if (hit) {
      const cc = await getJson(`${BASE}/tv/event/${hit[2]}/country-channels`);
      const countryChannels = (cc && cc.countryChannels) || {};

      // Collect (countryCode, channelId|name) pairs, bounded for safety.
      // Process preferred markets (Portugal first) ahead of the rest so a busy
      // World Cup match's many countries never push PT past the cap.
      const PREFERRED = ["PT", "GB", "ES", "BR", "FR", "IT", "DE", "NL", "US", "IE"];
      const codes = Object.keys(countryChannels).sort((a, b) => {
        const ia = PREFERRED.indexOf(a), ib = PREFERRED.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      const pairs = [];
      for (const code of codes) {
        const arr = countryChannels[code] || [];
        for (const item of arr) {
          if (pairs.length >= 120) break;
          pairs.push([code, item]);
        }
      }

      // Resolve channel ids to names. First batch-load each country's channel
      // list (one call per country, Portugal-first), then fall back to the
      // per-id lookup only for ids the batch lists didn't cover.
      const names = {};
      const usedCodes = [...new Set(pairs.map((p) => p[0]))].slice(0, 14);
      await Promise.all(usedCodes.map(async (code) => {
        Object.assign(names, await getCountryChannelNames(code));
      }));

      const ids = [...new Set(pairs.map((p) => p[1]).filter((v) =>
        (typeof v === "number" || /^\d+$/.test(String(v))) && !names[v]))];
      await Promise.all(ids.map(async (id) => { names[id] = await resolveChannelName(id); }));

      const seen = {};
      for (const [code, item] of pairs) {
        const name = (item && typeof item === "object" && item.name) ? item.name : names[item];
        if (!name) continue;
        const country = CODE_TO_COUNTRY[code] || code;
        const k = name + "|" + country;
        if (seen[k]) continue;
        seen[k] = true;
        tvevent.push({ strChannel: name, strCountry: country });
      }
    }
  } catch (e) {
    tvevent = [];
  }

  // Cache the result (even empty, briefly) to avoid hammering on misses.
  await kv(["SET", resultKey, JSON.stringify({ tvevent }), "EX", tvevent.length ? "3600" : "900"]);

  res.setHeader("X-Cache", "MISS");
  res.status(200).json({ tvevent });
};
