/*
 * lib/cardinfo — minimal "share card" data for one match, by FotMob id.
 *
 * Lets the share page (/g) and the preview image (/og) rebuild a game's display
 * (teams, crests, competition, score/kickoff, date) from just its match id, so
 * shared links can be short (/g/<id>) instead of carrying every field in the
 * query string. The match id is resolved against FotMob's matchDetails feed and
 * the small result is cached in Vercel KV (`card:<id>`) — permanently once the
 * game is finished, briefly while it's live/upcoming.
 *
 * Returns: { ok, card: { fmid, home, away, homeBadge, awayBadge, comp,
 *            leagueBadge, score, status, date, isoDate } }
 *
 * Env: FOTMOB_DISABLED=1, KV_REST_API_URL / KV_REST_API_TOKEN (optional cache).
 */

import { kv } from "./kv";

const DISABLED = process.env.FOTMOB_DISABLED === "1";
const BASE = "https://www.fotmob.com/api";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TEAM_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
const LEAGUE_LOGO = (id) => `https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`;

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

// Pull the share-card fields out of FotMob's matchDetails blob. Everything is
// read defensively: a missing field just yields "" rather than throwing.
function extractCard(fmid, data) {
  const general = data.general || {};
  const header = data.header || {};
  const teams = Array.isArray(header.teams) ? header.teams : [];
  const status = header.status || {};

  const homeT = teams[0] || general.homeTeam || {};
  const awayT = teams[1] || general.awayTeam || {};
  const home = str(homeT.name) || str(general.homeTeam && general.homeTeam.name) || "Home";
  const away = str(awayT.name) || str(general.awayTeam && general.awayTeam.name) || "Away";
  const homeId = homeT.id != null ? homeT.id : general.homeTeam && general.homeTeam.id;
  const awayId = awayT.id != null ? awayT.id : general.awayTeam && general.awayTeam.id;

  const homeBadge = str(homeT.imageUrl) || (homeId != null ? TEAM_LOGO(homeId) : "");
  const awayBadge = str(awayT.imageUrl) || (awayId != null ? TEAM_LOGO(awayId) : "");

  const comp = str(general.leagueName || general.parentLeagueName);
  const leagueId = general.leagueId != null ? general.leagueId : general.parentLeagueId;
  const leagueBadge = leagueId != null ? LEAGUE_LOGO(leagueId) : "";

  const finished = !!status.finished;
  const started = !!status.started;
  const scoreStr = str(status.scoreStr).replace(/\s*-\s*/, " - ");
  const reason = str(status.reason && (status.reason.short || status.reason.long));
  const live = str(status.liveTime && (status.liveTime.short || status.liveTime.long));
  const kickoffUTC = str(status.utcTime || general.matchTimeUTC);

  const d = kickoffUTC ? new Date(kickoffUTC) : null;
  const valid = d && !isNaN(d.getTime());
  const fmt = (opts) => (valid ? new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "Europe/Lisbon" }, opts)).format(d) : "");
  const timeLabel = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  const date = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const isoDate = valid
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
    : "";

  const score = (started || finished) && scoreStr ? scoreStr : "";
  const statusLabel = finished ? reason || "FT" : started ? live || "LIVE" : timeLabel;

  return {
    fmid: String(fmid),
    home, away, homeBadge, awayBadge,
    comp, leagueBadge,
    score, status: statusLabel,
    date, isoDate,
    // Raw ISO kickoff (UTC) — lets the share page emit SportsEvent.startDate.
    kickoff: kickoffUTC || "",
    finished,
  };
}

// Resolve + cache one card. Imported directly by the share page and OG image.
export async function getCard(id) {
  const fmid = String(id || "").replace(/^fm:/, "").trim();
  if (!fmid || !/^\d+$/.test(fmid)) return { ok: false, error: "bad id" };
  if (DISABLED) return { ok: false, disabled: true };

  const cacheKey = `card:${fmid}`;
  const cached = await kv(["GET", cacheKey]);
  if (cached) {
    try { return Object.assign(JSON.parse(cached), { _cache: "HIT" }); } catch (e) {}
  }

  let data = await getJson(`${BASE}/data/matchDetails?matchId=${fmid}`);
  if (!data || (!data.header && !data.general)) {
    data = await getJson(`${BASE}/matchDetails?matchId=${fmid}`);
  }
  if (!data || (!data.header && !data.general)) return { ok: false };

  const card = extractCard(fmid, data);
  const payload = { ok: true, card };
  // Finished games are immutable (cache long); live/upcoming change (cache short).
  await kv(["SET", cacheKey, JSON.stringify(payload), "EX", card.finished ? "604800" : "120"]);
  return payload;
}
