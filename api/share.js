/*
 * /api/share  (public path: /g/<id>) — per-game share landing page.
 *
 * Social crawlers (WhatsApp, Twitter/X, Facebook, iMessage, Slack, Discord)
 * don't run JavaScript, so they can't see the app's client-rendered match view.
 * This tiny server-rendered page gives each game its own Open Graph / Twitter
 * card — title, description and a custom preview image (/og/<id>) — then
 * redirects real visitors into the app with the match open
 * (`/?match=fm:<id>&date=<YYYY-MM-DD>`).
 *
 * The game's display (teams, competition, score, date) is rebuilt server-side
 * from the match id alone via api/cardinfo (FotMob + KV cache), so the shared
 * link is short: /g/4667790. A legacy query form (?home=&away=&…) is still
 * honoured for back-compat and for the rare match that has no FotMob id.
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

  const fmid = get("id").replace(/^fm:/, "").trim();
  const hasId = /^\d+$/.test(fmid);

  // Prefer rebuilding from the id; fall back to any display fields in the query.
  let card = null;
  if (hasId) {
    const r = await getCard(fmid).catch(() => null);
    if (r && r.ok) card = r.card;
  }

  const home = (card && card.home) || get("home") || "Home";
  const away = (card && card.away) || get("away") || "Away";
  const comp = (card && card.comp) || get("comp");
  const score = (card && card.score) || get("score");
  const status = (card && card.status) || get("status");
  const dLabel = (card && card.date) || get("d");
  const isoDate = (card && card.isoDate) || (/^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : "");

  // Preview image: short /og/<id> when we have one, else legacy query form.
  let imageUrl;
  if (hasId) {
    imageUrl = `${origin}/og/${fmid}`;
  } else {
    const p = new URLSearchParams();
    ["home", "away", "hb", "ab", "comp", "cb", "score", "status"].forEach((k) => {
      if (get(k)) p.set(k, get(k));
    });
    if (dLabel) p.set("date", dLabel);
    imageUrl = `${origin}/og?${p.toString()}`;
  }

  // Where a real visitor lands: the app, with this match open on its day.
  const appParams = new URLSearchParams();
  if (hasId) appParams.set("match", "fm:" + fmid);
  else if (get("id")) appParams.set("match", get("id"));
  if (isoDate) appParams.set("date", isoDate);
  const appUrl = "/" + (appParams.toString() ? "?" + appParams.toString() : "");

  const shareUrl = hasId ? `${origin}/g/${fmid}` : `${origin}/g?${new URLSearchParams(
    Object.keys(q).reduce((o, k) => ((o[k] = get(k)), o), {})
  ).toString()}`;

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
