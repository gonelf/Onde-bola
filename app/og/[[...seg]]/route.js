/*
 * /og/<id> and /og/today — social preview images, generated on the fly with
 * @vercel/og (Satori). Ported from api/og.js.
 *
 *  1. Per-game (/og/<id>) — a 1200×630 share card for one match: the two teams
 *     (crests), competition, score or kickoff, status and date. Rebuilt from the
 *     match id via getCard(); display fields can also be passed in the query.
 *
 *  2. Digest (/og/today) — the day's top games as a ranked list. Query:
 *     ?date=YYYY-MM-DD (default today, Lisbon); ?n (how many games, clamped per
 *     format); ?format=landscape|square|story (1200×630 / 1080×1080 / 1080×1920,
 *     default landscape); ?highlight=<fmid> to feature one game in a hero card
 *     above the list (then ?n is how many more to list). Copy is Portuguese.
 *
 * Runs on the edge runtime (required by @vercel/og).
 */

import { ImageResponse } from "next/og";
import { getCard } from "@/lib/cardinfo";

export const runtime = "edge";

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

// Hyperscript helper so we can build the tree without JSX. Satori reads
// `type` + `props`, so plain objects work.
function h(type, props, children) {
  return { type, props: Object.assign({}, props, { children: children }) };
}

function clamp(s, n) {
  s = (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

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

// Image formats the digest can render in. Landscape doubles as the social
// link-preview (1.91:1); square suits an Instagram/Facebook feed post; story is
// the 9:16 Instagram/WhatsApp Story canvas. Each carries a full set of pixel
// sizes so one renderer (renderToday) draws all three.
const FORMATS = {
  landscape: {
    W: 1200, H: 630, accentH: 10, pad: "26px 56px",
    brandDot: 26, brandFont: 30, titleFont: 40, dateFont: 30, tagFont: 22, headGap: 18,
    rowPad: "11px 22px", rowGap: 10, rowName: 28, rowCrest: 48, rowScore: 30,
    rowBadge: 36, rowCompCol: 44, rowScoreCol: 150, rowNameCap: 22,
    heroPad: "18px 30px", heroCompFont: 22, heroName: 38, heroCrest: 96,
    heroScore: 72, heroStatusFont: 22, heroBadge: 34, heroNameCap: 24, heroGap: 18,
    maxN: 6,
  },
  square: {
    W: 1080, H: 1080, accentH: 12, pad: "44px 56px",
    brandDot: 30, brandFont: 34, titleFont: 50, dateFont: 30, tagFont: 24, headGap: 22,
    rowPad: "15px 26px", rowGap: 13, rowName: 32, rowCrest: 56, rowScore: 34,
    rowBadge: 40, rowCompCol: 50, rowScoreCol: 160, rowNameCap: 20,
    heroPad: "26px 36px", heroCompFont: 26, heroName: 46, heroCrest: 130,
    heroScore: 92, heroStatusFont: 26, heroBadge: 42, heroNameCap: 22, heroGap: 24,
    maxN: 7,
  },
  story: {
    W: 1080, H: 1920, accentH: 16, pad: "90px 64px",
    brandDot: 36, brandFont: 42, titleFont: 66, dateFont: 38, tagFont: 30, headGap: 30,
    rowPad: "22px 32px", rowGap: 18, rowName: 40, rowCrest: 68, rowScore: 46,
    rowBadge: 50, rowCompCol: 66, rowScoreCol: 190, rowNameCap: 22,
    heroPad: "42px 46px", heroCompFont: 32, heroName: 60, heroCrest: 184,
    heroScore: 124, heroStatusFont: 32, heroBadge: 56, heroNameCap: 24, heroGap: 30,
    maxN: 12,
  },
};

const RANK_IDS = [77, 50, 44, 42, 73, 10216, 47, 87, 54, 55, 53, 61, 57, 48, 9134, 130, 268, 76, 45];
const RANK_POS = {};
RANK_IDS.forEach((id, i) => { RANK_POS[id] = i; });
function leagueRank(f) {
  const p = RANK_POS[f && f.leagueId];
  return p == null ? 999 : p;
}
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
    return new Intl.DateTimeFormat("pt-PT", {
      timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(ymd + "T12:00:00Z"));
  } catch (e) { return ymd; }
}

// A status pill's text + colour: the live minute (or "AO VIVO") while playing,
// "FIM" once finished, nothing for an upcoming game.
function statusPill(f) {
  const ph = phase(f);
  if (ph === 0) return { t: clamp(f.status, 6) || "AO VIVO", c: COLOR.live };
  if (ph === 2) return { t: "FIM", c: COLOR.muted };
  return null;
}

// The center value for a game: its live/final score once under way, otherwise
// the scheduled kickoff time. Upstream can report a premature 0-0 for a game
// that hasn't kicked off, so we only trust the score once the status says the
// game is live or finished (phase !== 1) — an upcoming game shows its time.
function centerValue(f) {
  const hasScore = f.homeScore != null && f.homeScore !== "" &&
    f.awayScore != null && f.awayScore !== "";
  if (phase(f) !== 1 && hasScore) {
    return { big: `${f.homeScore} - ${f.awayScore}`, isScore: true };
  }
  return { big: fmtTime(f.kickoff) || "—", isScore: false };
}

// Center cell of a digest row: the score (live/finished) or the kickoff time.
function scoreCell(f, S) {
  const { big } = centerValue(f);
  const pill = statusPill(f);
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", width: S.rowScoreCol } },
    [
      h("div", { style: { display: "flex", fontSize: S.rowScore, fontWeight: 800, color: COLOR.text } }, big),
      pill
        ? h(
            "div",
            {
              style: {
                display: "flex", marginTop: 4, padding: "1px 11px", borderRadius: 12,
                backgroundColor: pill.c, color: COLOR.bg, fontSize: Math.round(S.rowScore * 0.44), fontWeight: 800,
              },
            },
            pill.t
          )
        : h("div", { style: { display: "flex" } }, ""),
    ]
  );
}

function gameRow(f, S) {
  return h(
    "div",
    {
      style: {
        display: "flex", flexDirection: "row", alignItems: "center",
        backgroundColor: COLOR.panel, border: `1px solid ${COLOR.border}`,
        borderRadius: 16, padding: S.rowPad, marginBottom: S.rowGap,
      },
    },
    [
      h(
        "div",
        { style: { display: "flex", width: S.rowCompCol, alignItems: "center", justifyContent: "center" } },
        f._compBadge
          ? h("img", { src: f._compBadge, width: S.rowBadge, height: S.rowBadge, style: { width: S.rowBadge, height: S.rowBadge, objectFit: "contain" } })
          : h("div", { style: { display: "flex" } }, "")
      ),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexGrow: 1 } },
        [
          h("div", { style: { display: "flex", fontSize: S.rowName, fontWeight: 700, color: COLOR.text, marginRight: 16, textAlign: "right" } }, clamp(f.home, S.rowNameCap)),
          crest(f._homeBadge, f.home, S.rowCrest),
        ]
      ),
      scoreCell(f, S),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", flexGrow: 1 } },
        [
          crest(f._awayBadge, f.away, S.rowCrest),
          h("div", { style: { display: "flex", fontSize: S.rowName, fontWeight: 700, color: COLOR.text, marginLeft: 16 } }, clamp(f.away, S.rowNameCap)),
        ]
      ),
    ]
  );
}

// One team in the hero card: a big crest with its name beneath.
function heroTeam(uri, name, S) {
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", flexGrow: 1, maxWidth: Math.round(S.W * 0.34) } },
    [
      crest(uri, name, S.heroCrest),
      h(
        "div",
        {
          style: {
            display: "flex", justifyContent: "center", textAlign: "center",
            marginTop: 18, fontSize: S.heroName, fontWeight: 700, lineHeight: 1.1, color: COLOR.text,
          },
        },
        clamp(name, S.heroNameCap)
      ),
    ]
  );
}

// Center of the hero card: a large score/kickoff with the status pill beneath.
function heroCenter(f, S) {
  const { big, isScore } = centerValue(f);
  const pill = statusPill(f);
  return h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } },
    [
      h("div", { style: { display: "flex", fontSize: S.heroScore, fontWeight: 800, color: COLOR.text, letterSpacing: isScore ? "2px" : "0px" } }, big),
      pill
        ? h(
            "div",
            {
              style: {
                display: "flex", marginTop: 12, padding: "6px 18px", borderRadius: 18,
                backgroundColor: pill.c, color: COLOR.bg, fontSize: S.heroStatusFont, fontWeight: 800,
              },
            },
            pill.t
          )
        : h("div", { style: { display: "flex" } }, ""),
    ]
  );
}

// The featured game: a prominent card above the list (competition on top, then
// the two teams flanking the big score/kickoff).
function heroCard(f, S) {
  return h(
    "div",
    {
      style: {
        display: "flex", flexDirection: "column",
        backgroundColor: COLOR.panel, border: `1px solid ${COLOR.border}`,
        borderRadius: 22, padding: S.heroPad, marginBottom: S.heroGap,
      },
    },
    [
      f.competition || f._compBadge
        ? h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 14 } },
            [
              f._compBadge
                ? h("img", { src: f._compBadge, width: S.heroBadge, height: S.heroBadge, style: { width: S.heroBadge, height: S.heroBadge, objectFit: "contain", marginRight: 12 } })
                : h("div", { style: { display: "flex" } }, ""),
              h("div", { style: { display: "flex", fontSize: S.heroCompFont, fontWeight: 600, color: COLOR.muted } }, clamp(f.competition, 40)),
            ]
          )
        : h("div", { style: { display: "flex" } }, ""),
      h(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
        [heroTeam(f._homeBadge, f.home, S), heroCenter(f, S), heroTeam(f._awayBadge, f.away, S)]
      ),
    ]
  );
}

// Pull the day's fixtures from our own cached feed, resiliently: the digest is
// drawn on the edge and a single transient hiccup on the internal call must not
// turn a day full of games into the "no games" card. Try ?all=1 with a timeout,
// retry once, then fall back to the default (major) feed — which shares the same
// KV cache/backup, so it usually answers even when upstream is momentarily down.
async function fetchDayFixtures(origin, date) {
  const tryOnce = async (qs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5500);
    try {
      const r = await fetch(`${origin}/api/fixtures?date=${date}${qs}`, {
        headers: { Accept: "application/json" }, signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j && Array.isArray(j.fixtures) ? j.fixtures : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  };
  let fx = await tryOnce("&all=1");
  if (!fx || !fx.length) fx = await tryOnce("&all=1");
  if (!fx || !fx.length) fx = await tryOnce("");
  return fx || [];
}

async function renderToday(url) {
  const sp = url.searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("date") || "") ? sp.get("date") : todayYmd();
  const S = FORMATS[sp.get("format")] || FORMATS.landscape;

  // ?highlight=<fmid> features one game in a hero card above the list; ?n is
  // then how many *more* games to list (and how many total when nothing is
  // highlighted). Clamp per format — a story fits far more than a 1.91:1 card.
  const highlightId = (sp.get("highlight") || "").replace(/^fm:/, "").trim();
  let n = parseInt(sp.get("n") || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(1, Math.min(S.maxN, n));

  // Every competition for the date (?all=1), so the digest ranks the marquee
  // games itself (below) and doesn't depend on the fixtures "major leagues"
  // allow-list, which can miss the only competition on off-season days.
  let fixtures = await fetchDayFixtures(url.origin, date);

  fixtures.sort((a, b) => {
    const lr = leagueRank(a) - leagueRank(b);
    if (lr) return lr;
    const ph = phase(a) - phase(b);
    if (ph) return ph;
    return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
  });

  // Lift the highlighted game out of the list so it isn't shown twice.
  let hero = null;
  if (/^\d+$/.test(highlightId)) {
    const i = fixtures.findIndex((f) => String(f.fmid) === highlightId);
    if (i !== -1) hero = fixtures.splice(i, 1)[0];
  }
  const top = fixtures.slice(0, n);

  // Inline crests/badges for the chosen games (parallel, best-effort).
  await Promise.all(
    (hero ? [hero] : []).concat(top).map(async (f) => {
      const [hb, ab, cb] = await Promise.all([
        toDataUri(f.homeBadge), toDataUri(f.awayBadge), toDataUri(f.leagueBadgeUrl),
      ]);
      f._homeBadge = hb; f._awayBadge = ab; f._compBadge = cb;
    })
  );

  const emptyState = h(
    "div",
    { style: { display: "flex", flexDirection: "column", flexGrow: 1, alignItems: "center", justifyContent: "center", padding: "0 40px" } },
    [
      h("div", { style: { display: "flex", fontSize: S.titleFont, fontWeight: 800, color: COLOR.text } }, "Sem jogos para mostrar"),
      h(
        "div",
        {
          style: {
            display: "flex", maxWidth: S.W - 200, marginTop: 12, textAlign: "center",
            lineHeight: 1.3, fontSize: Math.round(S.titleFont * 0.55), fontWeight: 600, color: COLOR.muted,
          },
        },
        "Não há jogos de relevo agendados para este dia — volta em breve."
      ),
    ]
  );

  const list = top.length
    ? h("div", { style: { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" } }, top.map((f) => gameRow(f, S)))
    : (hero ? h("div", { style: { display: "flex" } }, "") : emptyState);

  const isToday = date === todayYmd();
  const tree = h(
    "div",
    {
      style: {
        width: S.W, height: S.H, display: "flex", flexDirection: "column",
        backgroundColor: COLOR.bg, fontFamily: "sans-serif", color: COLOR.text,
      },
    },
    [
      h("div", { style: { display: "flex", width: S.W, height: S.accentH, backgroundColor: COLOR.accent } }, ""),
      h(
        "div",
        { style: { display: "flex", flexDirection: "column", flexGrow: 1, padding: S.pad } },
        [
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: S.headGap } },
            [
              h(
                "div",
                { style: { display: "flex", flexDirection: "column" } },
                [
                  h(
                    "div",
                    { style: { display: "flex", flexDirection: "row", alignItems: "center" } },
                    [
                      h("div", { style: { display: "flex", width: S.brandDot, height: S.brandDot, borderRadius: S.brandDot / 2, backgroundColor: COLOR.accent, marginRight: 12 } }, ""),
                      h(
                        "div",
                        { style: { display: "flex", flexDirection: "row", fontSize: S.brandFont, fontWeight: 800 } },
                        [
                          h("div", { style: { display: "flex", marginRight: Math.round(S.brandFont * 0.26) } }, "Hoje Há"),
                          h("div", { style: { display: "flex", color: COLOR.accent } }, "Bola"),
                        ]
                      ),
                    ]
                  ),
                  h("div", { style: { display: "flex", fontSize: S.titleFont, fontWeight: 800, color: COLOR.text, marginTop: 10 } }, isToday ? "Jogos de hoje" : "Jogos do dia"),
                ]
              ),
              h(
                "div",
                { style: { display: "flex", flexDirection: "column", alignItems: "flex-end" } },
                [
                  h("div", { style: { display: "flex", fontSize: S.dateFont, fontWeight: 700, color: COLOR.accent } }, fmtDate(date)),
                  h("div", { style: { display: "flex", fontSize: S.tagFont, color: COLOR.muted, marginTop: 6 } }, "Futebol na TV · onde ver"),
                ]
              ),
            ]
          ),
          hero ? heroCard(hero, S) : h("div", { style: { display: "flex" } }, ""),
          list,
        ]
      ),
    ]
  );

  return new ImageResponse(tree, {
    width: S.W,
    height: S.H,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}

export async function GET(req, ctx) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  const g = (k) => searchParams.get(k) || "";
  const params = (ctx && ctx.params) ? await ctx.params : {};
  const seg = (params && params.seg) || [];
  const routeId = seg[0] || "";

  // Digest card: /og/today.
  if (routeId === "today" || searchParams.get("today") != null || g("id") === "today") {
    return renderToday(url);
  }

  // Short form: /og/<id>. Rebuild the game's display from the match id via
  // getCard (FotMob + KV cache); fall back to display fields in the query.
  const fmid = (routeId || g("id")).replace(/^fm:/, "").trim();
  let card = null;
  if (/^\d+$/.test(fmid)) {
    try {
      const j = await getCard(fmid);
      if (j && j.ok) card = j.card;
    } catch (e) { /* fall back to query params */ }
  }
  const f = (k, fallback) => (card && card[k]) || g(fallback || k) || "";

  const home = clamp(f("home") || "Casa", 28);
  const away = clamp(f("away") || "Fora", 28);
  const comp = clamp(f("comp"), 42);
  const score = clamp(f("score"), 9);
  const status = clamp(f("status"), 10);
  const date = clamp((card && card.date) || g("date"), 40);

  const [homeBadge, awayBadge, compBadge] = await Promise.all([
    toDataUri((card && card.homeBadge) || g("hb")),
    toDataUri((card && card.awayBadge) || g("ab")),
    toDataUri((card && card.leagueBadge) || g("cb")),
  ]);

  const centerMain = score || status || "VS";
  const center = h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } },
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
      h("div", { style: { display: "flex", width: W, height: 10, backgroundColor: COLOR.accent } }, ""),
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
                      h("div", { style: { display: "flex", marginRight: 9 } }, "Hoje Há"),
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
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
            [teamColumn(homeBadge, home), center, teamColumn(awayBadge, away)]
          ),
          h(
            "div",
            { style: { display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" } },
            [
              h("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: COLOR.accent } }, "Futebol na TV · onde ver"),
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
      "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
    },
  });
}
