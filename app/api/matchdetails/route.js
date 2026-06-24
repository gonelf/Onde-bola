/*
 * /api/matchdetails — per-match FotMob detail (free, unofficial).
 *
 * FotMob exposes `GET /api/data/matchDetails?matchId=ID` (older path:
 * /api/matchDetails), a large object describing one match. We don't proxy it
 * raw — it's big and its shape shifts — so we extract a small, stable subset the
 * detail modal / share page can render: venue, referee, attendance, round,
 * recent form, head-to-head (tally + the list of past meetings), the probable /
 * confirmed starting line-ups, a goal/card/sub timeline, key stats and the man
 * of the match.
 *
 * Unofficial: every field is parsed defensively and any failure degrades to an
 * empty value rather than throwing, so a shape change never breaks the page.
 * Disable the whole source with FOTMOB_DISABLED=1.
 *
 * Query: ?id=FOTMOB_MATCH_ID [&debug=1]
 * Returns: { ok, details: { venue, referee, attendance, round, motm,
 *            form:{home,away}, h2h:{home,draw,away}, h2hMatches:[...],
 *            lineups:{confirmed,home,away}, events:[...], stats:[...] } }
 *
 * Env: FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

import { kv } from "@/lib/kv";

export const dynamic = "force-dynamic";

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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

// Pull the 11-char YouTube video id out of a URL (so the client can embed it).
const youtubeId = (u) => {
  const m = str(u).match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
};

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

// A player's display name — sometimes a plain string, sometimes { fullName }.
function playerName(p) {
  if (!p) return "";
  var n = p.name;
  if (n && typeof n === "object") return str(n.fullName || n.name || n.text);
  return str(n || p.fullName || p.shortName);
}

// The short label shown on the pitch — last name where we can, so a row of
// shirts reads "Messi", "Xavi", "Eto'o" rather than the full legal name.
function shortPlayerName(p, full) {
  var n = p && p.name;
  if (n && typeof n === "object") {
    var ln = str(n.lastName || n.last);
    if (ln) return ln;
  }
  var explicit = str(p && (p.shortName || p.knownName));
  if (explicit) return explicit;
  var parts = str(full).split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : (parts[0] || "");
}

// A player's pitch position label (GK, CB, LW, CM…), kept short.
function positionLabel(p) {
  var s = str(p && (p.positionStringShort || p.positionString || p.position ||
    p.role || p.fieldPosition));
  if (!s) return "";
  // Long forms occasionally come through ("Goalkeeper", "Right Back").
  var map = { goalkeeper: "GK", keeper: "GK", defender: "DF", midfielder: "MF",
    forward: "FW", attacker: "FW" };
  var low = s.toLowerCase();
  if (map[low]) return map[low];
  return s.length <= 4 ? s.toUpperCase() : s.slice(0, 3).toUpperCase();
}

// A player's match rating out of 10 ("7.4"), from any of the shapes FotMob has
// used for it; "" when there's no rating yet (e.g. before/early in a match).
function playerRating(p) {
  var r = p && (p.rating || (p.performance && p.performance.rating) ||
    (p.fantasyStats && p.fantasyStats.rating));
  if (r && typeof r === "object") {
    r = r.num != null ? r.num : (r.value != null ? r.value : r.rating);
  }
  var n = parseFloat(r);
  return isFinite(n) ? n.toFixed(1) : "";
}

// Split the outfield players into formation lines from a "4-3-3"-style string
// (the GK is handled separately). Falls back to a single line when unknown.
function rowsFromFormation(formation, outfield) {
  var counts = str(formation).split(/[-–]/).map(function (n) { return parseInt(n, 10); })
    .filter(function (n) { return n > 0; });
  var total = counts.reduce(function (a, b) { return a + b; }, 0);
  if (!counts.length || total !== outfield.length) return [outfield];
  var rows = [], i = 0;
  counts.forEach(function (c) { rows.push(outfield.slice(i, i + c)); i += c; });
  return rows;
}

// One team's lineup (starting XI). FotMob's shape has shifted between versions,
// so accept both: a team with `players` as rows (array of arrays) or a flat
// list, with the shirt number under any of a few keys. Defensive throughout.
// We keep `starters` (a flat XI) plus `rows` (the formation lines) so the client
// can draw the players in their positions on a pitch.
function lineupSide(team) {
  if (!team || typeof team !== "object") return null;
  var formation = str(team.formation || team.lineupFormation || team.formationUsed);
  var players = team.players || team.starters || team.starting || [];
  var rows = [];
  var flat = [];
  var nested = false;
  var makeP = function (p) {
    if (!p || typeof p !== "object") return null;
    if (p.isCoach || p.role === "coach") return null;
    var name = playerName(p);
    if (!name) return null;
    var num = p.shirt != null ? p.shirt : (p.shirtNumber != null ? p.shirtNumber : p.shirtNo);
    return { num: num == null ? "" : String(num), name: name,
      short: shortPlayerName(p, name), pos: positionLabel(p), rating: playerRating(p) };
  };
  if (Array.isArray(players)) {
    players.forEach(function (row) {
      if (Array.isArray(row)) {
        nested = true;
        var line = row.map(makeP).filter(Boolean);
        if (line.length) rows.push(line);
        line.forEach(function (pl) { flat.push(pl); });
      } else {
        var pl = makeP(row);
        if (pl) flat.push(pl);
      }
    });
  }
  if (!flat.length) return null;
  flat = flat.slice(0, 11);
  // When the shape was flat, rebuild the formation lines ourselves: first player
  // is the keeper, the rest split by the formation string.
  if (!nested || !rows.length) {
    rows = [[flat[0]]].concat(rowsFromFormation(formation, flat.slice(1)));
  }
  var coach = safe(function () {
    var c = team.coach || team.manager || team.coaches;
    if (Array.isArray(c)) c = c[0];
    return str(c && (c.name || c.fullName)) || (typeof c === "string" ? str(c) : "");
  }, "");
  return { name: str(team.teamName || team.name), formation: formation,
    coach: coach, starters: flat, rows: rows };
}

// A #rrggbb (or #rgb) hex from whatever FotMob hands us, else "".
function hex(x) {
  var s = str(x);
  return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s) ? (s[0] === "#" ? s : "#" + s) : "";
}

// FotMob carries each side's kit colour (and a contrasting number colour) so the
// client can draw the right jersey. The block has moved around between versions,
// so probe a few spots and both light/dark variants. Returns { shirt, text } per
// side, or null when nothing usable is found.
function teamColorsFrom(data) {
  var tc = safe(function () { return data.general.teamColors; }, null) ||
    safe(function () { return data.header.teamColors; }, null) ||
    safe(function () { return (data.content || {}).teamColors; }, null);
  if (!tc || typeof tc !== "object") return null;
  var m = tc.darkMode || tc.dark || tc;
  var side = function (shirtKeys, fontKeys) {
    var shirt = "";
    shirtKeys.forEach(function (k) { if (!shirt) shirt = hex(m[k]); });
    var text = "";
    fontKeys.forEach(function (k) { if (!text) text = hex(m[k]); });
    return shirt ? { shirt: shirt, text: text } : null;
  };
  var home = side(["home", "homeColor", "lightHome"], ["fontHome", "homeFont", "fontLightHome"]);
  var away = side(["away", "awayColor", "lightAway"], ["fontAway", "awayFont", "fontLightAway"]);
  return home || away ? { home: home, away: away } : null;
}

// Probable / confirmed starting line-ups for both teams.
function lineupsFrom(content, colors) {
  var lu = content.lineup || content.lineups;
  if (!lu || typeof lu !== "object") return null;
  var confirmed = lu.confirmed === true || lu.isLineupConfirmed === true ||
    /confirm/i.test(str(lu.lineupType || lu.lineupStatus));
  var teams = lu.lineup || lu.teams;
  var home = null, away = null;
  if (Array.isArray(teams) && teams.length >= 2) {
    home = lineupSide(teams[0]); away = lineupSide(teams[1]);
  } else if (lu.homeTeam || lu.awayTeam) {
    home = lineupSide(lu.homeTeam); away = lineupSide(lu.awayTeam);
  }
  if (!home && !away) return null;
  if (colors) {
    if (home && colors.home) home.kit = colors.home;
    if (away && colors.away) away.kit = colors.away;
  }
  return { confirmed: !!confirmed, home: home, away: away };
}

// The list of past meetings (the "last encounters"), most-recent first. Each
// item: date, the two teams, the score and the competition. Shapes vary, so
// every field is read defensively.
function h2hMatchesFrom(content) {
  var hh = content.h2h;
  var arr = hh && (hh.matches || hh.events);
  if (!Array.isArray(arr)) return [];
  var out = [];
  arr.forEach(function (m) {
    if (!m || typeof m !== "object") return;
    var home = textOf(m.home) || str(m.homeTeam && (m.homeTeam.name || m.homeTeam));
    var away = textOf(m.away) || str(m.awayTeam && (m.awayTeam.name || m.awayTeam));
    if (!home || !away) return;
    var score = str(m.status && m.status.scoreStr) || str(m.scoreStr);
    if (!score && m.home && m.away && m.home.score != null && m.away.score != null) {
      score = m.home.score + " - " + m.away.score;
    }
    var iso = str((m.status && m.status.utcTime) || (m.time && (m.time.utcTime || m.time)) ||
      m.matchDate || m.date);
    var d = iso ? new Date(iso) : null;
    var date = d && !isNaN(d.getTime())
      ? new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(d)
      : "";
    var comp = textOf(m.leagueName || m.tournament || m.league);
    out.push({ date: date, home: home, away: away, score: score.replace(/\s*-\s*/, " - "), comp: comp });
  });
  return out.slice(0, 6);
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
    return /^https?:\/\//.test(url)
      ? { url: url, source: str(h && (h.source || h.provider)), youtubeId: youtubeId(url) }
      : null;
  }, null);

  return {
    venue: venue || "",
    referee: safe(function () { return textOf(info.Referee || info.Referees); }, ""),
    attendance: attendance || "",
    round: safe(function () { return str(general.matchRound || general.leagueRoundName); }, ""),
    motm: motm,
    form: form,
    h2h: h2h,
    h2hMatches: safe(function () { return h2hMatchesFrom(content); }, []),
    lineups: safe(function () { return lineupsFrom(content, teamColorsFrom(data)); }, null),
    highlights: highlights,
    events: safe(function () { return eventsFrom(matchFacts); }, []),
    stats: safe(function () { return statsFrom(content.stats || {}); }, []),
  };
}

// Debug-only: walk the whole FotMob match payload for any broadcast/TV data we
// might not be reading (fotmob.com's match page shows a "where to watch" block,
// so the per-match payload may carry PT/Sport TV even when the day-bulk
// tvlistings endpoint omits the match). Reports keys that look TV-related and
// any value mentioning "Sport TV". Bounded so it can't blow up on a big blob.
function scanBroadcast(root) {
  const hits = [];
  const KEY_RE = /tv|broadcast|channel|station|watch|stream|provider/i;
  const seen = new Set();
  const walk = (node, path, depth) => {
    if (hits.length >= 40 || depth > 7 || node == null) return;
    if (typeof node === "string") {
      if (/sport\s*tv/i.test(node)) hits.push({ path, value: node.slice(0, 80) });
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length && i < 60; i++) walk(node[i], path + "[" + i + "]", depth + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      if (KEY_RE.test(k)) {
        hits.push({ path: (path + "." + k).replace(/^\./, ""), keyMatch: true,
          sample: JSON.stringify(node[k]).slice(0, 140) });
      }
      walk(node[k], path + "." + k, depth + 1);
    }
  };
  walk(root, "", 0);
  return hits.slice(0, 40);
}

function isFinished(data) {
  return safe(function () {
    return !!(data.header && data.header.status && data.header.status.finished) ||
      !!(data.general && data.general.finished);
  }, false);
}

export async function GET(request) {
  const swr = "public, s-maxage=120, stale-while-revalidate=600";

  if (DISABLED) {
    return Response.json({ ok: false, disabled: true }, { headers: { "Cache-Control": swr } });
  }

  const { searchParams } = new URL(request.url);
  const id = str(searchParams.get("id"));
  if (!id || !/^\d+$/.test(id)) {
    return Response.json({ error: "Pass ?id=FOTMOB_MATCH_ID" }, {
      status: 400, headers: { "Cache-Control": swr },
    });
  }
  const debug = (searchParams.get("debug") === "1" || searchParams.get("debug") === "true");
  const cacheKey = `md:${id}`;

  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      return Response.json(JSON.parse(cached), {
        headers: { "X-Cache": "HIT", "Cache-Control": swr },
      });
    }
  }

  let data = await getJson(`${BASE}/data/matchDetails?matchId=${id}`);
  if (!data || (!data.content && !data.general)) {
    data = await getJson(`${BASE}/matchDetails?matchId=${id}`);
  }
  if (!data || (!data.content && !data.general)) {
    return Response.json({ ok: false }, { headers: { "X-Cache": "MISS", "Cache-Control": swr } });
  }

  const details = normalize(data);
  // If FotMob's live payload didn't carry a highlights clip yet, fall back to one
  // the cron sweep (/api/cron-highlights) may already have collected and stored.
  if (!details.highlights) {
    const rec = await kv(["GET", `hl:${id}`]);
    const hl = safe(function () { return JSON.parse(rec); }, null);
    const storedId = hl && str(hl.youtubeId).match(/^[A-Za-z0-9_-]{11}$/) ? str(hl.youtubeId) : "";
    if (hl && (/^https?:\/\//.test(str(hl.url)) || storedId)) {
      details.highlights = { url: str(hl.url), source: str(hl.source), youtubeId: storedId };
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
      lineup_keys: keysOf(content.lineup || content.lineups),
      lineup_sample: JSON.stringify(content.lineup || content.lineups || null).slice(0, 800),
      motm_candidates: JSON.stringify({
        mfPotm: mf.playerOfTheMatch || null,
        contentPotm: content.playerOfTheMatch || null,
        topPlayers: mf.topPlayers || content.topPlayers || null,
      }).slice(0, 600),
    };
  }, null) : null;
  const broadcast = debug ? safe(function () { return scanBroadcast(data); }, []) : null;
  const payload = debug ? { ok: true, details, _shape: shape, _broadcast: broadcast } : { ok: true, details };

  if (!debug) {
    // Finished matches are immutable — cache them for a day; live/upcoming
    // change, so keep those short.
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", isFinished(data) ? "86400" : "120"]);
  }

  return Response.json(payload, {
    headers: { "X-Cache": debug ? "BYPASS" : "MISS", "Cache-Control": swr },
  });
}
