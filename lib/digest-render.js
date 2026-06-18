/*
 * lib/digest-render — builders for the day-digest pages:
 *   /today  a shareable page whose OG card unfurls into /og/today, plus the
 *           day's top games as server-side HTML + ItemList JSON-LD (Portuguese).
 *   /image  a preview + download tool for that image. The card is drawn entirely
 *           on a client-side <canvas>: it fetches the day's fixtures from
 *           /api/fixtures (the same call the live app makes, so it works even
 *           when the server-rendered /og/today can't reach upstream), supports a
 *           highlighted game, three formats (landscape/square/story) and
 *           Portuguese copy, and pulls crests through the /api/crest proxy so the
 *           canvas stays exportable. Download/Open use canvas.toBlob.
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
    return new Intl.DateTimeFormat("pt-PT", {
      timeZone: "UTC", weekday: "long", day: "2-digit", month: "long", year: "numeric",
    }).format(new Date(ymd + "T12:00:00Z"));
  } catch (e) { return ymd; }
}
function resultOf(f) {
  const hasScore = f.homeScore != null && f.homeScore !== "" &&
    f.awayScore != null && f.awayScore !== "";
  // Upstream can report a premature 0-0 before kickoff, so only show the score
  // once the game is live or finished (phase !== 1); otherwise show its time.
  if (hasScore && phase(f) !== 1) return `${f.homeScore}–${f.awayScore}`;
  return fmtTime(f.kickoff) || "";
}
function statusLabel(f) {
  const ph = phase(f);
  if (ph === 0) return (f.status || "AO VIVO").toUpperCase();
  if (ph === 2) return "FIM";
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

// Image formats offered by the /image tool (label + the ?n cap so the UI never
// offers more games than the chosen canvas renders).
const IMAGE_FORMATS = [
  { id: "landscape", label: "Paisagem (1200×630)", maxN: 6, nOpts: [3, 4, 5, 6] },
  { id: "square", label: "Quadrado (1080×1080)", maxN: 7, nOpts: [4, 5, 6, 7] },
  { id: "story", label: "Story (1080×1920)", maxN: 12, nOpts: [5, 6, 8, 10, 12] },
];

export function clampNImage(raw) {
  let n = parseInt(raw || "5", 10);
  if (!Number.isFinite(n)) n = 5;
  return Math.max(1, Math.min(12, n));
}
export function pickFormat(raw) {
  return IMAGE_FORMATS.some((f) => f.id === raw) ? raw : "landscape";
}
export function pickHighlight(raw) {
  const hl = String(raw || "").replace(/^fm:/, "");
  return /^\d+$/.test(hl) ? hl : "";
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

  const whenWord = isToday ? "hoje" : "neste dia";
  const headline = isToday ? "Os grandes jogos de hoje" : "Os grandes jogos do dia";
  const title = `${headline} — onde ver na TV · Hoje Há Bola`;
  const matchupList = top.slice(0, 4).map((f) => `${f.home} vs ${f.away}`).join(", ");
  const description = top.length
    ? `${matchupList}${top.length > 4 ? " e mais" : ""} — vê em que canais de TV e serviços de streaming passam, grátis ou pagos.`
    : `Os maiores jogos de futebol do dia e onde os ver na TV.`;

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
    : `<p class="muted">Sem jogos de relevo ${esc(whenWord)}. Volta em breve, ou vê todos os jogos na app.</p>`;

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <div class="date">${esc(dLabel)}</div>
    <h1>${esc(headline)}</h1>
    <p class="muted">Os maiores jogos ${esc(whenWord)} — e onde ver cada um na TV, grátis ou pago.</p>

    <a class="cta" href="${esc(appUrl)}">Abrir a app — todos os jogos e canais de TV →</a>

    ${listSection}

    <p><a class="tool" href="/image?date=${ogDate}">⬇ Descarregar como imagem para partilhar →</a></p>

    <footer>
      <a href="/">Hoje Há Bola</a> — futebol na TV, em todo o mundo. Horas em Europe/Lisbon.
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
  .controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;background:var(--panel);
    border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:18px}
  .field{display:flex;align-items:center;gap:6px}
  .field.grow{flex:1 1 220px}
  .controls label{color:var(--muted);font-size:.85rem}
  button,select,input[type=date]{font:inherit;color:var(--txt);background:#0f1a26;
    border:1px solid var(--line);border-radius:8px;padding:8px 12px;cursor:pointer}
  select#highlight{flex:1;min-width:0}
  button:hover{border-color:var(--accent)}
  .nav button{min-width:40px;font-weight:700}
  .preview{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;
    display:flex;justify-content:center;align-items:center;min-height:200px}
  .preview canvas{max-width:100%;max-height:78vh;width:auto;height:auto;border-radius:8px;display:block}
  .preview.busy::after{content:"a carregar…";position:absolute;color:var(--muted);font-size:.9rem}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:800;padding:12px 18px;border-radius:10px;
    border:none;cursor:pointer}
  .btn.primary{background:var(--accent);color:#062013}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  .btn.ghost:hover{border-color:var(--accent)}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:28px}
  .hint{color:var(--muted);font-size:.85rem;margin-top:10px}
`;

// Per-format canvas geometry for the client renderer (CSS px at native res).
const CANVAS_FORMATS = {
  landscape: { W: 1200, H: 630, pad: 56, accent: 10, brandDot: 24, brandFont: 28, titleFont: 40, dateFont: 28, tagFont: 20, rowH: 66, rowGap: 10, nameFont: 28, crest: 46, scoreFont: 30, badge: 34, scoreHalf: 78, gap: 16, heroH: 248, heroGap: 16, heroCompFont: 22, heroName: 36, heroCrest: 96, heroScore: 64, heroStatusFont: 22, heroBadge: 32, heroScoreHalf: 96, emptyFont: 40 },
  square: { W: 1080, H: 1080, pad: 64, accent: 12, brandDot: 28, brandFont: 32, titleFont: 48, dateFont: 28, tagFont: 22, rowH: 88, rowGap: 14, nameFont: 32, crest: 56, scoreFont: 34, badge: 40, scoreHalf: 84, gap: 18, heroH: 340, heroGap: 20, heroCompFont: 26, heroName: 44, heroCrest: 140, heroScore: 84, heroStatusFont: 26, heroBadge: 42, heroScoreHalf: 120, emptyFont: 46 },
  story: { W: 1080, H: 1920, pad: 72, accent: 16, brandDot: 34, brandFont: 40, titleFont: 60, dateFont: 34, tagFont: 28, rowH: 108, rowGap: 18, nameFont: 40, crest: 68, scoreFont: 44, badge: 50, scoreHalf: 96, gap: 20, heroH: 440, heroGap: 26, heroCompFont: 32, heroName: 56, heroCrest: 184, heroScore: 112, heroStatusFont: 32, heroBadge: 54, heroScoreHalf: 150, emptyFont: 58 },
};

export function buildImage({ date, n, format, highlight }) {
  const today = todayYmd();
  const fmt = pickFormat(format);

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <h1>Descarregar imagem dos jogos do dia</h1>
    <p class="lead">Escolhe o dia, o formato e o jogo em destaque, pré-visualiza e descarrega para partilhar nas redes.</p>

    <div class="controls">
      <div class="field">
        <span class="nav"><button id="prev" type="button" aria-label="Dia anterior">◀</button></span>
        <label for="date">Data</label>
        <input type="date" id="date" value="${esc(date)}" />
        <span class="nav"><button id="next" type="button" aria-label="Dia seguinte">▶</button></span>
        <button id="today" type="button">Hoje</button>
      </div>
      <div class="field">
        <label for="format">Formato</label>
        <select id="format">
          ${IMAGE_FORMATS.map((f) => `<option value="${f.id}"${f.id === fmt ? " selected" : ""}>${esc(f.label)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="n">Jogos na lista</label>
        <select id="n"></select>
      </div>
      <div class="field grow">
        <label for="highlight">Em destaque</label>
        <select id="highlight"><option value="">— Sem destaque —</option></select>
      </div>
    </div>

    <div class="preview" id="preview">
      <canvas id="canvas" role="img" aria-label="Principais jogos de futebol"></canvas>
    </div>

    <div class="actions">
      <button class="btn primary" id="dl" type="button">⬇ Descarregar imagem</button>
      <button class="btn ghost" id="open" type="button">Abrir em tamanho real</button>
      <a class="btn ghost" id="share" href="/today?date=${esc(date)}">Página para partilhar →</a>
    </div>
    <p class="hint">A imagem é desenhada no teu navegador e atualiza com os resultados ao vivo e as horas de início. Horas em Europe/Lisbon.</p>

    <footer><a href="/">Hoje Há Bola</a> — futebol na TV, em todo o mundo.</footer>
  </div>`;

  const scriptJs = `
  (function () {
    var TODAY = ${JSON.stringify(today)};
    var FORMATS = ${JSON.stringify(IMAGE_FORMATS.reduce((o, f) => ((o[f.id] = f.nOpts), o), {}))};
    var FMT = ${JSON.stringify(CANVAS_FORMATS)};
    var RANK_POS = {};
    ${JSON.stringify(RANK_IDS)}.forEach(function (id, i) { RANK_POS[id] = i; });

    var C = { bg:"#0f1722", panel:"#16202e", border:"#26384c", text:"#e8eef5", muted:"#93a4b8", accent:"#16d27a", live:"#ff5470" };
    var FF = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

    var canvas = document.getElementById("canvas");
    var ctx = canvas.getContext("2d");
    var preview = document.getElementById("preview");
    var dl = document.getElementById("dl");
    var openBtn = document.getElementById("open");
    var share = document.getElementById("share");
    var dateEl = document.getElementById("date");
    var nEl = document.getElementById("n");
    var fmtEl = document.getElementById("format");
    var hlEl = document.getElementById("highlight");

    var wantN = ${JSON.stringify(String(n))};
    var wantHighlight = ${JSON.stringify(highlight || "")};
    var fxToken = 0, paintToken = 0;
    var currentFixtures = [];

    function shift(ymd, days) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    function setFont(px, weight) { ctx.font = (weight || "400") + " " + px + "px " + FF; }
    function phase(f) { var s = (f.status || "").toUpperCase(); if (s && s !== "FT") return 0; if (!s) return 1; return 2; }
    function fmtTime(iso) {
      try { return new Intl.DateTimeFormat("pt-PT", { timeZone:"Europe/Lisbon", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(iso)); }
      catch (e) { return ""; }
    }
    function fmtDate(ymd) {
      try { return new Intl.DateTimeFormat("pt-PT", { timeZone:"UTC", weekday:"short", day:"2-digit", month:"short", year:"numeric" }).format(new Date(ymd + "T12:00:00Z")); }
      catch (e) { return ymd; }
    }
    function resultOf(f) {
      var hs = f.homeScore, as = f.awayScore;
      // Show the score only once the game is live or finished (phase !== 1);
      // an upcoming game can carry a premature 0-0, so show its kickoff time.
      if (hs != null && hs !== "" && as != null && as !== "" && phase(f) !== 1) return hs + " - " + as;
      return fmtTime(f.kickoff) || "—";
    }
    function statusPill(f) {
      var ph = phase(f);
      if (ph === 0) { var t = (f.status || "AO VIVO"); return { t: t.length > 6 ? t.slice(0,6) : t, c: C.live }; }
      if (ph === 2) return { t: "FIM", c: C.muted };
      return null;
    }
    function rankCmp(a, b) {
      var ra = RANK_POS[a.leagueId], rb = RANK_POS[b.leagueId];
      ra = ra == null ? 999 : ra; rb = rb == null ? 999 : rb;
      if (ra !== rb) return ra - rb;
      var pa = phase(a), pb = phase(b);
      if (pa !== pb) return pa - pb;
      return String(a.kickoff || "").localeCompare(String(b.kickoff || ""));
    }
    function ellipsize(text, maxW) {
      text = String(text == null ? "" : text);
      if (ctx.measureText(text).width <= maxW) return text;
      var t = text;
      while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
      return t + "…";
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function circle(cx, cy, r, fill) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); }
    function drawContain(im, cx, cy, size) {
      if (!im) return;
      var r = Math.min(size / im.naturalWidth, size / im.naturalHeight);
      var w = im.naturalWidth * r, hh = im.naturalHeight * r;
      ctx.drawImage(im, cx - w / 2, cy - hh / 2, w, hh);
    }
    function drawCrest(im, cx, cy, size, name) {
      if (im) { drawContain(im, cx, cy, size); return; }
      circle(cx, cy, size / 2, C.panel);
      ctx.lineWidth = 2; ctx.strokeStyle = C.border;
      ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.stroke();
      var ltr = (name || "?").trim().charAt(0).toUpperCase() || "?";
      setFont(Math.round(size * 0.42), "800"); ctx.fillStyle = C.muted;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ltr, cx, cy + 1);
    }

    var IMG = {}, IMGP = {};
    function loadImg(url) {
      if (!url) return Promise.resolve(null);
      if (IMGP[url]) return IMGP[url];
      IMGP[url] = new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () { IMG[url] = im; resolve(im); };
        im.onerror = function () { IMG[url] = null; resolve(null); };
        im.src = "/api/crest?u=" + encodeURIComponent(url);
      });
      return IMGP[url];
    }
    function img(url) { return url ? (IMG[url] || null) : null; }

    function pick() {
      var list = currentFixtures.slice();
      var hero = null, hl = hlEl.value;
      if (hl) for (var i = 0; i < list.length; i++) {
        if (String(list[i].fmid) === String(hl)) { hero = list.splice(i, 1)[0]; break; }
      }
      var num = parseInt(nEl.value, 10) || 5;
      return { hero: hero, top: list.slice(0, num) };
    }

    function drawRow(f, y, S) {
      var x = S.pad, w = S.W - 2 * S.pad, cx = S.W / 2, cy = y + S.rowH / 2;
      roundRect(x, y, w, S.rowH, 16); ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.stroke();
      var cb = img(f.leagueBadgeUrl);
      if (cb) drawContain(cb, x + 16 + S.badge / 2, cy, S.badge);
      var pill = statusPill(f), sy = pill ? cy - S.scoreFont * 0.16 : cy;
      setFont(S.scoreFont, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(resultOf(f), cx, sy);
      if (pill) { setFont(Math.round(S.scoreFont * 0.44), "800"); ctx.fillStyle = pill.c; ctx.fillText(pill.t, cx, sy + S.scoreFont * 0.66); }
      var hcx = cx - S.scoreHalf - S.gap - S.crest / 2;
      drawCrest(img(f.homeBadge), hcx, cy, S.crest, f.home);
      setFont(S.nameFont, "700"); ctx.fillStyle = C.text; ctx.textBaseline = "middle";
      var nameLeft = x + 16 + S.badge + 14, hRight = hcx - S.crest / 2 - 14;
      ctx.textAlign = "right"; ctx.fillText(ellipsize(f.home, hRight - nameLeft), hRight, cy);
      var acx = cx + S.scoreHalf + S.gap + S.crest / 2;
      drawCrest(img(f.awayBadge), acx, cy, S.crest, f.away);
      var aLeft = acx + S.crest / 2 + 14, aRight = x + w - 16;
      ctx.textAlign = "left"; ctx.fillText(ellipsize(f.away, aRight - aLeft), aLeft, cy);
    }

    function drawHero(f, y, S) {
      var x = S.pad, w = S.W - 2 * S.pad, cx = S.W / 2;
      roundRect(x, y, w, S.heroH, 22); ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.stroke();
      var comp = f.competition || "", compY = y + 26 + S.heroCompFont / 2;
      setFont(S.heroCompFont, "600"); ctx.textBaseline = "middle";
      var label = ellipsize(comp, w * 0.7), tw = comp ? ctx.measureText(label).width : 0;
      var cbimg = img(f.leagueBadgeUrl), total = tw + (cbimg ? S.heroBadge + 12 : 0), sx = cx - total / 2;
      if (cbimg) { drawContain(cbimg, sx + S.heroBadge / 2, compY, S.heroBadge); sx += S.heroBadge + 12; }
      ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.fillText(label, sx, compY);
      var top = y + 26 + S.heroCompFont + 18, mid = (top + (y + S.heroH - 24)) / 2;
      var crestCy = mid - S.heroName * 0.5;
      var hcx = cx - S.heroScoreHalf - S.heroGap - S.heroCrest / 2;
      var acx = cx + S.heroScoreHalf + S.heroGap + S.heroCrest / 2;
      drawCrest(img(f.homeBadge), hcx, crestCy, S.heroCrest, f.home);
      drawCrest(img(f.awayBadge), acx, crestCy, S.heroCrest, f.away);
      var nameY = crestCy + S.heroCrest / 2 + S.heroName * 0.7;
      setFont(S.heroName, "700"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ellipsize(f.home, S.heroScoreHalf * 2.2), hcx, nameY);
      ctx.fillText(ellipsize(f.away, S.heroScoreHalf * 2.2), acx, nameY);
      var pill = statusPill(f);
      setFont(S.heroScore, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(resultOf(f), cx, crestCy);
      if (pill) { setFont(S.heroStatusFont, "800"); ctx.fillStyle = pill.c; ctx.fillText(pill.t, cx, crestCy + S.heroScore * 0.6); }
    }

    function draw(hero, top, S, isToday, d) {
      canvas.width = S.W; canvas.height = S.H;
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, S.W, S.H);
      ctx.fillStyle = C.accent; ctx.fillRect(0, 0, S.W, S.accent);

      var px = S.pad, brandY = S.pad + S.brandDot / 2 + 6;
      circle(px + S.brandDot / 2, brandY, S.brandDot / 2, C.accent);
      setFont(S.brandFont, "800"); ctx.textBaseline = "middle"; ctx.textAlign = "left";
      var bx = px + S.brandDot + 12;
      ctx.fillStyle = C.text; ctx.fillText("Hoje Há ", bx, brandY);
      ctx.fillStyle = C.accent; ctx.fillText("Bola", bx + ctx.measureText("Hoje Há ").width, brandY);
      var titleY = brandY + S.brandDot / 2 + 12 + S.titleFont / 2;
      setFont(S.titleFont, "800"); ctx.fillStyle = C.text; ctx.textAlign = "left";
      ctx.fillText(isToday ? "Jogos de hoje" : "Jogos do dia", px, titleY);
      setFont(S.dateFont, "700"); ctx.fillStyle = C.accent; ctx.textAlign = "right";
      ctx.fillText(fmtDate(d), S.W - px, brandY - S.tagFont * 0.5);
      setFont(S.tagFont, "400"); ctx.fillStyle = C.muted;
      ctx.fillText("Futebol na TV · onde ver", S.W - px, brandY + S.dateFont * 0.6);

      var contentTop = titleY + S.titleFont / 2 + 24, contentBottom = S.H - S.pad;
      if (!hero && top.length === 0) {
        var midY = (contentTop + contentBottom) / 2;
        setFont(S.emptyFont, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("Sem jogos para mostrar", S.W / 2, midY - S.emptyFont * 0.5);
        setFont(Math.round(S.emptyFont * 0.55), "600"); ctx.fillStyle = C.muted;
        ctx.fillText("Não há jogos de relevo agendados para este dia.", S.W / 2, midY + S.emptyFont * 0.6);
        return;
      }
      var blockH = (hero ? S.heroH + S.heroGap : 0) +
        (top.length ? top.length * S.rowH + (top.length - 1) * S.rowGap : 0);
      var startY = contentTop + Math.max(0, (contentBottom - contentTop - blockH) / 2);
      if (hero) { drawHero(hero, startY, S); startY += S.heroH + S.heroGap; }
      for (var i = 0; i < top.length; i++) drawRow(top[i], startY + i * (S.rowH + S.rowGap), S);
    }

    function updateState(d) {
      share.href = "/today?date=" + encodeURIComponent(d);
      var u = new URL(location.href);
      u.searchParams.set("date", d);
      if (nEl.value === "5") u.searchParams.delete("n"); else u.searchParams.set("n", nEl.value);
      if (fmtEl.value === "landscape") u.searchParams.delete("format"); else u.searchParams.set("format", fmtEl.value);
      if (hlEl.value) u.searchParams.set("highlight", hlEl.value); else u.searchParams.delete("highlight");
      history.replaceState(null, "", u);
    }

    function paint() {
      var d = dateEl.value || TODAY, S = FMT[fmtEl.value] || FMT.landscape;
      var sel = pick(), token = ++paintToken, urls = [];
      function add(f) { if (f) { if (f.homeBadge) urls.push(f.homeBadge); if (f.awayBadge) urls.push(f.awayBadge); if (f.leagueBadgeUrl) urls.push(f.leagueBadgeUrl); } }
      add(sel.hero); sel.top.forEach(add);
      preview.classList.add("busy");
      Promise.all(urls.map(loadImg)).then(function () {
        if (token !== paintToken) return;
        preview.classList.remove("busy");
        draw(sel.hero, sel.top, S, d === TODAY, d);
        updateState(d);
      });
    }

    function populateHighlight(list) {
      var keep = hlEl.value || wantHighlight;
      var games = list.filter(function (f) { return f.fmid; });
      hlEl.innerHTML = "<option value=\\"\\">— Sem destaque —</option>";
      games.forEach(function (f) {
        var o = document.createElement("option");
        o.value = String(f.fmid); o.textContent = f.home + " vs " + f.away;
        hlEl.appendChild(o);
      });
      hlEl.value = (keep && games.some(function (f) { return String(f.fmid) === String(keep); })) ? String(keep) : "";
      wantHighlight = "";
    }

    function loadFixtures() {
      var d = dateEl.value || TODAY, token = ++fxToken;
      preview.classList.add("busy");
      fetch("/api/fixtures?date=" + encodeURIComponent(d) + "&all=1", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { fixtures: [] }; })
        .catch(function () { return { fixtures: [] }; })
        .then(function (j) {
          if (token !== fxToken) return;
          var list = (j && j.fixtures ? j.fixtures : []).slice();
          list.sort(rankCmp);
          currentFixtures = list;
          populateHighlight(list);
          paint();
        });
    }

    function download() {
      var d = dateEl.value || TODAY;
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "hojehabola-jogos-" + d + "-" + fmtEl.value + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }, "image/png");
    }
    function openFull() {
      canvas.toBlob(function (blob) { if (blob) window.open(URL.createObjectURL(blob), "_blank", "noopener"); }, "image/png");
    }

    function syncNOptions() {
      var opts = FORMATS[fmtEl.value] || FORMATS.landscape;
      var prev = parseInt(nEl.value || wantN, 10);
      nEl.innerHTML = "";
      opts.forEach(function (v) {
        var o = document.createElement("option");
        o.value = String(v); o.textContent = String(v);
        nEl.appendChild(o);
      });
      var sel = opts.indexOf(prev) !== -1 ? prev : opts[opts.length - 1];
      if (prev > opts[opts.length - 1]) sel = opts[opts.length - 1];
      nEl.value = String(sel);
    }

    document.getElementById("prev").addEventListener("click", function () { dateEl.value = shift(dateEl.value || TODAY, -1); loadFixtures(); });
    document.getElementById("next").addEventListener("click", function () { dateEl.value = shift(dateEl.value || TODAY, 1); loadFixtures(); });
    document.getElementById("today").addEventListener("click", function () { dateEl.value = TODAY; loadFixtures(); });
    dateEl.addEventListener("change", loadFixtures);
    fmtEl.addEventListener("change", function () { syncNOptions(); paint(); });
    nEl.addEventListener("change", paint);
    hlEl.addEventListener("change", paint);
    dl.addEventListener("click", download);
    openBtn.addEventListener("click", openFull);

    syncNOptions();
    loadFixtures();
  })();
  `;

  return {
    robots: "noindex, follow",
    title: "Descarregar imagem dos jogos do dia · Hoje Há Bola",
    description: "Pré-visualiza e descarrega uma imagem partilhável dos principais jogos de futebol para qualquer dia.",
    css: IMAGE_CSS, bodyHtml, scriptJs,
  };
}
