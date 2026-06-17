/*
 * Framework-agnostic helpers ported from assets/app.js.
 *
 * These were closures inside the app IIFE that referenced module-globals
 * (`state`, `t()`, `locale()`). Here they are pure functions: anything that
 * needs the active language or request origin takes it as an argument, so the
 * same code runs in a client component and in a server-rendered page.
 */

// ---- Dates --------------------------------------------------------------

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

export function formatClock(date, locale) {
  return date.toLocaleTimeString(locale || [], { hour: "2-digit", minute: "2-digit" });
}

export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// The kickoff day in Europe/Lisbon, so the share URL the client builds matches
// the canonical the server-rendered page emits (which also uses Lisbon time).
export function lisbonYmd(date) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date);
  } catch (e) {
    return ymd(date);
  }
}

// ---- Match status -------------------------------------------------------

export function matchStatus(kickoff) {
  const now = new Date();
  const diffMin = (now - kickoff) / 60000;
  if (diffMin < 0) return { state: "upcoming" };
  if (diffMin <= 115) return { state: "live" };
  return { state: "finished" };
}

// Resolve a match's state/label, preferring the live API status string
// (e.g. "1H", "HT", "FT", "Match Finished", or a minute like "67") and
// falling back to a time-based estimate when the feed gives nothing.
// `t` is the translator from lib/i18n (makeT).
export function statusOf(fx, t) {
  const kickoff = new Date(fx.kickoff);
  const raw = (fx.status || "").trim();
  const s = raw.toUpperCase();

  if (/(FT|AET|PEN|FINISHED|ENDED|MATCH FINISHED|FULL TIME)/.test(s)) {
    return { state: "finished", label: t("ft") };
  }
  if (/^(HT|HALF[\s-]?TIME)$/.test(s)) {
    return { state: "live", label: "HT" };
  }
  const min = s.match(/(\d{1,3})\s*'?\+?\d*\s*$/);
  if (/(1H|2H|ET|LIVE|IN PLAY|PLAYING)/.test(s) || (min && s !== "")) {
    return { state: "live", label: min ? min[1] + "'" : t("live") };
  }
  if (/^(NS|NOT STARTED|SCHEDULED|TBD|PREVIEW)$/.test(s) || raw === "") {
    // Nothing definitive from the feed — estimate from the clock.
    const est = matchStatus(kickoff);
    if (est.state === "live") return { state: "live", label: t("live") };
    if (est.state === "finished") return { state: "finished", label: t("ft") };
    return { state: "upcoming", label: "" };
  }
  // Unknown non-empty status: treat as live with the raw label.
  return { state: "live", label: raw };
}

export function hasScore(fx) {
  return fx.homeScore !== null && fx.homeScore !== undefined &&
    fx.awayScore !== null && fx.awayScore !== undefined;
}

// ---- Text / slugs -------------------------------------------------------

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Accent-folded, a-z0-9 + spaces (mirrors the server's slugify input).
export function normName(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// A team's URL slug (matches the server's slugify): accent-folded, a-z0-9, "-".
export function teamSlug(name) {
  return normName(name).replace(/ /g, "-");
}

// Competitions that carry an edition year in the URL: periodic tournaments
// (World Cup, Euro…) plus the European continental club cups. Everything else
// is an annual, continuous competition and stays evergreen (no year).
const EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;

// A football season is named by the year it ends (Aug–Dec belong to the next
// year's season), so World Cup 2026 → 2026 and Champions League 26/27 → 2027.
export function editionYear(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + 1 : y;
}

// League slug for the URL hierarchy, with the edition appended where it matters.
export function leagueSlugFor(comp, iso) {
  const base = teamSlug(comp || "football");
  if (EDITION_RE.test(comp || "")) {
    const y = editionYear(iso);
    if (y) return base + "-" + y;
  }
  return base;
}

// Split a feed competition name into its tournament and (optional) group,
// e.g. "World Cup Grp F" -> { base: "World Cup", group: "F" }. Names without
// a "Grp"/"Group" marker (incl. tiers like "Nations League A") are left whole.
export function splitCompetition(name) {
  const m = /^(.+?)\s+(?:Grp|Group)\.?\s+([A-Z0-9]+)$/i.exec((name || "").trim());
  if (m) return { base: m[1].trim(), group: m[2].toUpperCase() };
  return { base: name || "Football", group: "" };
}

export function nameKey(home, away) {
  return (home + " vs " + away).toLowerCase().replace(/\s+/g, " ").trim();
}

// Build the public share / detail URL for a match: a descriptive, crawlable
// /g/<league>/<date>/<home>-vs-<away> page that nests under the league hub.
// `origin` is the site origin (location.origin on the client, SITE_URL on
// the server).
export function shareLink(fx, origin) {
  const d = new Date(fx.kickoff);
  const date = isNaN(d.getTime()) ? lisbonYmd(new Date()) : lisbonYmd(d);
  const league = leagueSlugFor(fx.competition, fx.kickoff);
  return origin + "/g/" + league + "/" + date + "/" +
    teamSlug(fx.home) + "-vs-" + teamSlug(fx.away);
}
