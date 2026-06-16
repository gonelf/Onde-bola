/*
 * /api/og-today  (public path: /og/today) — a single social-share image of the
 * day's top football games, generated on the fly as a 1200×630 PNG with
 * @vercel/og (Satori).
 *
 * Where /og/<id> is one match, this is a digest: it pulls the day's fixtures
 * from /api/fixtures (already filtered to major competitions + KV-cached),
 * ranks them by competition prominence / live-ness / kickoff, and lays the top
 * few out as a list — crests, score or kickoff time, and a LIVE/FT pill — so a
 * single post answers "what's on today?". Used as the og:image of /today.
 *
 * Query (all optional):
 *   date   YYYY-MM-DD (defaults to today, Europe/Lisbon — this is a PT-first app)
 *   n      how many games to show (1–6, default 5)
 *
 * Runs on the edge runtime (required by @vercel/og).
 */

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const W = 1200;
const H = 630;
const TZ = "Europe/Lisbon";

const COLOR = {
  bg: "#0f1722",
  panel: "#16202e",
  border: "#26384c",
  text: "#e8eef5",
  muted: "#93a4b8",
  accent: "#16d27a",
  live: "#ff5470",
};

// Hyperscript helper so we can build the tree without JSX (no build step here).
function h(type, props, children) {
  return { type, props: Object.assign({}, props, { children: children }) };
}

function clamp(s, n) {
  s = (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// FotMob's image CDN 403s plain/datacenter requests, so present as a browser.
const IMG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.fotmob.com/",
};

// Pre-fetch a remote crest and inline it as a data URI so a missing/blocked
// logo degrades to a monogram instead of failing the whole image.
async function toDataUri(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const r = await fetch(url, { headers: IMG_HEADERS });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:${ct};base64,${btoa(bin)}`;
  } catch (e) {
    return "";
  }
}

// A small crest (inlined image) or, when unavailable, a monogram disc.
function crest(uri, name, size) {
  const s = size || 56;
  if (uri) {
    return h("img", {
      src: uri,
      width: s,
      height: s,
      style: { width: s, height: s, objectFit: "contain" },
    });
  }
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return h(
    "div",
    {
      style: {
        width: s,
        height: s,
        borderRadius: s / 2,
        backgroundColor: COLOR.panel,
        border: `2px solid ${COLOR.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(s * 0.42),
        fontWeight: 800,
        color: COLOR.muted,
      },
    },
    letter
  );
}

// Competition prominence: lower index = shown first. Matched against the
// competition name (FotMob's league name). Everything unmatched sinks below.
const RANK = [
  /champions league/i,
  /europa league/i,
  /conference league/i,
  /world cup/i,
  /european championship|\beuro\b/i,
  /copa am[eé]rica/i,
  /nations league/i,
  /premier league/i,
  /la ?liga|primera divisi/i,
  /serie a/i,
  /bundesliga/i,
  /ligue 1/i,
  /primeira liga|liga portugal/i,
  /libertadores/i,
  /eredivisie/i,
  /mls/i,
  /saudi pro/i,
];

function leagueRank(comp) {
  for (let i = 0; i < RANK.length; i++) if (RANK[i].test(comp || "")) return i;
  return RANK.length;
}

// "live" = started but not finished; we surface those first within a league.
function phase(f) {
  const s = (f.status || "").toUpperCase();
  if (s && s !== "FT") return 0; // in play
  if (!s) return 1; // upcoming
  return 2; // finished (FT)
}

function todayYmd() {
  // en-CA renders YYYY-MM-DD; pin it to Lisbon so "today" matches the audience.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(iso));
  } catch (e) {
    return "";
  }
}

function fmtDate(ymd) {
  try {
    const d = new Date(ymd + "T12:00:00Z");
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch (e) {
    return ymd;
  }
}

// Center cell: the score (live/finished) or the kickoff time (upcoming).
function scoreCell(f) {
  const hasScore = f.homeScore != null && f.homeScore !== "" &&
    f.awayScore != null && f.awayScore !== "";
  const big = hasScore ? `${f.homeScore} - ${f.awayScore}` : (fmtTime(f.kickoff) || "—");
  const ph = phase(f);
  const pill = ph === 0 ? { t: clamp(f.status, 6) || "LIVE", c: COLOR.live }
    : ph === 2 ? { t: "FT", c: COLOR.muted }
    : null;
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", width: 150 } },
    [
      h("div", { style: { display: "flex", fontSize: 32, fontWeight: 800, color: COLOR.text } }, big),
      pill
        ? h(
            "div",
            {
              style: {
                display: "flex",
                marginTop: 4,
                padding: "1px 11px",
                borderRadius: 12,
                backgroundColor: pill.c,
                color: COLOR.bg,
                fontSize: 14,
                fontWeight: 800,
              },
            },
            pill.t
          )
        : h("div", { style: { display: "flex" } }, ""),
    ]
  );
}

function gameRow(f) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: COLOR.panel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: "11px 22px",
        marginBottom: 11,
      },
    },
    [
      // Competition badge (or nothing) at the far left.
      h(
        "div",
        { style: { display: "flex", width: 44, alignItems: "center", justifyContent: "center" } },
        f._compBadge
          ? h("img", { src: f._compBadge, width: 36, height: 36, style: { width: 36, height: 36, objectFit: "contain" } })
          : h("div", { style: { display: "flex" } }, "")
      ),
      // Home: name (right-aligned) + crest.
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexGrow: 1 } },
        [
          h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.text, marginRight: 16, textAlign: "right" } }, clamp(f.home, 22)),
          crest(f._homeBadge, f.home, 50),
        ]
      ),
      // Center score / time.
      scoreCell(f),
      // Away: crest + name (left-aligned).
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", flexGrow: 1 } },
        [
          crest(f._awayBadge, f.away, 50),
          h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.text, marginLeft: 16 } }, clamp(f.away, 22)),
        ]
      ),
    ]
  );
}

export default async function handler(req) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") || "") ? sp.get("date") : todayYmd();
  let n = parseInt(sp.get("n") || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(1, Math.min(6, n));

  // Pull the day's (major-competition) fixtures from our own cached feed.
  let fixtures = [];
  try {
    const r = await fetch(`${url.origin}/api/fixtures?date=${date}`, {
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const j = await r.json();
      if (j && Array.isArray(j.fixtures)) fixtures = j.fixtures;
    }
  } catch (e) { /* degrade to the empty-state card */ }

  // Rank: competition prominence, then live > upcoming > finished, then kickoff.
  fixtures.sort((a, b) => {
    const lr = leagueRank(a.competition) - leagueRank(b.competition);
    if (lr) return lr;
    const ph = phase(a) - phase(b);
    if (ph) return ph;
    return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
  });
  const top = fixtures.slice(0, n);

  // Inline crests/badges for the chosen games (parallel, best-effort).
  await Promise.all(
    top.map(async (f) => {
      const [hb, ab, cb] = await Promise.all([
        toDataUri(f.homeBadge),
        toDataUri(f.awayBadge),
        toDataUri(f.leagueBadgeUrl),
      ]);
      f._homeBadge = hb;
      f._awayBadge = ab;
      f._compBadge = cb;
    })
  );

  const body = top.length
    ? h("div", { style: { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" } }, top.map(gameRow))
    : h(
        "div",
        { style: { display: "flex", flexGrow: 1, alignItems: "center", justifyContent: "center" } },
        h("div", { style: { display: "flex", fontSize: 40, fontWeight: 700, color: COLOR.muted } }, "No major games scheduled — check back soon")
      );

  const tree = h(
    "div",
    {
      style: {
        width: W,
        height: H,
        display: "flex",
        flexDirection: "column",
        backgroundColor: COLOR.bg,
        fontFamily: "sans-serif",
        color: COLOR.text,
      },
    },
    [
      h("div", { style: { display: "flex", width: W, height: 10, backgroundColor: COLOR.accent } }, ""),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", flexGrow: 1, padding: "28px 56px" } },
        [
          // Header: brand + "Top games" title + date.
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 } },
            [
              h(
                "div",
                { style: { display: "flex", flexDirection: "column" } },
                [
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", alignItems: "center" } },
                    [
                      h("div", { style: { display: "flex", width: 26, height: 26, borderRadius: 13, backgroundColor: COLOR.accent, marginRight: 12 } }, ""),
                      h(
                        "div",
                        { style: { display: "flex", flexDirection: "row", fontSize: 30, fontWeight: 800 } },
                        [
                          h("div", { style: { display: "flex" } }, "Hoje Há "),
                          h("div", { style: { display: "flex", color: COLOR.accent } }, "Bola"),
                        ]
                      ),
                    ]
                  ),
                  h("div", { style: { display: "flex", fontSize: 42, fontWeight: 800, color: COLOR.text, marginTop: 10 } }, "Today's top games"),
                ]
              ),
              h(
                "div",
                { style: { display: "flex", flexDirection: "column", alignItems: "flex-end" } },
                [
                  h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.accent } }, fmtDate(date)),
                  h("div", { style: { display: "flex", fontSize: 22, color: COLOR.muted, marginTop: 6 } }, "Football on TV · where to watch"),
                ]
              ),
            ]
          ),
          body,
        ]
      ),
    ]
  );

  return new ImageResponse(tree, {
    width: W,
    height: H,
    headers: {
      // Today's digest changes with scores, so cache short at the CDN.
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
