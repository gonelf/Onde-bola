/*
 * /api/standings — a competition's league table / classification from FotMob
 * (free, unofficial).
 *
 * FotMob exposes `GET /api/leagues?id=<leagueId>&tab=table` (older path:
 * /api/data/leagues), whose `table` block carries the standings. A normal league
 * has one table (data.table.all); a group/multi-stage tournament has several
 * (data.tables[]). We don't proxy the raw object — it's big and its shape shifts
 * — so we extract a small, stable subset the games browser renders inline under
 * each competition: rank, club, played, W/D/L, goals for/against, goal diff,
 * points (plus the qualification colour FotMob tags promotion/relegation rows
 * with). The `leagueId` is the FotMob id every fixture already carries.
 *
 * Caching mirrors the other FotMob routes: a short TTL so tables refresh through
 * a matchday, plus a permanent backup served if a later upstream fetch fails or
 * is blocked, so any competition seen once keeps rendering even when FotMob is
 * down. Cups / internationals with no table degrade to { ok: false } and never
 * throw. Disable the source with FOTMOB_DISABLED=1.
 *
 * Query: ?league=<fotmobLeagueId> [&debug=1]
 * Returns: { ok, leagueId, name, groups: [ { name, rows: [ { rank, id, name,
 *   shortName, played, won, drawn, lost, gf, ga, gd, points, qual } ] } ] }
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

const num = (x) => {
  const n = typeof x === "number" ? x : parseInt(String(x == null ? "" : x).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// FotMob packs goals as "GF-GA" (e.g. "86-41"); split it, tolerating odd dashes.
function goals(row) {
  const m = String(row.scoresStr || row.scoreStr || "").match(/(-?\d+)\s*[-–:]\s*(-?\d+)/);
  if (m) return [num(m[1]), num(m[2])];
  return [num(row.goalsFor != null ? row.goalsFor : row.scoredGoals), num(row.goalsAgainst != null ? row.goalsAgainst : row.concededGoals)];
}

// Normalize one FotMob table row to the small shape the client renders.
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

  // FotMob now serves leagues under /api; fall back to the older /api/data path.
  let via = "leagues";
  let data = await getJson(`${BASE}/leagues?id=${league}&tab=table`);
  if (!groupsOf(data).length) {
    data = await getJson(`${BASE}/data/leagues?id=${league}&tab=table`);
    via = "data/leagues";
  }

  const groups = data ? groupsOf(data) : [];
  const name = String((data && data.details && (data.details.name || data.details.shortName)) || "").trim();

  // On empty/blocked upstream, serve the permanent backup so a competition seen
  // once keeps rendering even when FotMob is down.
  if (!groups.length) {
    const bak = await kv(["GET", bakKey]);
    if (bak) {
      const payload = JSON.parse(bak);
      return Response.json(
        debug ? Object.assign({}, payload, { _via: via, _backup: true }) : payload,
        { headers: { "X-Cache": "BACKUP", "Cache-Control": swr } }
      );
    }
    const empty = { ok: false, leagueId: league, groups: [] };
    return Response.json(debug ? Object.assign({}, empty, { _via: via, _upstream: !!data }) : empty,
      { headers: { "X-Cache": "EMPTY", "Cache-Control": swr } });
  }

  const payload = { ok: true, leagueId: league, name, groups };
  if (debug) payload._debug = { via, upstream: !!data, groups: groups.length, rows: groups.reduce((n, g) => n + g.rows.length, 0) };

  if (!debug) {
    await kv(["SET", cacheKey, JSON.stringify(payload), "EX", "1800"]); // 30 min: refresh through a matchday
    await kv(["SET", bakKey, JSON.stringify(payload)]);                 // permanent backup
  }

  return Response.json(payload, { headers: { "X-Cache": "MISS", "Cache-Control": swr } });
}
