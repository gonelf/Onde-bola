/*
 * /api/matchdetails — per-match FotMob detail (free, unofficial).
 *
 * FotMob exposes `GET /api/data/matchDetails?matchId=ID` (older path:
 * /api/matchDetails), a large object describing one match. We don't proxy it
 * raw — it's big and its shape shifts — so we extract a small, stable subset the
 * detail modal can render: venue, referee, attendance, round, recent form,
 * head-to-head, a goal/card/sub timeline, key stats and the man of the match.
 *
 * Unofficial: every field is parsed defensively and any failure degrades to an
 * empty value rather than throwing, so a shape change never breaks the page.
 * Disable the whole source with FOTMOB_DISABLED=1.
 *
 * Query: ?id=FOTMOB_MATCH_ID [&debug=1]
 * Returns: { ok, details: { venue, referee, attendance, round, motm,
 *            form:{home,away}, h2h:{home,draw,away}, events:[...], stats:[...] } }
 *
 * Env: FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

// --- small helpers -------------------------------------------------------
const str = (x) => (x == null ? "" : String(x)).trim();
// FotMob fields are sometimes a plain value, sometimes { text } / { name } /
// { value }. Pull a printable string out of any of those shapes.
const textOf = (x) => {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x).trim();
  return str(x.text || x.name || x.value || x.title || x.long || x.short);
};
// Run an extractor but never let one bad shape sink the whole response.
const safe = (fn, fallback) => { try { const v = fn(); return v == null ? fallback : v; } catch (e) { return fallback; } };

function pickMinute(ev) {
  var m = ev.timeStr || ev.time || ev.min || ev.minute;
  if (m == null) return "";
  var s = String(m).replace(/'$/, "");
  if (ev.overloadTime || ev.addedTime) s += "+" + (ev.overloadTime || ev.addedTime);
  return s ? s + "'" : "";
}

// FotMob's match-facts events are a flat, mixed list (goals, cards, subs,
// halves, VAR…). Keep only the three kinds worth a timeline and normalize them.
function eventsFrom(matchFacts) {
  var raw = (matchFacts && matchFacts.events && matchFacts.events.events) ||
    (matchFacts && matchFacts.events) || [];
  if (!Array.isArray(raw)) return [];
  var out = [];
  raw.forEach(function (ev) {
    if (!ev || typeof ev !== "object") return;
    var side = ev.isHome === true ? "home" : ev.isHome === false ? "away" : "";
    var type = str(ev.type).toLowerCase();
    var min = pickMinute(ev);
    if (type === "goal" || type === "owngoal" || ev.isOwnGoal != null) {
      var kind = (ev.isOwnGoal || type === "owngoal") ? "owngoal"
        : (ev.goalDescription === "penalty" || /penalty/i.test(textOf(ev.type) + str(ev.goalDescription))) ? "pengoal"
        : "goal";
      out.push({ side: side, min: min, kind: kind,
        player: textOf(ev.player || ev.nameStr || ev.fullName),
        note: textOf(ev.assistStr || ev.assist) });
    } else if (type === "card") {
      var card = str(ev.card || ev.cardType).toLowerCase();
      out.push({ side: side, min: min, kind: /red/.test(card) ? "red" : "yellow",
        player: textOf(ev.player || ev.nameStr) });
    } else if (type === "substitution" || type === "sub") {
      var swap = ev.swap || ev.players || [];
      var inName = textOf(ev.playerIn || (Array.isArray(swap) && swap[0]));
      var outName = textOf(ev.playerOut || (Array.isArray(swap) && swap[1]));
      if (inName || outName) {
        out.push({ side: side, min: min, kind: "sub", player: inName, note: outName });
      }
    }
  });
  return out.slice(0, 40);
}

// teamForm is [homeLast5, awayLast5]; each item carries a W/D/L somewhere.
function formLetters(list) {
  if (!Array.isArray(list)) return [];
  return list.map(function (it) {
    var r = str(it && (it.resultString || it.result || it.tooltipText)).toUpperCase().charAt(0);
    return (r === "W" || r === "D" || r === "L") ? r : "";
  }).filter(Boolean).slice(0, 5);
}

// Map FotMob's stat title to a stable key the client can localize; "" = skip.
function statKey(title) {
  var s = str(title).toLowerCase();
  if (/possession/.test(s)) return "possession";
  if (/expected goals|xg/.test(s)) return "xg";
  if (/shots on target/.test(s)) return "sot";
  if (/total shots|^shots$|\bshots\b/.test(s)) return "shots";
  if (/corner/.test(s)) return "corners";
  if (/foul/.test(s)) return "fouls";
  return "";
}

function statsFrom(stats) {
  // Newer: stats.Periods.All.stats = [ { stats:[ {title, stats:[h,a]} ] } ].
  var groups = safe(function () { return stats.Periods.All.stats; }, null) ||
    safe(function () { return stats.stats; }, null) || [];
  var rows = [];
  var seen = {};
  (Array.isArray(groups) ? groups : []).forEach(function (g) {
    var items = (g && g.stats) || (Array.isArray(g) ? g : []);
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it) return;
      var key = statKey(it.title || it.key);
      if (!key || seen[key]) return;
      var pair = it.stats || it.value || [];
      if (!Array.isArray(pair) || pair.length < 2) return;
      seen[key] = true;
      rows.push({ key: key, home: str(pair[0]), away: str(pair[1]) });
    });
  });
  return rows;
}

function normalize(data) {
  var general = data.general || {};
  var content = data.content || {};
  var matchFacts = content.matchFacts || {};
  var info = matchFacts.infoBox || matchFacts.info || {};

  var stadium = info.Stadium || info.Venue || info.Stadion;
  var venue = safe(function () {
    if (!stadium) return "";
    if (typeof stadium === "string") return stadium;
    var name = str(stadium.name || stadium.text || stadium.stadium);
    var city = str(stadium.city);
    return name && city ? name + ", " + city : (name || city);
  }, "");

  var attendance = safe(function () {
    var a = textOf(info.Attendance);
    var n = Number(a.replace(/[^\d]/g, ""));
    return n ? n.toLocaleString("en-US") : a;
  }, "");

  var motm = safe(function () {
    var p = matchFacts.playerOfTheMatch || content.playerOfTheMatch;
    if (!p || typeof p !== "object" || !Object.keys(p).length) return null;
    // FotMob's player name is sometimes a string, sometimes { fullName }.
    var nm = p.name;
    var name = (nm && typeof nm === "object") ? str(nm.fullName || nm.name || nm.text)
      : str(nm || p.fullName);
    var rating = str((p.rating && (p.rating.num || p.rating.value)) || p.rating || "");
    return name ? { name: name, rating: rating } : null;
  }, null);

  var h2h = safe(function () {
    var hh = content.h2h;
    if (!hh) return null;
    // Preferred: an explicit [homeWins, draws, awayWins] summary.
    var sum = hh.summary;
    if (Array.isArray(sum) && sum.length >= 3) {
      return { home: Number(sum[0]) || 0, draw: Number(sum[1]) || 0, away: Number(sum[2]) || 0 };
    }
    // Fallback: derive the tally from the list of past meetings if present.
    if (Array.isArray(hh.matches) && hh.matches.length) {
      var h = 0, d = 0, a = 0;
      hh.matches.forEach(function (m) {
        var r = str(m && (m.result || m.winner)).toLowerCase();
        if (/home/.test(r)) h++; else if (/away/.test(r)) a++; else if (/draw/.test(r)) d++;
      });
      if (h || d || a) return { home: h, draw: d, away: a };
    }
    return null;
  }, null);

  var form = safe(function () {
    var tf = matchFacts.teamForm || content.teamForm;
    if (!Array.isArray(tf) || tf.length < 2) return null;
    var home = formLetters(tf[0]), away = formLetters(tf[1]);
    return (home.length || away.length) ? { home: home, away: away } : null;
  }, null);

  // FotMob sometimes carries an official highlights clip (often a YouTube or
  // social link). Surface its URL so the client can link straight to it.
  var highlights = safe(function () {
    var h = matchFacts.highlights || content.highlights ||
      (matchFacts.matchInfo && matchFacts.matchInfo.highlights);
    var url = str(h && (h.url || h.source || h.videoUrl || h.link));
    if (!url && typeof h === "string") url = str(h);
    return /^https?:\/\//.test(url) ? { url: url, source: str(h && (h.source || h.provider)) } : null;
  }, null);

  return {
    venue: venue || "",
    referee: safe(function () { return textOf(info.Referee || info.Referees); }, ""),
    attendance: attendance || "",
    round: safe(function () { return str(general.matchRound || general.leagueRoundName); }, ""),
    motm: motm,
    form: form,
    h2h: h2h,
    highlights: highlights,
    events: safe(function () { return eventsFrom(matchFacts); }, []),
    stats: safe(function () { return statsFrom(content.stats || {}); }, []),
  };
}

function isFinished(data) {
  return safe(function () {
    return !!(data.header && data.header.status && data.header.status.finished) ||
      !!(data.general && data.general.finished);
  }, false);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");

  if (DISABLED) { res.status(200).json({ ok: false, disabled: true }); return; }

  const id = str((req.query || {}).id);
  if (!id || !/^\d+$/.test(id)) {
    res.status(400).json({ error: "Pass ?id=FOTMOB_MATCH_ID" });
    return;
  }
  const debug = ((req.query || {}).debug === "1" || (req.query || {}).debug === "true");
  const cacheKey = `md:${id}`;

  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.status(200).json(JSON.parse(cached));
      return;
    }
  }

  let data = await getJson(`${BASE}/data/matchDetails?matchId=${id}`);
  if (!data || (!data.content && !data.general)) {
    data = await getJson(`${BASE}/matchDetails?matchId=${id}`);
  }
  if (!data || (!data.content && !data.general)) {
    res.setHeader("X-Cache", "MISS");
    res.status(200).json({ ok: false });
    return;
  }

  const details = normalize(data);
  // If FotMob's live payload didn't carry a highlights clip yet, fall back to one
  // the cron sweep (/api/cron-highlights) may already have collected and stored.
  if (!details.highlights) {
    const rec = await kv(["GET", `hl:${id}`]);
    const hl = safe(function () { return JSON.parse(rec); }, null);
    if (hl && /^https?:\/\//.test(str(hl.url))) {
      details.highlights = { url: hl.url, source: str(hl.source) };
    }
  }
  // In debug mode, expose the upstream structure around h2h / player-of-the-match
  // so we can see where FotMob actually puts them without dumping the whole blob.
  const shape = debug ? safe(function () {
    const content = data.content || {};
    const mf = content.matchFacts || {};
    const keysOf = function (o) { return o && typeof o === "object" ? Object.keys(o) : null; };
    return {
      top: keysOf(data),
      content: keysOf(content),
      matchFacts: keysOf(mf),
      infoBox: keysOf(mf.infoBox || mf.info),
      h2h_keys: keysOf(content.h2h),
      h2h_sample: JSON.stringify(content.h2h || null).slice(0, 600),
      motm_candidates: JSON.stringify({
        mfPotm: mf.playerOfTheMatch || null,
        contentPotm: content.playerOfTheMatch || null,
        topPlayers: mf.topPlayers || content.topPlayers || null,
      }).slice(0, 600),
    };
  }, null) : null;
  const payload = debug ? { ok: true, details, _shape: shape } : { ok: true, details };

  if (!debug) {
    // Finished matches are immutable — cache them for a day; live/upcoming
    // change, so keep those short.
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", isFinished(data) ? "86400" : "120"]);
  }

  res.setHeader("X-Cache", debug ? "BYPASS" : "MISS");
  res.status(200).json(payload);
};
