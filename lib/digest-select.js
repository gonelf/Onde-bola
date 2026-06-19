/*
 * lib/digest-select — the shared "day's top games" selection used by every
 * digest surface: the /today page, the /image tool + canvas, the /og/today
 * social card and the /text post. Centralizing it keeps them in agreement on
 * *which* games show and in *what order*.
 *
 * The rule: keep only well-known competitions (the ranked league ids below, plus
 * a name match for the marquee leagues/cups/internationals), then rank by
 * competition prominence, live-ness, and kickoff. Everything else — lower
 * divisions, regional leagues, minor friendlies — is excluded, so the digest
 * stays a "big games" list rather than whatever happens to be on.
 */

// FotMob league ids, in rough prominence order (top-5 leagues, UEFA club & national
// cups, Portugal/NL/EFL, MLS, Brasileirão, the big internationals).
export const RANK_IDS = [77, 50, 44, 42, 73, 10216, 47, 87, 54, 55, 53, 61, 57, 48, 9134, 130, 268, 76, 45];
const RANK_POS = {};
RANK_IDS.forEach((id, i) => { RANK_POS[id] = i; });

export function leagueRank(f) {
  const p = RANK_POS[f && f.leagueId];
  return p == null ? 999 : p;
}

// 0 = live (in play), 1 = upcoming, 2 = finished.
export function phase(f) {
  const s = (f.status || "").toUpperCase();
  if (s && s !== "FT") return 0;
  if (!s) return 1;
  return 2;
}

// Name match for well-known competitions whose FotMob league id isn't in RANK_IDS
// (so a marquee competition still qualifies by name). Mirrors the NOTABLE list the
// SEO pages use to decide what's worth indexing.
export const NOTABLE_RE = new RegExp([
  "premier league", "la ?liga", "serie a", "bundesliga", "ligue 1",
  "primeira liga", "liga portugal", "ta[cç]a de portugal",
  "champions league", "europa league", "conference league", "super cup",
  "world cup", "euro", "nations league", "copa am[eé]rica", "copa del rey",
  "fa cup", "efl cup", "carabao", "coppa italia", "dfb.?pokal", "coupe de france",
  "libertadores", "sul.?americana", "brasileir[aã]o", "copa do brasil",
  "eredivisie", "mls", "saudi pro", "primera",
].join("|"), "i");

// A game in a well-known competition (by ranked league id or by competition name).
export function isKnownCompetition(f) {
  if (RANK_POS[f && f.leagueId] != null) return true;
  return NOTABLE_RE.test((f && f.competition) || "");
}

export function rankSort(a, b) {
  const lr = leagueRank(a) - leagueRank(b);
  if (lr) return lr;
  const ph = phase(a) - phase(b);
  if (ph) return ph;
  return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
}

// The day's well-known games, ranked. Pass n to cap the list (omit for all).
export function selectTop(fixtures, n) {
  const list = (fixtures || []).filter(isKnownCompetition);
  list.sort(rankSort);
  return typeof n === "number" ? list.slice(0, n) : list;
}
