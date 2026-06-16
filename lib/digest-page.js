/*
 * lib/digest-page — the two human pages for the day's top games:
 *
 *   /today  (view=today)  a shareable page whose Open Graph / Twitter card
 *                         unfurls into the /og/today digest image, plus the same
 *                         fixtures as server-side HTML and ItemList JSON-LD.
 *   /image  (view=image)  a tool to preview and download that image for any
 *                         date (date picker + Download button).
 *
 * Both are served by /api/share (so they don't add Serverless Functions — the
 * Hobby plan caps a deployment at 12). The image itself is drawn by /og/today.
 *
 * Query: ?date=YYYY-MM-DD (defaults to today, Europe/Lisbon) [&n=1..6]
 */

const TZ = "Europe/Lisbon";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

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

// Competition prominence (kept in sync with /api/og's digest): lower = first.
const RANK = [
  /champions league/i, /europa league/i, /conference league/i, /world cup/i,
  /european championship|\beuro\b/i, /copa am[eé]rica/i, /nations league/i,
  /premier league/i, /la ?liga|primera divisi/i, /serie a/i, /bundesliga/i,
  /ligue 1/i, /primeira liga|liga portugal/i, /libertadores/i, /eredivisie/i,
  /mls/i, /saudi pro/i,
];
function leagueRank(comp) {
  for (let i = 0; i < RANK.length; i++) if (RANK[i].test(comp || "")) return i;
  return RANK.length;
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
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(ymd + "T12:00:00Z"));
  } catch (e) { return ymd; }
}
function resultOf(f) {
  const hasScore = f.homeScore != null && f.homeScore !== "" &&
    f.awayScore != null && f.awayScore !== "";
  if (hasScore) return `${f.homeScore}–${f.awayScore}`;
  return fmtTime(f.kickoff) || "";
}
function statusLabel(f) {
  const ph = phase(f);
  if (ph === 0) return (f.status || "LIVE").toUpperCase();
  if (ph === 2) return "FT";
  return "";
}

function sortedTop(fixtures, n) {
  const list = (fixtures || []).slice();
  list.sort((a, b) => {
    const lr = leagueRank(a.competition) - leagueRank(b.competition);
    if (lr) return lr;
    const ph = phase(a) - phase(b);
    if (ph) return ph;
    return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
  });
  return list.slice(0, n);
}

// --- /today : shareable digest page ---------------------------------------
async function renderToday(res, { origin, date, n }) {
  const isToday = date === todayYmd();
  const data = await getJson(`${origin}/api/fixtures?date=${date}`, 6000);
  const top = sortedTop(data && data.fixtures, n);

  const dLabel = fmtDate(date);
  const ogDate = encodeURIComponent(date);
  const imageUrl = `${origin}/og/today?date=${ogDate}&n=${n}`;
  const shareUrl = isToday ? `${origin}/today` : `${origin}/today?date=${ogDate}`;
  const appUrl = "/" + (isToday ? "" : `?date=${ogDate}`);

  const whenWord = isToday ? "today" : `on ${dLabel}`;
  const title = `Top football games ${whenWord} — where to watch on TV · Hoje Há Bola`;
  const headline = `Top football games ${whenWord}`;
  const matchupList = top.slice(0, 4).map((f) => `${f.home} vs ${f.away}`).join(", ");
  const description = top.length
    ? `${matchupList}${top.length > 4 ? " and more" : ""} — see which TV channels and streaming services are broadcasting them, free or paid.`
    : `The day's biggest football fixtures and where to watch them on TV.`;

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: headline,
    url: shareUrl,
    numberOfItems: top.length,
    itemListElement: top.map((f, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: Object.assign(
        {
          "@type": "SportsEvent",
          name: `${f.home} vs ${f.away}` + (f.competition ? ` — ${f.competition}` : ""),
          sport: "Soccer",
          homeTeam: { "@type": "SportsTeam", name: f.home },
          awayTeam: { "@type": "SportsTeam", name: f.away },
          isAccessibleForFree: true,
        },
        f.kickoff ? { startDate: f.kickoff } : {}
      ),
    })),
  };

  const badge = (url, name) => url
    ? `<img class="crest" src="${esc(url)}" alt="${esc(name)} crest" width="28" height="28" loading="lazy" />`
    : "";

  const rows = top.map((f) => {
    const st = statusLabel(f);
    const live = phase(f) === 0;
    return `<li class="game">
      <span class="comp">${esc(f.competition || "")}</span>
      <span class="side home">${esc(f.home)} ${badge(f.homeBadge, f.home)}</span>
      <span class="res">${esc(resultOf(f))}${st ? `<span class="st ${live ? "live" : ""}">${esc(st)}</span>` : ""}</span>
      <span class="side away">${badge(f.awayBadge, f.away)} ${esc(f.away)}</span>
    </li>`;
  }).join("");

  const listSection = top.length
    ? `<ul class="games">${rows}</ul>`
    : `<p class="muted">No major games scheduled ${esc(whenWord)}. Check back soon, or browse every fixture in the app.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="${esc(shareUrl)}" />

<meta property="og:type" content="website" />
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
<script type="application/ld+json">${JSON.stringify(itemList)}</script>
<style>
  :root{--bg:#0f1722;--panel:#16202e;--line:#243244;--txt:#e8eef5;--muted:#9fb0c3;--accent:#16d27a;--live:#ff5470}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--txt);line-height:1.5}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:20px 16px 48px}
  header.site{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:18px}
  h1{font-size:1.6rem;margin:.2em 0}
  .date{color:var(--accent);font-weight:700;margin-bottom:4px}
  .cta{display:block;text-align:center;background:var(--accent);color:#062013;font-weight:800;
    padding:12px 16px;border-radius:10px;margin:18px 0}
  .games{list-style:none;padding:0;margin:14px 0}
  .game{display:grid;grid-template-columns:1fr auto 1fr;grid-template-areas:"comp comp comp" "home res away";
    gap:6px 12px;align-items:center;background:var(--panel);border:1px solid var(--line);
    border-radius:12px;padding:12px 16px;margin:10px 0}
  .comp{grid-area:comp;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .side{display:flex;align-items:center;gap:8px;font-weight:700}
  .home{grid-area:home;justify-content:flex-end;text-align:right}
  .away{grid-area:away;justify-content:flex-start}
  .res{grid-area:res;text-align:center;font-weight:800;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px}
  .st{font-size:.62rem;font-weight:800;color:var(--muted)}
  .st.live{color:var(--live)}
  .crest{object-fit:contain}
  .muted{color:var(--muted)}
  .tool{display:inline-block;margin-top:6px;font-size:.9rem}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:24px}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <div class="date">${esc(dLabel)}</div>
    <h1>${esc(headline)}</h1>
    <p class="muted">The biggest fixtures ${esc(whenWord)} — and where to watch each on TV, free or paid.</p>

    <a class="cta" href="${esc(appUrl)}">Open the live app — all games &amp; TV listings →</a>

    ${listSection}

    <p><a class="tool" href="/image?date=${ogDate}">⬇ Download this as an image to share →</a></p>

    <footer>
      <a href="/">Hoje Há Bola</a> — football on TV, worldwide. Times shown in Europe/Lisbon.
    </footer>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
}

// --- /image : preview + download tool -------------------------------------
function renderImage(res, { date, n }) {
  const today = todayYmd();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Download the top-games image · Hoje Há Bola</title>
<meta name="description" content="Preview and download a shareable image of the day's top football games for any date." />
<meta name="robots" content="noindex, follow" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚽</text></svg>" />
<style>
  :root{--bg:#0f1722;--panel:#16202e;--line:#243244;--txt:#e8eef5;--muted:#9fb0c3;--accent:#16d27a}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    background:var(--bg);color:var(--txt);line-height:1.5}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:880px;margin:0 auto;padding:20px 16px 56px}
  header.site{display:flex;align-items:center;gap:8px;font-weight:700;margin-bottom:14px}
  h1{font-size:1.5rem;margin:.2em 0}
  p.lead{color:var(--muted);margin:.2em 0 18px}
  .controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:18px}
  .controls label{color:var(--muted);font-size:.85rem;margin-right:4px}
  button,select,input[type=date]{font:inherit;color:var(--txt);background:#0f1a26;
    border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  .nav button{min-width:40px;font-weight:700}
  .spacer{flex:1}
  .preview{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;
    display:flex;justify-content:center}
  .preview img{width:100%;max-width:1200px;height:auto;border-radius:8px;display:block}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:800;padding:12px 18px;border-radius:10px}
  .btn.primary{background:var(--accent);color:#062013;border:none}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  .btn.ghost:hover{border-color:var(--accent)}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:28px}
  .hint{color:var(--muted);font-size:.85rem;margin-top:10px}
</style>
</head>
<body>
  <div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <h1>Download the top-games image</h1>
    <p class="lead">Pick a date, preview the card, and download it to share on social.</p>

    <div class="controls">
      <span class="nav"><button id="prev" type="button" aria-label="Previous day">◀</button></span>
      <label for="date">Date</label>
      <input type="date" id="date" value="${esc(date)}" />
      <span class="nav"><button id="next" type="button" aria-label="Next day">▶</button></span>
      <button id="today" type="button">Today</button>
      <span class="spacer"></span>
      <label for="n">Games</label>
      <select id="n">
        ${[3, 4, 5, 6].map((v) => `<option value="${v}"${v === n ? " selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>

    <div class="preview">
      <img id="img" alt="Top football games" src="/og/today?date=${esc(date)}&n=${n}" />
    </div>

    <div class="actions">
      <a class="btn primary" id="dl" href="/og/today?date=${esc(date)}&n=${n}" download="hojehabola-top-games-${esc(date)}.png">⬇ Download image</a>
      <a class="btn ghost" id="open" href="/og/today?date=${esc(date)}&n=${n}" target="_blank" rel="noopener">Open full size</a>
      <a class="btn ghost" id="share" href="/today?date=${esc(date)}">Shareable page →</a>
    </div>
    <p class="hint">The image updates with live scores and kickoff times. Times shown in Europe/Lisbon.</p>

    <footer><a href="/">Hoje Há Bola</a> — football on TV, worldwide.</footer>
  </div>

  <script>
  (function () {
    var TODAY = ${JSON.stringify(today)};
    var img = document.getElementById("img");
    var dl = document.getElementById("dl");
    var open = document.getElementById("open");
    var share = document.getElementById("share");
    var dateEl = document.getElementById("date");
    var nEl = document.getElementById("n");

    function shift(ymd, days) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    function render() {
      var d = dateEl.value || TODAY;
      var n = nEl.value;
      var src = "/og/today?date=" + encodeURIComponent(d) + "&n=" + n;
      img.src = src;
      dl.href = src;
      dl.setAttribute("download", "hojehabola-top-games-" + d + ".png");
      open.href = src;
      share.href = "/today?date=" + encodeURIComponent(d);
      var u = new URL(location.href);
      u.searchParams.set("date", d);
      if (n === "5") u.searchParams.delete("n"); else u.searchParams.set("n", n);
      history.replaceState(null, "", u);
    }
    document.getElementById("prev").addEventListener("click", function () {
      dateEl.value = shift(dateEl.value || TODAY, -1); render();
    });
    document.getElementById("next").addEventListener("click", function () {
      dateEl.value = shift(dateEl.value || TODAY, 1); render();
    });
    document.getElementById("today").addEventListener("click", function () {
      dateEl.value = TODAY; render();
    });
    dateEl.addEventListener("change", render);
    nEl.addEventListener("change", render);
  })();
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");
  res.status(200).send(html);
}

// Dispatcher used by /api/share for ?view=today|image.
async function renderDigestPage(req, res, { view, origin, get }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(get("date")) ? get("date") : todayYmd();
  let n = parseInt(get("n") || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  n = Math.max(1, Math.min(6, n));

  if (view === "image") return renderImage(res, { date, n });
  return renderToday(res, { origin, date, n });
}

module.exports = { renderDigestPage };
