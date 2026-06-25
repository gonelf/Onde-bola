/*
 * lib/digest-text — builds a plain-text post of the day's selected games, ready
 * to paste into WhatsApp / X / Instagram captions. It's the text sibling of the
 * /og/today image and the /image/* PNG endpoints: same ranked selection from the
 * cached /api/fixtures feed, rendered as lines instead of a card. Example:
 *
 *   ⚽ Jogos de hoje! 🏆
 *
 *   🇨🇿 República Checa 1-0 🇿🇦 África do Sul (a decorrer) na SIC
 *   🇨🇭 Suíça vs 🇧🇦 Bósnia às 20h na SIC
 *   🇨🇦 Canadá vs 🇶🇦 Qatar às 23h na Sport TV 5
 *
 *   Vê todos os jogos e onde ver na TV 👉 hojehabola.com
 *
 * Each game carries a flag per team (national sides resolve via lib/country-flags;
 * club sides simply render with none) and one Portuguese TV channel — free-to-air
 * if available, otherwise the cheapest cable option — resolved from the same TV
 * feeds the site uses (/api/listings rich store + /api/fmtv), Portugal-only.
 */

import { flagForTeam } from "./country-flags";
import { isPaidChannel } from "./broadcasters";
import { phase, selectTop } from "./digest-select";
import { brandForOrigin } from "./brand";

const TZ = "Europe/Lisbon";

const norm = (s) => String(s == null ? "" : s)
  .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 5000);
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

export function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function clampTextN(raw) {
  let n = parseInt(raw || "6", 10);
  if (!Number.isFinite(n)) n = 6;
  return Math.max(1, Math.min(20, n));
}

// Kickoff time in Lisbon. PT renders "20h" / "20h30"; other languages "20:00".
function fmtKick(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((o, p) => ((o[p.type] = p.value), o), {});
  const hh = parts.hour, mm = parts.minute;
  if (lang === "pt") {
    const h = String(Number(hh));
    return mm === "00" ? `${h}h` : `${h}h${mm}`;
  }
  return `${hh}:${mm}`;
}

function hasScore(f) {
  return f.homeScore != null && f.homeScore !== "" &&
    f.awayScore != null && f.awayScore !== "";
}

// One Portuguese channel for a fixture, free-to-air preferred over cable. Reads
// the same two TV feeds the /g pages use: the rich store keyed by FotMob id, then
// the live FotMob bulk feed (joined by id, falling back to team names).
function ptChannelFor(f, fmtvFeed, rich) {
  let rows = (rich && Array.isArray(rich.rows) && rich.rows.length) ? rich.rows : null;
  if (!rows) {
    const matches = (fmtvFeed && Array.isArray(fmtvFeed.matches)) ? fmtvFeed.matches : [];
    const h = norm(f.home), a = norm(f.away);
    const m =
      (f.fmid && matches.find((x) => x && String(x.id) === String(f.fmid))) ||
      matches.find((x) => x && x.h === h && x.a === a) ||
      matches.find((x) => x && ((x.h === h && x.a === a) || (x.h === a && x.a === h)));
    rows = (m && Array.isArray(m.rows) && m.rows.length) ? m.rows : null;
  }
  if (!rows) return "";
  const pt = Array.from(new Set(
    rows.filter((r) => r && r.country === "Portugal" && r.channel).map((r) => r.channel)
  ));
  if (!pt.length) return "";
  // Free-to-air first, then alphabetical for a stable pick.
  pt.sort((x, y) => {
    const px = isPaidChannel(x) ? 1 : 0, py = isPaidChannel(y) ? 1 : 0;
    return px !== py ? px - py : x.localeCompare(y);
  });
  return pt[0];
}

const COPY = {
  pt: {
    headToday: "⚽ Jogos de hoje! 🏆",
    headDay: "⚽ Jogos do dia! 🏆",
    vs: "vs", live: "(a decorrer)", ht: "(intervalo)", ft: "(terminado)",
    at: (t) => `às ${t}`, on: (ch) => `na ${ch}`,
    footer: (site) => `Vê todos os jogos e onde ver na TV 👉 ${site}`,
    noGames: "Sem jogos de relevo para mostrar.",
  },
  en: {
    headToday: "⚽ Today's games! 🏆",
    headDay: "⚽ The day's games! 🏆",
    vs: "vs", live: "(live)", ht: "(half-time)", ft: "(full-time)",
    at: (t) => `at ${t}`, on: (ch) => `on ${ch}`,
    footer: (site) => `See every game and where to watch on TV 👉 ${site}`,
    noGames: "No major games to show.",
  },
};

// The middle of a line: score + status for live/finished games, "vs … at <time>"
// for upcoming ones.
function gameLine(f, c, lang, channel) {
  const hf = flagForTeam(f.home), af = flagForTeam(f.away);
  const home = (hf ? hf + " " : "") + f.home;
  const away = (af ? af + " " : "") + f.away;
  const ph = phase(f);
  const ch = channel ? " " + c.on(channel) : "";

  if (ph === 1 || !hasScore(f)) {
    const t = fmtKick(f.kickoff, lang);
    const when = t ? " " + c.at(t) : "";
    return `${home} ${c.vs} ${away}${when}${ch}`;
  }
  const score = `${f.homeScore}-${f.awayScore}`;
  const st = ph === 0
    ? ((f.status || "").toUpperCase() === "HT" ? c.ht : c.live)
    : c.ft;
  return `${home} ${score} ${away} ${st}${ch}`;
}

/**
 * Build the plain-text post. Returns { text, count, date }.
 *   origin  — request origin, to call the internal feeds
 *   date    — YYYY-MM-DD (defaults to today, Lisbon)
 *   n       — how many games to list (clamped 1..20)
 *   lang    — "pt" (default) or "en"
 */
export async function buildTextPost({ origin, date, n, lang }) {
  const c = COPY[lang] || COPY.pt;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date : todayYmd();
  const isToday = day === todayYmd();

  const [fx, listings, fmtv] = await Promise.all([
    getJson(`${origin}/api/fixtures?date=${day}&all=1`, 6000),
    getJson(`${origin}/api/listings?date=${day}`, 5000),
    getJson(`${origin}/api/fmtv?date=${day}`, 5000),
  ]);
  const rich = (listings && listings.matches) || {};
  const top = selectTop(fx && fx.fixtures, clampTextN(n));

  const header = isToday ? c.headToday : c.headDay;
  const lines = top.map((f) => {
    const channel = ptChannelFor(f, fmtv, f.fmid ? rich[String(f.fmid)] : null);
    return gameLine(f, c, lang, channel);
  });

  const body = lines.length ? lines.join("\n") : c.noGames;
  const footer = c.footer(brandForOrigin(origin).domain);
  const text = `${header}\n\n${body}\n\n${footer}\n`;
  return { text, count: lines.length, date: day };
}
