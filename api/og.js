/*
 * /api/og  (public path: /og) — per-game social preview image, generated on the
 * fly as a 1200×630 PNG with @vercel/og (Satori).
 *
 * Renders a share card for one match: the two teams (with crests), the
 * competition, the score or kickoff time, the status and the date — styled to
 * match the site. Used as the og:image / twitter:image of the share page
 * (/api/share). All inputs come from the query string and are treated as
 * untrusted text (clamped, no markup).
 *
 * Query (all optional):
 *   home, away   team names
 *   hb,   ab     team crest URLs (FotMob CDN; pre-fetched and inlined)
 *   comp         competition name
 *   cb           competition badge URL
 *   score        e.g. "2 - 1" (omit for upcoming games)
 *   status       e.g. "FT", "LIVE", "67'", or a kickoff time like "20:00"
 *   date         display date, e.g. "Mon, 15 Jun 2026"
 *
 * Runs on the edge runtime (required by @vercel/og).
 */

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const W = 1200;
const H = 630;

const COLOR = {
  bg: "#0f1722",
  panel: "#16202e",
  border: "#26384c",
  text: "#e8eef5",
  muted: "#93a4b8",
  accent: "#16d27a",
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
function crest(uri, name) {
  if (uri) {
    return h("img", {
      src: uri,
      width: 150,
      height: 150,
      style: { width: 150, height: 150, objectFit: "contain" },
    });
  }
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return h(
    "div",
    {
      style: {
        width: 150,
        height: 150,
        borderRadius: 75,
        backgroundColor: COLOR.panel,
        border: `2px solid ${COLOR.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 64,
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

export default async function handler(req) {
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  const g = (k) => searchParams.get(k) || "";

  // Short form: /og/<id> (rewritten to ?id=<id>). Rebuild the game's display
  // from the match id via /api/cardinfo (FotMob + KV cache); fall back to any
  // display fields passed directly in the query (legacy/no-id case).
  const fmid = g("id").replace(/^fm:/, "").trim();
  let card = null;
  if (/^\d+$/.test(fmid)) {
    try {
      const r = await fetch(`${url.origin}/api/cardinfo?id=${fmid}`, {
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.ok) card = j.card;
      }
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
