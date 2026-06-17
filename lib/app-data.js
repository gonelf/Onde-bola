/*
 * Client-side data layer for the games browser, ported from assets/app.js.
 *
 * Pure data fetching + listing helpers (no DOM, no React): the day's fixtures
 * from /api/fixtures, real TV listings merged from /api/tv + /api/fmtv (+ the
 * optional SofaScore proxy), per-match detail from /api/matchdetails, and the
 * country/channel ordering the cards and modal use. Session-scoped caches keep
 * silent 60s refreshes from re-fetching everything.
 */

import { isPaidChannel } from "./broadcasters";
import { nameKey, normName } from "./format";

const API_BASE = "https://www.thesportsdb.com/api/v1/json/123";

// FotMob's day-bulk source fills cards with Portuguese (and other) channels up
// front, so the per-match SofaScore call is off by default — kept as an optional
// fallback (flip to true to consult it on match open).
const USE_SOFASCORE = false;

// ISO country code -> display name, for the IP-derived default country.
export const CODE_TO_COUNTRY = {
  PT: "Portugal", GB: "United Kingdom", IE: "Ireland", US: "United States",
  ES: "Spain", BR: "Brazil", FR: "France", DE: "Germany", IT: "Italy",
  NL: "Netherlands", BE: "Belgium", AR: "Argentina", MX: "Mexico", CA: "Canada",
  AU: "Australia", SA: "Saudi Arabia", TR: "Turkey", GR: "Greece", CH: "Switzerland",
  AT: "Austria", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark",
  FI: "Finland", JP: "Japan", KR: "South Korea", CN: "China", IN: "India",
  RO: "Romania", UA: "Ukraine", CZ: "Czech Republic", HU: "Hungary", RS: "Serbia",
  HR: "Croatia",
};

// Country name -> flag emoji, for real listings keyed by broadcaster country.
const COUNTRY_FLAGS = {
  "Portugal": "🇵🇹", "United Kingdom": "🇬🇧", "England": "🇬🇧", "Ireland": "🇮🇪",
  "United States": "🇺🇸", "USA": "🇺🇸", "Spain": "🇪🇸", "Brazil": "🇧🇷",
  "France": "🇫🇷", "Germany": "🇩🇪", "Italy": "🇮🇹", "Netherlands": "🇳🇱",
  "Belgium": "🇧🇪", "Portugal ": "🇵🇹", "Argentina": "🇦🇷", "Mexico": "🇲🇽",
  "Canada": "🇨🇦", "Australia": "🇦🇺", "Saudi Arabia": "🇸🇦", "Turkey": "🇹🇷",
  "Greece": "🇬🇷", "Switzerland": "🇨🇭", "Austria": "🇦🇹", "Poland": "🇵🇱",
  "Sweden": "🇸🇪", "Norway": "🇳🇴", "Denmark": "🇩🇰", "Finland": "🇫🇮",
  "Japan": "🇯🇵", "South Korea": "🇰🇷", "China": "🇨🇳", "India": "🇮🇳",
  "Russia": "🇷🇺", "Croatia": "🇭🇷", "Serbia": "🇷🇸", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "Romania": "🇷🇴", "Ukraine": "🇺🇦", "Czech Republic": "🇨🇿", "Hungary": "🇭🇺",
  "International": "🌍", "Worldwide": "🌍",
};

export function countryFlag(name) {
  return COUNTRY_FLAGS[(name || "").trim()] || "📺";
}

export function initials(name) {
  return (name || "?").trim().slice(0, 2).toUpperCase();
}

// Listings show the chosen country first, then a few major markets, then A–Z.
const COUNTRY_PRIORITY = ["United Kingdom", "England", "Spain",
  "Brazil", "France", "Italy", "Germany", "Netherlands", "United States"];

export function orderCountries(names, primaryCountry) {
  return names.slice().sort(function (a, b) {
    if (a === primaryCountry && b !== primaryCountry) return -1;
    if (b === primaryCountry && a !== primaryCountry) return 1;
    var ia = COUNTRY_PRIORITY.indexOf(a); if (ia === -1) ia = 999;
    var ib = COUNTRY_PRIORITY.indexOf(b); if (ib === -1) ib = 999;
    return ia !== ib ? ia - ib : a.localeCompare(b);
  });
}

// Free-to-air (open signal) channels first, then paid; stable within each group.
export function orderChannels(names) {
  return names.slice().sort(function (a, b) {
    return (isPaidChannel(a) ? 1 : 0) - (isPaidChannel(b) ? 1 : 0);
  });
}

export function groupByCountry(tv) {
  var byCountry = {};
  (tv || []).forEach(function (t) {
    var c = t.country || "International";
    if (!byCountry[c]) byCountry[c] = [];
    if (byCountry[c].indexOf(t.channel) === -1) byCountry[c].push(t.channel);
  });
  return byCountry;
}

// Competition ordering: biggest tournaments (by FotMob league id), then the
// selected country's competitions, then everything else A–Z.
const COMP_PRIORITY = [77, 76, 50, 44, 9134, 42, 73, 10216, 45];
const COUNTRY_CCODES = {
  "Portugal": ["POR"], "Spain": ["ESP"], "England": ["ENG"],
  "United Kingdom": ["ENG", "SCO", "WAL", "NIR"], "France": ["FRA"],
  "Germany": ["GER"], "Italy": ["ITA"], "Netherlands": ["NED"],
  "Brazil": ["BRA"], "United States": ["USA"], "Argentina": ["ARG"],
  "Mexico": ["MEX"],
};

export function compRank(meta, primaryCountry) {
  var pri = meta.leagueId != null ? COMP_PRIORITY.indexOf(Number(meta.leagueId)) : -1;
  if (pri >= 0) return [0, pri, ""];
  var mine = COUNTRY_CCODES[primaryCountry] || [];
  if (meta.ccode && mine.indexOf(meta.ccode) >= 0) return [1, 0, meta.name];
  return [2, 0, meta.name];
}

// ---- Highlights helpers -------------------------------------------------

// Resolve an 11-char YouTube id from a highlight record.
export function ytIdOf(h) {
  var direct = h && h.youtubeId;
  if (direct && /^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;
  var m = String((h && h.url) || "").match(
    /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

// The watch link for a finished game's highlight, or "" when none available.
export function highlightLink(fx, highlightsById) {
  var h = fx && fx.fmid && highlightsById[String(fx.fmid)];
  if (!h) return "";
  var id = ytIdOf(h);
  if (id) return "https://youtu.be/" + id;
  if (h.url && /^https?:\/\//.test(h.url)) return h.url;
  return "";
}

// ---- Data fetching ------------------------------------------------------

function splitCompetitionLocal(name) {
  var m = /^(.+?)\s+(?:Grp|Group)\.?\s+([A-Z0-9]+)$/i.exec((name || "").trim());
  if (m) return { base: m[1].trim(), group: m[2].toUpperCase() };
  return { base: name || "Football", group: "" };
}

export function fetchFotMobFixtures(day) {
  return fetch("/api/fixtures?date=" + day, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("fixtures " + r.status); return r.json(); })
    .then(function (d) {
      return ((d && d.fixtures) || []).map(function (fx) {
        fx.tv = fx.tv || [];
        var parts = splitCompetitionLocal(fx.competition);
        fx.competition = parts.base;
        fx.group = parts.group;
        return fx;
      });
    });
}

function fetchTvRows(proxyQuery, directUrl) {
  return fetch("/api/tv?" + proxyQuery, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("proxy " + r.status); return r.json(); })
    .catch(function () {
      return fetch(directUrl, { headers: { Accept: "application/json" } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    })
    .then(function (data) { return (data && (data.tvevent || data.events)) || []; })
    .catch(function () { return []; });
}

export function fetchTv(day) {
  return fetchTvRows("date=" + day, API_BASE + "/eventstv.php?d=" + day + "&s=Soccer")
    .then(function (rows) {
      var byId = {}, byName = {};
      rows.forEach(function (row) {
        var channel = row.strChannel;
        if (!channel) return;
        var entry = { channel: channel, country: row.strCountry || "International" };
        var id = row.idEvent && String(row.idEvent);
        if (id) (byId[id] = byId[id] || []).push(entry);
        var nm = (row.strEvent || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (nm) (byName[nm] = byName[nm] || []).push(entry);
      });
      return { byId: byId, byName: byName };
    });
}

export function attachTv(fixtures, tv) {
  fixtures.forEach(function (fx) {
    var t = tv.byId[String(fx.id)] ||
      tv.byName[nameKey(fx.home, fx.away)] ||
      tv.byName[nameKey(fx.away, fx.home)];
    fx.tv = t || [];
  });
}

var tvCache = {};
export var loadedTv = {};

function fetchEventTv(id) {
  if (tvCache[id]) return Promise.resolve(tvCache[id]);
  return fetchTvRows("id=" + encodeURIComponent(id),
      API_BASE + "/lookuptv.php?id=" + encodeURIComponent(id))
    .then(function (rows) {
      var list = rows.filter(function (r) { return r.strChannel; }).map(function (r) {
        return { channel: r.strChannel, country: r.strCountry || "International" };
      });
      tvCache[id] = list;
      return list;
    });
}

function fetchSofaTv(fx, day) {
  var q = "date=" + day + "&home=" + encodeURIComponent(fx.home) +
    "&away=" + encodeURIComponent(fx.away);
  return fetch("/api/sofatv?" + q, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("sofa " + r.status); return r.json(); })
    .then(function (data) {
      return ((data && data.tvevent) || []).filter(function (r) { return r.strChannel; })
        .map(function (r) { return { channel: r.strChannel, country: r.strCountry || "International" }; });
    })
    .catch(function () { return []; });
}

export function fetchFotMobDay(day) {
  return fetch("/api/fmtv?date=" + day, { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("fmtv " + r.status); return r.json(); })
    .then(function (d) { return (d && d.matches) || []; })
    .catch(function () { return []; });
}

export function teamMatch(a, b) {
  a = normName(a); b = normName(b);
  if (!a || !b) return false;
  return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
}

// Merge two listing arrays, de-duplicating by country + channel.
export function mergeTv(a, b) {
  var out = (a || []).slice();
  var seen = {};
  out.forEach(function (t) { seen[(t.country || "") + "|" + t.channel] = true; });
  (b || []).forEach(function (t) {
    var k = (t.country || "") + "|" + t.channel;
    if (!seen[k]) { seen[k] = true; out.push(t); }
  });
  return out;
}

// Resolve real listings for one fixture by combining every source. Cached via
// fx._tvLoaded. `day` is needed only for the (off-by-default) SofaScore call.
export function ensureEventTv(fx, day) {
  if (fx._tvLoaded) return Promise.resolve(fx.tv || []);
  var dayList = (fx.tv || []).slice();
  var primary = (!dayList.length && /^\d+$/.test(String(fx.id)))
    ? fetchEventTv(fx.id) : Promise.resolve([]);
  var sofa = USE_SOFASCORE ? fetchSofaTv(fx, day) : Promise.resolve([]);
  return Promise.all([primary, sofa]).then(function (res) {
    fx.tv = mergeTv(mergeTv(dayList, res[0]), res[1]);
    fx._tvLoaded = true;
    loadedTv[fx.id] = fx.tv;
    return fx.tv || [];
  });
}

export var detailsCache = {};
function fetchMatchDetails(id) {
  if (detailsCache[id]) return Promise.resolve(detailsCache[id]);
  return fetch("/api/matchdetails?id=" + encodeURIComponent(id),
      { headers: { Accept: "application/json" } })
    .then(function (r) { if (!r.ok) throw new Error("md " + r.status); return r.json(); })
    .then(function (d) { var det = (d && d.ok && d.details) || null; detailsCache[id] = det; return det; })
    .catch(function () { return null; });
}

export function ensureDetails(fx) {
  if (fx._detailsLoaded) return Promise.resolve(fx._details || null);
  if (!fx.fmid) { fx._detailsLoaded = true; return Promise.resolve(null); }
  return fetchMatchDetails(fx.fmid).then(function (det) {
    fx._details = det;
    fx._detailsLoaded = true;
    return det;
  }).catch(function () {
    fx._details = null;
    fx._detailsLoaded = true;
    return null;
  });
}

export function loadHighlights() {
  return fetch("/api/highlights", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var map = {};
      ((d && d.highlights) || []).forEach(function (h) {
        if (h && h.fmid) map[String(h.fmid)] = h;
      });
      return map;
    })
    .catch(function () { return {}; });
}
