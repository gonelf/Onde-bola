/*
 * /api/og  (public paths: /og and /og/today) — social preview images, generated
 * on the fly as 1200×630 PNGs with @vercel/og (Satori).
 *
 * Two cards from one edge function (the Hobby plan caps a deployment at 12
 * Serverless Functions, so the per-game and digest renderers share a file):
 *
 *  1. Per-game (default) — a share card for one match: the two teams (with
 *     crests), the competition, the score or kickoff time, the status and the
 *     date. Used as the og:image of the share page (/api/share). The game is
 *     rebuilt from its id via getCard(); display fields can also be passed in
 *     the query (legacy/no-id case). All query inputs are treated as untrusted
 *     text (clamped, no markup).
 *
 *  2. Digest (?today=1, public path /og/today) — the day's top games as a list,
 *     ranked by competition prominence / live-ness / kickoff, each row with
 *     crests, score-or-kickoff and a LIVE/FT badge. Used as the og:image of the
 *     /today and /image pages. Query: ?date=YYYY-MM-DD (default today, Lisbon),
 *     ?n=1..6 (how many games).
 *
 * Per-game query (all optional): home, away, hb, ab (crest URLs), comp, cb
 *   (competition badge URL), score ("2 - 1"), status ("FT"/"67'"/"20:00"), date.
 *
 * Runs on the edge runtime (required by @vercel/og).
 */

import { ImageResponse } from "@vercel/og";
import cardinfo from "../lib/cardinfo.js";

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

// Hyperscript helper so we can build the tree without JSX (this file is plain
// JS, no build step). Satori reads `type` + `props`, so plain objects work.
function h(type, props, children) {
  return { type, props: Object.assign({}, props, { children: children }) };
}

function clamp(s, n) {
  s = (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Pre-fetch a remote crest and inline it as a data URI. Doing the fetch here
// (instead of letting Satori resolve the URL) means a missing/blocked logo just
// degrades to a placeholder dot instead of failing the whole image.
const IMG_HEADERS = {
  // FotMob's image CDN 403s plain/datacenter requests, so present as a browser.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.fotmob.com/",
};

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

// A team crest (inlined image) or, when unavailable, a neutral monogram disc.
function crest(uri, name, size) {
  const s = size || 150;
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

function teamColumn(uri, name) {
  return h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 380,
      },
    },
    [
      crest(uri, name),
      h(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "center",
            textAlign: "center",
            marginTop: 26,
            maxWidth: 360,
            fontSize: 44,
            fontWeight: 700,
            lineHeight: 1.1,
            color: COLOR.text,
          },
        },
        clamp(name, 28)
      ),
    ]
  );
}

// ---------------------------------------------------------------------------
// Digest card (/og/today): the day's top games as a ranked list.
// ---------------------------------------------------------------------------

// Competition prominence by FotMob league id (mirrors fixtures' MAJOR set),
// most-prominent first. Ranking by id — not by competition name — avoids false
// matches like Tanzania's "Premier League" or Bolivia's "Primera División"
// outranking the real thing. Unlisted leagues sink below, ordered by kickoff.
const RANK_IDS = [77, 50, 44, 42, 73, 10216, 47, 87, 54, 55, 53, 61, 57, 48, 9134, 130, 268, 76, 45];
const RANK_POS = {};
RANK_IDS.forEach((id, i) => { RANK_POS[id] = i; });
function leagueRank(f) {
  const p = RANK_POS[f && f.leagueId];
  return p == null ? 999 : p;
}
// live = started but not finished; surfaced first within a league.
function phase(f) {
  const s = (f.status || "").toUpperCase();
  if (s && s !== "FT") return 0;
  if (!s) return 1;
  return 2;
}
function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function fmtTime(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch (e) { return ""; }
}
function fmtDate(ymd) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(ymd + "T12:00:00Z"));
  } catch (e) { return ymd; }
}

// Center cell of a digest row: the score (live/finished) or the kickoff time.
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
                display: "flex", marginTop: 4, padding: "1px 11px", borderRadius: 12,
                backgroundColor: pill.c, color: COLOR.bg, fontSize: 14, fontWeight: 800,
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
        display: "flex", flexDirection: "row", alignItems: "center",
        backgroundColor: COLOR.panel, border: `1px solid ${COLOR.border}`,
        borderRadius: 16, padding: "11px 22px", marginBottom: 11,
      },
    },
    [
      h(
        "div",
        { style: { display: "flex", width: 44, alignItems: "center", justifyContent: "center" } },
        f._compBadge
          ? h("img", { src: f._compBadge, width: 36, height: 36, style: { width: 36, height: 36, objectFit: "contain" } })
          : h("div", { style: { display: "flex" } }, "")
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexGrow: 1 } },
        [
          h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.text, marginRight: 16, textAlign: "right" } }, clamp(f.home, 22)),
          crest(f._homeBadge, f.home, 50),
        ]
      ),
      scoreCell(f),
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

async function renderToday(url) {
  const sp = url.searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") || "") ? sp.get("date") : todayYmd();
  let n = parseInt(sp.get("n") || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(1, Math.min(6, n));

  // Pull the day's fixtures from our own cached feed. Use all=1 so the digest
  // reflects every competition for the date and ranks the marquee games itself
  // (below) — it must not depend on the fixtures "major leagues" allow-list,
  // which can miss the only competition on off-season days (e.g. the World Cup).
  let fixtures = [];
  try {
    const r = await fetch(`${url.origin}/api/fixtures?date=${date}&all=1`, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      if (j && Array.isArray(j.fixtures)) fixtures = j.fixtures;
    }
  } catch (e) { /* degrade to the empty-state card */ }

  fixtures.sort((a, b) => {
    const lr = leagueRank(a) - leagueRank(b);
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
        toDataUri(f.homeBadge), toDataUri(f.awayBadge), toDataUri(f.leagueBadgeUrl),
      ]);
      f._homeBadge = hb; f._awayBadge = ab; f._compBadge = cb;
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
        width: W, height: H, display: "flex", flexDirection: "column",
        backgroundColor: COLOR.bg, fontFamily: "sans-serif", color: COLOR.text,
      },
    },
    [
      h("div", { style: { display: "flex", width: W, height: 10, backgroundColor: COLOR.accent } }, ""),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", flexGrow: 1, padding: "28px 56px" } },
        [
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

export default async function handler(req) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  const g = (k) => searchParams.get(k) || "";

  // Digest card: /og/today (rewritten to ?today=1).
  if (searchParams.get("today") != null || g("id") === "today") {
    return renderToday(url);
  }

  // Short form: /og/<id> (rewritten to ?id=<id>). Rebuild the game's display
  // from the match id via getCard (FotMob + KV cache); fall back to any display
  // fields passed directly in the query (legacy/no-id case).
  const fmid = g("id").replace(/^fm:/, "").trim();
  let card = null;
  if (/^\d+$/.test(fmid)) {
    try {
      const j = await cardinfo.getCard(fmid);
      if (j && j.ok) card = j.card;
    } catch (e) { /* fall back to query params */ }
  }
  const f = (k, fallback) => (card && card[k]) || g(fallback || k) || "";

  const home = clamp(f("home") || "Home", 28);
  const away = clamp(f("away") || "Away", 28);
  const comp = clamp(f("comp"), 42);
  const score = clamp(f("score"), 9);
  const status = clamp(f("status"), 10);
  const date = clamp((card && card.date) || g("date"), 40);

  const [homeBadge, awayBadge, compBadge] = await Promise.all([
    toDataUri((card && card.homeBadge) || g("hb")),
    toDataUri((card && card.awayBadge) || g("ab")),
    toDataUri((card && card.leagueBadge) || g("cb")),
  ]);

  // Center column: the score (finished/live) or the kickoff time (upcoming),
  // with a status pill beneath it.
  const centerMain = score || status || "VS";
  const center = h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      },
    },
    [
      h(
        "div",
        {
          style: {
            display: "flex",
            fontSize: score ? 96 : 64,
            fontWeight: 800,
            color: COLOR.text,
            letterSpacing: score ? "2px" : "0px",
          },
        },
        centerMain
      ),
      status && (score || centerMain !== status)
        ? h(
            "div",
            {
              style: {
                display: "flex",
                marginTop: 18,
                padding: "8px 20px",
                borderRadius: 22,
                backgroundColor: COLOR.accent,
                color: COLOR.bg,
                fontSize: 26,
                fontWeight: 800,
              },
            },
            status
          )
        : h("div", { style: { display: "flex" } }, ""),
    ]
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
      // Accent top bar.
      h("div", { style: { display: "flex", width: W, height: 10, backgroundColor: COLOR.accent } }, ""),
      // Body.
      h(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            justifyContent: "space-between",
            padding: "48px 64px",
          },
        },
        [
          // Header: brand + competition.
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
            [
              h(
                "div",
                { style: { display: "flex", flexDirection: "row", alignItems: "center" } },
                [
                  h("div", { style: { display: "flex", width: 30, height: 30, borderRadius: 15, backgroundColor: COLOR.accent, marginRight: 14 } }, ""),
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", fontSize: 34, fontWeight: 800 } },
                    [
                      h("div", { style: { display: "flex" } }, "Hoje Há "),
                      h("div", { style: { display: "flex", color: COLOR.accent } }, "Bola"),
                    ]
                  ),
                ]
              ),
              comp
                ? h(
                    "div",
                    {
                      style: {
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        maxWidth: 560,
                        padding: "10px 20px",
                        borderRadius: 14,
                        backgroundColor: COLOR.panel,
                        border: `1px solid ${COLOR.border}`,
                      },
                    },
                    [
                      compBadge
                        ? h("img", { src: compBadge, width: 36, height: 36, style: { width: 36, height: 36, objectFit: "contain", marginRight: 12 } })
                        : h("div", { style: { display: "flex" } }, ""),
                      h("div", { style: { display: "flex", fontSize: 28, fontWeight: 600, color: COLOR.muted } }, comp),
                    ]
                  )
                : h("div", { style: { display: "flex" } }, ""),
            ]
          ),
          // Teams + score.
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
            [teamColumn(homeBadge, home), center, teamColumn(awayBadge, away)]
          ),
          // Footer: where-to-watch tagline + date.
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
            [
              h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.accent } }, "Football on TV · where to watch"),
              date
                ? h("div", { style: { display: "flex", fontSize: 28, color: COLOR.muted } }, date)
                : h("div", { style: { display: "flex" } }, ""),
            ]
          ),
        ]
      ),
    ]
  );

  return new ImageResponse(tree, {
    width: W,
    height: H,
    headers: {
      // Cache hard at the CDN: a given match's card is immutable enough.
      "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
}
