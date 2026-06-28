/*
 * /api/standings — a competition's league table / classification, plus its next
 * round of fixtures, from FotMob (free, unofficial).
 *
 * FotMob exposes `GET /api/leagues?id=<leagueId>` (older path: /api/data/leagues),
 * whose `table` block carries the standings and whose `matches` block carries the
 * full fixture list. A normal league has one table (data.table.all); a group /
 * multi-stage tournament has several (data.tables[]). We don't proxy the raw
 * object — it's big and its shape shifts — so we extract a small, stable subset:
 *   • the classification: rank, club, played, W/D/L, goals for/against, goal diff,
 *     points (plus the qualification colour FotMob tags promotion/relegation rows
 *     with); and
 *   • the next round: the upcoming matches of the earliest unplayed round, so the
 *     match modal can show "what's next" in this competition.
 * The `leagueId` is the FotMob id every fixture already carries.
 *
 * Caching mirrors the other FotMob routes: a short TTL so tables/rounds refresh
 * through a matchday, plus a permanent backup served if a later upstream fetch
 * fails or is blocked. Cups / internationals with no table still return their
 * upcoming matches; a competition with neither degrades to { ok:false } and never
 * throws. Disable the source with FOTMOB_DISABLED=1.
 *
 * Query: ?league=<fotmobLeagueId> [&debug=1]
 * Returns: { ok, leagueId, name,
 *   groups: [ { name, rows: [ { rank, id, name, shortName, played, won, drawn,
 *     lost, gf, ga, gd, points, qual } ] } ],
 *   next: { round, matches: [ { id, round, home, away, homeId, awayId, kickoff,
 *     finished, started, homeScore, awayScore } ] } }
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
  const t = setTimeout(() => ctrl.abort(), ms || 7000);
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

const num = (x) => {
  const n = typeof x === "number" ? x : parseInt(String(x == null ? "" : x).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// FotMob's utcTime is usually ISO, but be defensive about epoch ms / .NET dates.
function isoTime(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 0 ? new Date(v).toISOString() : null;
  const m = String(v).match(/\/Date\((-?\d+)\)\//);
  if (m) { const n = Number(m[1]); return n > 0 ? new Date(n).toISOString() : null; }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString();
  const n = Number(v);
  return !isNaN(n) && n > 0 ? new Date(n).toISOString() : null;
}

// --- classification ------------------------------------------------------

// FotMob packs goals as "GF-GA" (e.g. "86-41"); split it, tolerating odd dashes.
function goals(row) {
  const m = String(row.scoresStr || row.scoreStr || "").match(/(-?\d+)\s*[-–:]\s*(-?\d+)/);
  if (m) return [num(m[1]), num(m[2])];
  return [num(row.goalsFor != null ? row.goalsFor : row.scoredGoals), num(row.goalsAgainst != null ? row.goalsAgainst : row.concededGoals)];
}

function normRow(row, i) {
  if (!row || typeof row !== "object") return null;
  const name = String(row.name || row.shortName || "").trim();
  if (!name) return null;
  const [gf, ga] = goals(row);
  const played = num(row.played != null ? row.played : row.pld);
  const won = num(row.wins != null ? row.wins : row.won);
  const drawn = num(row.draws != null ? row.draws : row.drawn);
  const lost = num(row.losses != null ? row.losses : (row.lost != null ? row.lost : row.loss));
  const gd = row.goalConDiff != null ? num(row.goalConDiff) : gf - ga;
  return {
    rank: num(row.idx != null ? row.idx : (row.rank != null ? row.rank : i + 1)),
    id: row.id != null ? String(row.id) : "",
    name,
    shortName: String(row.shortName || name).trim(),
    played, won, drawn, lost, gf, ga, gd,
    points: num(row.pts != null ? row.pts : row.points),
    qual: String(row.qualColor || row.qualCol || "").trim() || null,
  };
}

const rowsOf = (tbl) => (tbl && Array.isArray(tbl.all) ? tbl.all : Array.isArray(tbl) ? tbl : []);

// FotMob roots the standings as data.table — usually an array of { data: {...} }.
// Within each, a single-table league exposes data.table.all; a grouped/multi-
// stage one exposes data.tables[] (each its own named table). Pull every table
// out as a { name, rows } group, defensively across those shapes.
function groupsOf(data) {
  let t = data && data.table;
  const roots = Array.isArray(t)
    ? t.map((e) => (e && e.data ? e.data : e)).filter(Boolean)
    : t && t.data ? [t.data] : t ? [t] : [];
  const groups = [];
  roots.forEach((d) => {
    if (!d) return;
    if (Array.isArray(d.tables) && d.tables.length) {
      d.tables.forEach((g) => {
        const inner = g && (g.data || g);
        const tbl = inner && (inner.table || inner);
        const rows = rowsOf(tbl).map(normRow).filter(Boolean);
        if (rows.length) groups.push({ name: String((g && (g.leagueName || g.name || g.title)) || "").trim(), rows });
      });
    } else {
      const rows = rowsOf(d.table || d).map(normRow).filter(Boolean);
      if (rows.length) groups.push({ name: String(d.leagueName || d.name || "").trim(), rows });
    }
  });
  return groups;
}

// --- next round of fixtures ----------------------------------------------

function matchListOf(data) {
  const m = data && data.matches;
  if (m && Array.isArray(m.allMatches)) return m.allMatches;
  if (m && Array.isArray(m.matches)) return m.matches;
  if (Array.isArray(m)) return m;
  const ov = data && data.overview;
  if (ov && Array.isArray(ov.leagueOverviewMatches)) return ov.leagueOverviewMatches;
  return [];
}

function normMatch(m) {
  if (!m || typeof m !== "object") return null;
  const home = m.home || {}, away = m.away || {}, status = m.status || {};
  const hn = String(home.name || home.shortName || "").trim();
  const an = String(away.name || away.shortName || "").trim();
  if (!hn || !an) return null;
  const finished = !!status.finished;
  const started = !!(status.started && !finished);
  let hs = typeof home.score === "number" ? home.score : null;
  let as = typeof away.score === "number" ? away.score : null;
  if ((hs == null || as == null) && typeof status.scoreStr === "string") {
    const mm = status.scoreStr.match(/(\d+)\s*-\s*(\d+)/);
    if (mm) { hs = num(mm[1]); as = num(mm[2]); }
  }
  const round = m.round != null ? num(m.round) : (m.roundName ? String(m.roundName) : null);
  return {
    id: m.id != null ? String(m.id) : "",
    round,
    home: hn, away: an,
    homeId: home.id != null ? String(home.id) : "",
    awayId: away.id != null ? String(away.id) : "",
    kickoff: isoTime(status.utcTime) || isoTime(m.timeTS) || null,
    finished, started,
    homeScore: hs, awayScore: as,
  };
}

// The next round = the upcoming (not-finished) matches sharing the round of the
// earliest one still to play. Falls back to the next handful of fixtures when a
// competition carries no round numbers (cups, internationals).
function nextRoundOf(data) {
  const upcoming = matchListOf(data).map(normMatch).filter(Boolean)
    .filter((m) => !m.finished)
    .sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0));
  if (!upcoming.length) return { round: null, matches: [] };
  const r = upcoming[0].round;
  const matches = (r != null ? upcoming.filter((m) => m.round === r) : upcoming).slice(0, 16);
  return { round: r, matches };
}

export async function GET(request) {
  if (DISABLED) {
    return Response.json({ ok: false, disabled: true }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }

  const { searchParams } = new URL(request.url);
  const league = (searchParams.get("league") || "").trim();
  if (!/^\d+$/.test(league)) {
    return Response.json({ ok: false, error: "Pass ?league=<fotmobLeagueId>" }, { status: 400 });
  }
  const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

  const cacheKey = `st:tbl:${league}`;
  const bakKey = `st:bak:${league}`;
  const swr = "public, s-maxage=600, stale-while-revalidate=3600";

  if (!debug) {
    const cached = await kv(["GET", cacheKey]);
    if (cached) {
      return Response.json(JSON.parse(cached), { headers: { "X-Cache": "HIT", "Cache-Control": swr } });
    }
  }

  // The default leagues payload carries both `table` and `matches`. FotMob now
  // serves it under /api; fall back to the older /api/data path.
  let via = "leagues";
  let data = await getJson(`${BASE}/leagues?id=${league}`);
  if (!groupsOf(data).length && !nextRoundOf(data).matches.length) {
    data = await getJson(`${BASE}/data/leagues?id=${league}`);
    via = "data/leagues";
  }

  const groups = data ? groupsOf(data) : [];
  const next = data ? nextRoundOf(data) : { round: null, matches: [] };
  const name = String((data && data.details && (data.details.name || data.details.shortName)) || "").trim();

  // On empty/blocked upstream, serve the permanent backup so a competition seen
  // once keeps rendering even when FotMob is down.
  if (!groups.length && !next.matches.length) {
    const bak = await kv(["GET", bakKey]);
    if (bak) {
      const payload = JSON.parse(bak);
      return Response.json(
        debug ? Object.assign({}, payload, { _via: via, _backup: true }) : payload,
        { headers: { "X-Cache": "BACKUP", "Cache-Control": swr } }
      );
    }
    const empty = { ok: false, leagueId: league, groups: [], next: { round: null, matches: [] } };
    return Response.json(debug ? Object.assign({}, empty, { _via: via, _upstream: !!data }) : empty,
      { headers: { "X-Cache": "EMPTY", "Cache-Control": swr } });
  }

  const payload = { ok: groups.length > 0, leagueId: league, name, groups, next };
  if (debug) payload._debug = { via, upstream: !!data, groups: groups.length, rows: groups.reduce((n, g) => n + g.rows.length, 0), next: next.matches.length };

  if (!debug) {
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", "1800"]); // 30 min: refresh through a matchday
    await kv(["SET", bakKey, JSON.stringify(payload)]);                 // permanent backup
  }

  return Response.json(payload, { headers: { "X-Cache": "MISS", "Cache-Control": swr } });
}
