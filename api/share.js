/*
 * /api/share  (public path: /g) — per-game share landing page.
 *
 * Social crawlers (WhatsApp, Twitter/X, Facebook, iMessage, Slack, Discord)
 * don't run JavaScript, so they can't see the app's client-rendered match view.
 * This tiny server-rendered page gives each game its own Open Graph / Twitter
 * card — title, description and a custom preview image (/og, generated on the
 * fly) — then redirects real visitors into the app with the match open
 * (`/?match=<id>&date=<YYYY-MM-DD>`).
 *
 * Query (all optional except a sensible default):
 *   id           match id used to open the detail in-app (e.g. "fm:12345")
 *   date         YYYY-MM-DD — the day to load so the match is present
 *   home, away   team names
 *   hb, ab       team crest URLs               } forwarded to /og as-is
 *   comp, cb     competition name + badge URL  }
 *   score        e.g. "2 - 1"                  }
 *   status       e.g. "FT" / "LIVE" / "20:00"  }
 *   d            human date label, e.g. "Mon, 15 Jun 2026"
 */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

module.exports = (req, res) => {
  const q = req.query || {};
  const get = (k) => (q[k] == null ? "" : String(q[k]));

  const home = get("home") || "Home";
  const away = get("away") || "Away";
  const comp = get("comp");
  const score = get("score");
  const status = get("status");
  const dLabel = get("d");
  const id = get("id");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "";

  // Absolute origin (Vercel sits behind a proxy, so trust the forwarded host).
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  // The preview image forwards every display field to /og.
  const imgParams = new URLSearchParams();
  ["home", "away", "hb", "ab", "comp", "cb", "score", "status"].forEach((k) => {
    if (get(k)) imgParams.set(k, get(k));
  });
  if (dLabel) imgParams.set("date", dLabel);
  const imageUrl = `${origin}/og?${imgParams.toString()}`;

  // The page's own canonical URL (what gets unfurled).
  const shareUrl = `${origin}/g?${new URLSearchParams(
    Object.keys(q).reduce((o, k) => ((o[k] = get(k)), o), {})
  ).toString()}`;

  // Where a real visitor lands: the app, with this match open.
  const appUrl =
    "/" +
    (id || date
      ? "?" +
        new URLSearchParams(
          Object.assign(id ? { match: id } : {}, date ? { date: date } : {})
        ).toString()
      : "");

  const vs = `${home} vs ${away}`;
  const title = `${vs}${comp ? " — " + comp : ""} · Hoje Há Bola`;
  const result = score ? `${score} (${status || "FT"})` : status ? status : "";
  const when = [dLabel, result].filter(Boolean).join(" · ");
  const description =
    `${vs}${comp ? " · " + comp : ""}${when ? " · " + when : ""}. ` +
    "See which TV channels and streaming services are broadcasting it — free or paid.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="${esc(origin + appUrl)}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="Hoje Há Bola" />
<meta property="og:title" content="${esc(vs + (comp ? " — " + comp : ""))}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(vs + (comp ? " — " + comp : ""))}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(vs + (comp ? " — " + comp : ""))}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(imageUrl)}" />
<meta name="twitter:image:alt" content="${esc(vs + (comp ? " — " + comp : ""))}" />

<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
<script>location.replace(${JSON.stringify(appUrl)});</script>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:#0f1722;color:#e8eef5;display:flex;min-height:100vh;align-items:center;
    justify-content:center;text-align:center;padding:24px}
  a{color:#16d27a;font-weight:700;text-decoration:none}
  .ball{font-size:48px}
</style>
</head>
<body>
  <div>
    <div class="ball">⚽</div>
    <h1>${esc(vs)}</h1>
    <p>${esc(comp)}${when ? " · " + esc(when) : ""}</p>
    <p><a href="${esc(appUrl)}">Open ${esc(vs)} on Hoje Há Bola →</a></p>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  res.status(200).send(html);
};
