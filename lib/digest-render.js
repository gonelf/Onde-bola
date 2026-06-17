/*
 * lib/digest-render — builders for the day-digest pages, ported from
 * lib/digest-page.js:
 *   /today  a shareable page whose OG card unfurls into /og/today, plus the
 *           day's top games as server-side HTML + ItemList JSON-LD.
 *   /image  a preview + download tool for that image (date picker + buttons).
 */

const TZ = "Europe/Lisbon";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
export function todayYmd() {
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
    const lr = leagueRank(a) - leagueRank(b);
    if (lr) return lr;
    const ph = phase(a) - phase(b);
    if (ph) return ph;
    return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
  });
  return list.slice(0, n);
}

export function clampN(raw) {
  let n = parseInt(raw || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  return Math.max(1, Math.min(6, n));
}

const TODAY_CSS = `
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
`;

export async function buildToday({ origin, date, n }) {
  const isToday = date === todayYmd();
  const data = await getJson(`${origin}/api/fixtures?date=${date}&all=1`, 6000);
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

  const bodyHtml = `<div class="wrap">
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
  </div>`;

  return {
    robots: "index, follow, max-image-preview:large",
    title, description, headline,
    canonical: shareUrl, ogImage: imageUrl,
    css: TODAY_CSS, bodyHtml, jsonLd: JSON.stringify(itemList),
  };
}

const IMAGE_CSS = `
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
`;

export function buildImage({ date, n }) {
  const today = todayYmd();
  const bodyHtml = `<div class="wrap">
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
  </div>`;

  const scriptJs = `
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
  `;

  return {
    robots: "noindex, follow",
    title: "Download the top-games image · Hoje Há Bola",
    description: "Preview and download a shareable image of the day's top football games for any date.",
    css: IMAGE_CSS, bodyHtml, scriptJs,
  };
}
