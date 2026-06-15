/*
 * /api/share  (public path: /g/<date>/<home>-vs-<away>) — share landing page.
 *
 * Social crawlers (WhatsApp, Twitter/X, Facebook, iMessage, Slack, Discord)
 * don't run JavaScript, so they can't see the app's client-rendered match view.
 * This tiny server-rendered page gives each game its own Open Graph / Twitter
 * card — title, description and a custom preview image (/og/...) — then
 * redirects real visitors into the app with the match open.
 *
 * The link is a human, SEO-friendly slug — /g/2026-06-15/belgium-vs-egypt — and
 * the game's display is rebuilt server-side from it via api/cardinfo (the day's
 * fixtures + KV cache). Legacy forms (?id=<fotmob-id>, or the old ?home=&away=…
 * query) are still honoured for back-compat.
 */

const { getCard } = require("./cardinfo.js");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const get = (k) => (q[k] == null ? "" : String(q[k]));

  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "hojehabola.com";
  const origin = `${proto}://${host}`;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "";
  const slug = get("slug");
  const fmid = get("id").replace(/^fm:/, "").trim();
  const hasSlug = !!(date && slug);
  const hasId = /^\d+$/.test(fmid);

  // Rebuild the card from the slug (preferred) or the legacy id.
  let card = null;
  if (hasSlug) {
    const r = await getCard({ origin, date, slug }).catch(() => null);
    if (r && r.ok) card = r.card;
  } else if (hasId) {
    const r = await getCard({ origin, id: fmid }).catch(() => null);
    if (r && r.ok) card = r.card;
  }

  const home = (card && card.home) || get("home") || "Home";
  const away = (card && card.away) || get("away") || "Away";
  const comp = (card && card.comp) || get("comp");
  const score = (card && card.score) || get("score");
  const status = (card && card.status) || get("status");
  const dLabel = (card && card.date) || get("d");
  // Deep-link day: the slug's own date, else whatever the card/legacy gives.
  const isoDate = date || (card && card.isoDate) || (/^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "");
  const openId = (card && card.fmid) || (hasId ? fmid : "");

  // Preview image + canonical share URL.
  let imageUrl, shareUrl;
  if (hasSlug) {
    imageUrl = `${origin}/og/${date}/${slug}`;
    shareUrl = `${origin}/g/${date}/${slug}`;
  } else if (hasId) {
    imageUrl = `${origin}/og/${fmid}`;
    shareUrl = `${origin}/g/${fmid}`;
  } else {
    const p = new URLSearchParams();
    ["home", "away", "hb", "ab", "comp", "cb", "score", "status"].forEach((k) => {
      if (get(k)) p.set(k, get(k));
    });
    if (dLabel) p.set("date", dLabel);
    imageUrl = `${origin}/og?${p.toString()}`;
    shareUrl = `${origin}/g?${new URLSearchParams(
      Object.keys(q).reduce((o, k) => ((o[k] = get(k)), o), {})
    ).toString()}`;
  }

  // Where a real visitor lands: the app, with this match open on its day.
  const appParams = new URLSearchParams();
  if (openId) appParams.set("match", "fm:" + openId);
  else if (!hasSlug && get("id")) appParams.set("match", get("id"));
  if (isoDate) appParams.set("date", isoDate);
  const appUrl = "/" + (appParams.toString() ? "?" + appParams.toString() : "");

  const vs = `${home} vs ${away}`;
  const headline = vs + (comp ? " — " + comp : "");
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
<meta property="og:title" content="${esc(headline)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(shareUrl)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(headline)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(headline)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(imageUrl)}" />
<meta name="twitter:image:alt" content="${esc(headline)}" />

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
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
};
