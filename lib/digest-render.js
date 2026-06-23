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

import { RANK_IDS, NOTABLE_RE, phase, selectTop } from "./digest-select";
import { flagMap } from "./country-flags";
import { FREE_TO_AIR } from "./broadcasters";

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
function fmtDate(ymd, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "pt-PT", {
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
function statusLabel(f, c) {
  const ph = phase(f);
  if (ph === 0) return (f.status || c.live).toUpperCase();
  if (ph === 2) return c.ft;
  return "";
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

// Per-language copy for the /today digest.
const DIGEST_COPY = {
  en: {
    locale: "en-GB", live: "LIVE", ft: "FT",
    whenToday: "today", whenDay: "on this day",
    headlineToday: "Today's big games", headlineDay: "The day's big games",
    title: (h) => `${h} — where to watch on TV · Hoje Há Bola`,
    desc: (list, more) => `${list}${more ? " and more" : ""} — see which TV channels and streaming services are showing them, free or paid.`,
    descEmpty: "The day's biggest football matches and where to watch them on TV.",
    noGames: (when) => `No major games ${when}. Check back soon, or see all games in the app.`,
    subtitle: (when) => `The biggest games ${when} — and where to watch each one on TV, free or paid.`,
    cta: "Open the app — all games and TV channels →",
    tool: "⬇ Download as a shareable image →",
    footer: "football on TV, worldwide. Times shown in Europe/Lisbon.",
  },
  pt: {
    locale: "pt-PT", live: "AO VIVO", ft: "FIM",
    whenToday: "hoje", whenDay: "neste dia",
    headlineToday: "Os grandes jogos de hoje", headlineDay: "Os grandes jogos do dia",
    title: (h) => `${h} — onde ver na TV · Hoje Há Bola`,
    desc: (list, more) => `${list}${more ? " e mais" : ""} — vê em que canais de TV e serviços de streaming passam, grátis ou pagos.`,
    descEmpty: "Os maiores jogos de futebol do dia e onde os ver na TV.",
    noGames: (when) => `Sem jogos de relevo ${when}. Volta em breve, ou vê todos os jogos na app.`,
    subtitle: (when) => `Os maiores jogos ${when} — e onde ver cada um na TV, grátis ou pago.`,
    cta: "Abrir a app — todos os jogos e canais de TV →",
    tool: "⬇ Descarregar como imagem para partilhar →",
    footer: "futebol na TV, em todo o mundo. Horas em Europe/Lisbon.",
  },
};

// Per-language copy for the /image download tool (page chrome + canvas script).
const IMAGE_COPY = {
  en: {
    locale: "en-GB", live: "LIVE", ft: "FT", loading: "loading…",
    title: "Download an image of the day's games · Hoje Há Bola",
    description: "Preview and download a shareable image of the day's top football matches for any day.",
    h1: "Download an image of the day's games",
    lead: "Choose the day, format and highlighted game, preview and download to share on social.",
    labelDate: "Date", labelFormat: "Format", labelN: "Games in list", labelHighlight: "Highlighted",
    prevDay: "Previous day", nextDay: "Next day", today: "Today",
    noHighlight: "— No highlight —", canvasAria: "Top football matches",
    download: "⬇ Download image", openFull: "Open full size", shareLink: "Shareable page →",
    hint: "The image is drawn in your browser and updates with live scores and kickoff times. Times in Europe/Lisbon.",
    footer: "football on TV, worldwide.",
    formatLabels: { landscape: "Landscape (1200×630)", square: "Square (1080×1080)", story: "Story (1080×1920)" },
    titleToday: "Today's games", titleDay: "The day's games",
    tag: "Football on TV · where to watch",
    emptyTitle: "No games to show", emptySub: "No major games scheduled for this day.",
    textTitle: "Text post",
    textLead: "A ready-to-post text version of the same games — copy and paste into WhatsApp, X or Instagram.",
    copyText: "📋 Copy text", copiedText: "✓ Copied!",
  },
  pt: {
    locale: "pt-PT", live: "AO VIVO", ft: "FIM", loading: "a carregar…",
    title: "Descarregar imagem dos jogos do dia · Hoje Há Bola",
    description: "Pré-visualiza e descarrega uma imagem partilhável dos principais jogos de futebol para qualquer dia.",
    h1: "Descarregar imagem dos jogos do dia",
    lead: "Escolhe o dia, o formato e o jogo em destaque, pré-visualiza e descarrega para partilhar nas redes.",
    labelDate: "Data", labelFormat: "Formato", labelN: "Jogos na lista", labelHighlight: "Em destaque",
    prevDay: "Dia anterior", nextDay: "Dia seguinte", today: "Hoje",
    noHighlight: "— Sem destaque —", canvasAria: "Principais jogos de futebol",
    download: "⬇ Descarregar imagem", openFull: "Abrir em tamanho real", shareLink: "Página para partilhar →",
    hint: "A imagem é desenhada no teu navegador e atualiza com os resultados ao vivo e as horas de início. Horas em Europe/Lisbon.",
    footer: "futebol na TV, em todo o mundo.",
    formatLabels: { landscape: "Paisagem (1200×630)", square: "Quadrado (1080×1080)", story: "Story (1080×1920)" },
    titleToday: "Jogos de hoje", titleDay: "Jogos do dia",
    tag: "Futebol na TV · onde ver",
    emptyTitle: "Sem jogos para mostrar", emptySub: "Não há jogos de relevo agendados para este dia.",
    textTitle: "Publicação em texto",
    textLead: "Uma versão em texto dos mesmos jogos, pronta a publicar — copia e cola no WhatsApp, X ou Instagram.",
    copyText: "📋 Copiar texto", copiedText: "✓ Copiado!",
  },
};

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

export async function buildToday({ origin, lang, date, n }) {
  const c = DIGEST_COPY[lang] || DIGEST_COPY.en;
  const isToday = date === todayYmd();
  const data = await getJson(`${origin}/api/fixtures?date=${date}&all=1`, 6000);
  const top = selectTop(data && data.fixtures, n);

  const dLabel = fmtDate(date, c.locale);
  const ogDate = encodeURIComponent(date);
  const imageUrl = `${origin}/og/today?date=${ogDate}&n=${n}`;
  const shareUrl = isToday ? `${origin}/today` : `${origin}/today?date=${ogDate}`;
  const appUrl = "/" + (isToday ? "" : `?date=${ogDate}`);

  const whenWord = isToday ? c.whenToday : c.whenDay;
  const headline = isToday ? c.headlineToday : c.headlineDay;
  const title = c.title(headline);
  const matchupList = top.slice(0, 4).map((f) => `${f.home} vs ${f.away}`).join(", ");
  const description = top.length
    ? c.desc(matchupList, top.length > 4)
    : c.descEmpty;

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
    const st = statusLabel(f, c);
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
    : `<p class="muted">${esc(c.noGames(whenWord))}</p>`;

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <div class="date">${esc(dLabel)}</div>
    <h1>${esc(headline)}</h1>
    <p class="muted">${esc(c.subtitle(whenWord))}</p>

    <a class="cta" href="${esc(appUrl)}">${esc(c.cta)}</a>

    ${listSection}

    <p><a class="tool" href="/image?date=${ogDate}">${esc(c.tool)}</a></p>

    <footer>
      <a href="/">Hoje Há Bola</a> — ${esc(c.footer)}
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
  .preview.busy::after{position:absolute;color:var(--muted);font-size:.9rem}
  .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
  .btn{display:inline-flex;align-items:center;gap:8px;font-weight:800;padding:12px 18px;border-radius:10px;
    border:none;cursor:pointer}
  .btn.primary{background:var(--accent);color:#062013}
  .btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}
  .btn.ghost:hover{border-color:var(--accent)}
  footer{color:var(--muted);font-size:.85rem;text-align:center;margin-top:28px}
  .hint{color:var(--muted);font-size:.85rem;margin-top:10px}
  .textpost{margin-top:26px}
  .textpost h2{font-size:1.15rem;margin:0 0 4px}
  .textpost p.lead{margin:0 0 12px}
  .textpost textarea{width:100%;min-height:188px;resize:vertical;font:inherit;line-height:1.5;
    color:var(--txt);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
  .textpost .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
`;

// Per-format canvas geometry for the client renderer (CSS px at native res).
const CANVAS_FORMATS = {
  landscape: { W: 1200, H: 630, pad: 56, accent: 10, brandDot: 24, brandFont: 28, titleFont: 40, dateFont: 28, tagFont: 20, rowH: 92, rowGap: 10, eyebrowBand: 28, vsFont: 20, eyebrowFont: 22, eyebrowLabelFont: 15, railCol: 150, railTime: 34, railLabel: 16, railChannel: 19, railGap: 5, nameFont: 28, crest: 46, scoreFont: 30, badge: 34, scoreHalf: 78, gap: 16, heroH: 270, heroGap: 16, heroCompFont: 22, heroName: 36, heroCrest: 96, heroScore: 64, heroVsFont: 34, heroEyebrowFont: 32, heroEyebrowLabelFont: 21, heroBadge: 32, heroScoreHalf: 96, emptyFont: 40 },
  square: { W: 1080, H: 1080, pad: 64, accent: 12, brandDot: 28, brandFont: 32, titleFont: 48, dateFont: 28, tagFont: 22, rowH: 122, rowGap: 14, eyebrowBand: 34, vsFont: 23, eyebrowFont: 26, eyebrowLabelFont: 18, railCol: 168, railTime: 40, railLabel: 18, railChannel: 22, railGap: 6, nameFont: 32, crest: 56, scoreFont: 34, badge: 40, scoreHalf: 84, gap: 18, heroH: 370, heroGap: 20, heroCompFont: 26, heroName: 44, heroCrest: 140, heroScore: 84, heroVsFont: 40, heroEyebrowFont: 40, heroEyebrowLabelFont: 26, heroBadge: 42, heroScoreHalf: 120, emptyFont: 46 },
  story: { W: 1080, H: 1920, pad: 72, accent: 16, brandDot: 34, brandFont: 40, titleFont: 60, dateFont: 34, tagFont: 28, rowH: 150, rowGap: 18, eyebrowBand: 42, vsFont: 26, eyebrowFont: 31, eyebrowLabelFont: 21, railCol: 210, railTime: 50, railLabel: 22, railChannel: 27, railGap: 7, nameFont: 40, crest: 68, scoreFont: 44, badge: 50, scoreHalf: 96, gap: 20, heroH: 480, heroGap: 26, heroCompFont: 32, heroName: 56, heroCrest: 184, heroScore: 112, heroVsFont: 52, heroEyebrowFont: 48, heroEyebrowLabelFont: 30, heroBadge: 54, heroScoreHalf: 150, emptyFont: 58 },
};

export function buildImage({ date, n, format, highlight, lang }) {
  const ic = IMAGE_COPY[lang] || IMAGE_COPY.en;
  const today = todayYmd();
  const fmt = pickFormat(format);

  const bodyHtml = `<div class="wrap">
    <header class="site"><span>⚽</span> <a href="/">Hoje Há Bola</a></header>
    <h1>${esc(ic.h1)}</h1>
    <p class="lead">${esc(ic.lead)}</p>

    <div class="controls">
      <div class="field">
        <span class="nav"><button id="prev" type="button" aria-label="${esc(ic.prevDay)}">◀</button></span>
        <label for="date">${esc(ic.labelDate)}</label>
        <input type="date" id="date" value="${esc(date)}" />
        <span class="nav"><button id="next" type="button" aria-label="${esc(ic.nextDay)}">▶</button></span>
        <button id="today" type="button">${esc(ic.today)}</button>
      </div>
      <div class="field">
        <label for="format">${esc(ic.labelFormat)}</label>
        <select id="format">
          ${IMAGE_FORMATS.map((f) => `<option value="${f.id}"${f.id === fmt ? " selected" : ""}>${esc(ic.formatLabels[f.id] || f.label)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label for="n">${esc(ic.labelN)}</label>
        <select id="n"></select>
      </div>
      <div class="field grow">
        <label for="highlight">${esc(ic.labelHighlight)}</label>
        <select id="highlight"><option value="">${esc(ic.noHighlight)}</option></select>
      </div>
    </div>

    <div class="preview" id="preview">
      <canvas id="canvas" role="img" aria-label="${esc(ic.canvasAria)}"></canvas>
    </div>

    <div class="actions">
      <button class="btn primary" id="dl" type="button">${esc(ic.download)}</button>
      <button class="btn ghost" id="open" type="button">${esc(ic.openFull)}</button>
      <a class="btn ghost" id="share" href="/today?date=${esc(date)}">${esc(ic.shareLink)}</a>
    </div>
    <p class="hint">${esc(ic.hint)}</p>

    <section class="textpost">
      <h2>${esc(ic.textTitle)}</h2>
      <p class="lead">${esc(ic.textLead)}</p>
      <textarea id="textpost" readonly placeholder="${esc(ic.loading)}" aria-label="${esc(ic.textTitle)}"></textarea>
      <div class="row">
        <button class="btn primary" id="copytext" type="button">${esc(ic.copyText)}</button>
      </div>
    </section>

    <footer><a href="/">Hoje Há Bola</a> — ${esc(ic.footer)}</footer>
  </div>`;

  const scriptJs = `
  (function () {
    var TODAY = ${JSON.stringify(today)};
    var L = ${JSON.stringify({
      locale: ic.locale, live: ic.live, ft: ic.ft,
      titleToday: ic.titleToday, titleDay: ic.titleDay, tag: ic.tag,
      emptyTitle: ic.emptyTitle, emptySub: ic.emptySub, noHighlight: ic.noHighlight,
    })};
    var FORMATS = ${JSON.stringify(IMAGE_FORMATS.reduce((o, f) => ((o[f.id] = f.nOpts), o), {}))};
    var FMT = ${JSON.stringify(CANVAS_FORMATS)};
    var RANK_POS = {}, KNOWN_IDS = {};
    ${JSON.stringify(RANK_IDS)}.forEach(function (id, i) { RANK_POS[id] = i; KNOWN_IDS[id] = true; });
    var NOTABLE = new RegExp(${JSON.stringify(NOTABLE_RE.source)}, "i");
    var FLAGS = ${JSON.stringify(flagMap())};
    var FREE = ${JSON.stringify(FREE_TO_AIR)};
    var TCOPY = ${JSON.stringify({
      pt: { headToday: "⚽ Jogos de hoje! 🏆", headDay: "⚽ Jogos do dia! 🏆", vs: "vs", live: "(a decorrer)", ht: "(intervalo)", ft: "(terminado)", at: "às", on: "na", footer: "Vê todos os jogos e onde ver na TV 👉 hojehabola.com", noGames: "Sem jogos de relevo para mostrar." },
      en: { headToday: "⚽ Today's games! 🏆", headDay: "⚽ The day's games! 🏆", vs: "vs", live: "(live)", ht: "(half-time)", ft: "(full-time)", at: "at", on: "on", footer: "See every game and where to watch on TV 👉 hojehabola.com", noGames: "No major games to show." },
    })};

    var C = { bg:"#0f1722", panel:"#16202e", border:"#26384c", text:"#e8eef5", muted:"#93a4b8", accent:"#16d27a", live:"#ff5470",
      eyebrowTime:"#dce6ef", eyebrowTimeFin:"#9fb0bf", vs:"#5e6b79" };
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
    var textEl = document.getElementById("textpost");
    var copyTextBtn = document.getElementById("copytext");

    var TEXT_LANG = ${JSON.stringify(lang === "pt" ? "pt" : "en")};
    var COPY_LABEL = ${JSON.stringify(ic.copyText)};
    var COPIED_LABEL = ${JSON.stringify(ic.copiedText)};
    var TC = TCOPY[TEXT_LANG] || TCOPY.pt;

    var wantN = ${JSON.stringify(String(n))};
    var wantHighlight = ${JSON.stringify(highlight || "")};
    var fxToken = 0, paintToken = 0;
    var highlightTouched = false;
    var currentFixtures = [];
    var currentRich = {}, currentFmtv = { matches: [] };

    // Normalisers: "Flag" keeps the country-flags key form (non-alnum → space);
    // "Team" matches the /api/fmtv name keys (non-alnum dropped).
    function normFlag(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\\s+/g, " ").trim(); }
    function normTeam(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\\s+/g, " ").trim(); }
    function flagFor(name) { return FLAGS[normFlag(name)] || ""; }
    function isPaid(ch) { return !FREE[ch]; }
    function isKnown(f) { if (f && f.leagueId != null && KNOWN_IDS[f.leagueId]) return true; return NOTABLE.test((f && f.competition) || ""); }

    function shift(ymd, days) {
      var d = new Date(ymd + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    }
    function setFont(px, weight) { ctx.font = (weight || "400") + " " + px + "px " + FF; }
    function phase(f) { var s = (f.status || "").toUpperCase(); if (s && s !== "FT") return 0; if (!s) return 1; return 2; }
    function fmtTime(iso) {
      try { return new Intl.DateTimeFormat(L.locale, { timeZone:"Europe/Lisbon", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(iso)); }
      catch (e) { return ""; }
    }
    function fmtDate(ymd) {
      try { return new Intl.DateTimeFormat(L.locale, { timeZone:"UTC", weekday:"short", day:"2-digit", month:"short", year:"numeric" }).format(new Date(ymd + "T12:00:00Z")); }
      catch (e) { return ymd; }
    }
    // One state per match drives centre + eyebrow: scheduled / live / finished.
    function matchState(f) { var ph = phase(f); if (ph === 0) return "live"; if (ph === 2) return "finished"; return "scheduled"; }
    // Score string once trusted (live/finished), else "" — a scheduled game (incl.
    // a premature 0-0) never shows a score, only "vs".
    function scoreText(f) {
      var hs = f.homeScore, as = f.awayScore;
      if (hs != null && hs !== "" && as != null && as !== "" && phase(f) !== 1) return hs + " - " + as;
      return "";
    }
    function drawClock(cx, cy, r, color) {
      ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.strokeStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - r * 0.55);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + r * 0.42, cy + r * 0.18);
      ctx.lineCap = "round"; ctx.stroke(); ctx.lineCap = "butt";
    }
    // The eyebrow above the matchup: clock + kickoff (scheduled), red dot + minute
    // (live), dimmed kickoff + "· Fim" (finished). Centred on cx at baseline cy.
    function drawEyebrow(f, cx, cy, timeFont, labelFont) {
      var state = matchState(f), time = fmtTime(f.kickoff);
      ctx.textBaseline = "middle";
      if (state === "live") {
        var minute = (f.status || L.live); if (minute.length > 6) minute = minute.slice(0, 6);
        setFont(timeFont, "800"); var mw = ctx.measureText(minute).width, dot = timeFont * 0.22, gap = timeFont * 0.34;
        var total = dot * 2 + gap + mw, sx = cx - total / 2;
        circle(sx + dot, cy, dot, C.live);
        ctx.fillStyle = C.live; ctx.textAlign = "left"; ctx.fillText(minute, sx + dot * 2 + gap, cy);
        return;
      }
      if (state === "finished") {
        if (!time) { setFont(labelFont, "800"); ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.fillText(L.ft, cx, cy); return; }
        setFont(timeFont, "800"); var tw = ctx.measureText(time).width;
        setFont(labelFont, "800"); var lab = "· " + L.ft, lw = ctx.measureText(lab).width, g = labelFont * 0.5;
        var tot = tw + g + lw, x0 = cx - tot / 2;
        setFont(timeFont, "800"); ctx.fillStyle = C.eyebrowTimeFin; ctx.textAlign = "left"; ctx.fillText(time, x0, cy);
        setFont(labelFont, "800"); ctx.fillStyle = C.muted; ctx.fillText(lab, x0 + tw + g, cy);
        return;
      }
      // scheduled
      if (!time) return;
      setFont(timeFont, "800"); var w = ctx.measureText(time).width, r = timeFont * 0.46, sgap = timeFont * 0.4;
      var t2 = r * 2 + sgap + w, s0 = cx - t2 / 2;
      drawClock(s0 + r, cy, r, C.eyebrowTime);
      ctx.fillStyle = C.eyebrowTime; ctx.textAlign = "left"; ctx.fillText(time, s0 + r * 2 + sgap, cy);
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

    // The left "TV-guide" rail: kickoff time / minute in its own column on the
    // far left, so the row reads like a listings schedule and the time can never
    // be confused with the score. scheduled → HH:MM; live → red minute + "● AO
    // VIVO"; finished → dimmed HH:MM + "FIM". The top Portuguese channel (detail-
    // page order) sits below the time, tinted green when free-to-air. The whole
    // stack is anchored at left x and centred on cy.
    function drawRail(f, x, cy, S) {
      var state = matchState(f), time = fmtTime(f.kickoff), ch = ptChannelFor(f);
      var lines = [];
      function timeLine(color, txt) {
        lines.push({ h: S.railTime, draw: function (yc) {
          setFont(S.railTime, "800"); ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, x, yc);
        } });
      }
      if (state === "live") {
        var minute = (f.status || L.live); if (minute.length > 6) minute = minute.slice(0, 6);
        timeLine(C.live, minute);
        lines.push({ h: S.railLabel, draw: function (yc) {
          var dot = S.railLabel * 0.34;
          circle(x + dot, yc, dot, C.live);
          setFont(S.railLabel, "800"); ctx.fillStyle = C.live; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(L.live, x + dot * 2 + S.railLabel * 0.4, yc);
        } });
      } else if (state === "finished") {
        timeLine(C.eyebrowTimeFin, time || "—");
        lines.push({ h: S.railLabel, draw: function (yc) {
          setFont(S.railLabel, "800"); ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(L.ft, x, yc);
        } });
      } else {
        timeLine(C.eyebrowTime, time || "");
      }
      if (ch) {
        var free = !isPaid(ch);
        lines.push({ h: S.railChannel, draw: function (yc) {
          setFont(S.railChannel, "700"); ctx.fillStyle = free ? C.accent : C.muted; ctx.textAlign = "left"; ctx.textBaseline = "middle";
          ctx.fillText(ellipsize(ch, S.railCol - 8), x, yc);
        } });
      }
      var totalH = (lines.length - 1) * S.railGap;
      for (var i = 0; i < lines.length; i++) totalH += lines[i].h;
      var y = cy - totalH / 2;
      for (var j = 0; j < lines.length; j++) { var ln = lines[j]; ln.draw(y + ln.h / 2); y += ln.h + S.railGap; }
    }

    function drawRow(f, y, S) {
      var x = S.pad, w = S.W - 2 * S.pad;
      roundRect(x, y, w, S.rowH, 16); ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.stroke();
      var cy = y + S.rowH / 2;
      // Left time rail; the matchup fills the area to its right.
      drawRail(f, x + 26, cy, S);
      var mLeft = x + S.railCol, mRight = x + w - 26, cx = (mLeft + mRight) / 2;
      // Centre cell: only "vs" or the score — never a time.
      var sc = scoreText(f);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (sc) { setFont(S.scoreFont, "900"); ctx.fillStyle = C.text; ctx.fillText(sc, cx, cy); }
      else { setFont(S.vsFont, "800"); ctx.fillStyle = C.vs; ctx.fillText("VS", cx, cy); }
      var hcx = cx - S.scoreHalf - S.gap - S.crest / 2;
      drawCrest(img(f.homeBadge), hcx, cy, S.crest, f.home);
      setFont(S.nameFont, "800"); ctx.fillStyle = C.text; ctx.textBaseline = "middle";
      var hRight = hcx - S.crest / 2 - 14;
      ctx.textAlign = "right"; ctx.fillText(ellipsize(f.home, hRight - mLeft), hRight, cy);
      var acx = cx + S.scoreHalf + S.gap + S.crest / 2;
      drawCrest(img(f.awayBadge), acx, cy, S.crest, f.away);
      var aLeft = acx + S.crest / 2 + 14;
      ctx.textAlign = "left"; ctx.fillText(ellipsize(f.away, mRight - aLeft), aLeft, cy);
    }

    function drawHero(f, y, S) {
      var x = S.pad, w = S.W - 2 * S.pad, cx = S.W / 2;
      roundRect(x, y, w, S.heroH, 22); ctx.fillStyle = C.panel; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = C.border; ctx.stroke();
      var comp = f.competition || "", compY = y + 24 + S.heroCompFont / 2;
      setFont(S.heroCompFont, "600"); ctx.textBaseline = "middle";
      var label = ellipsize(comp, w * 0.7), tw = comp ? ctx.measureText(label).width : 0;
      var cbimg = img(f.leagueBadgeUrl), total = tw + (cbimg ? S.heroBadge + 12 : 0), sx = cx - total / 2;
      if (cbimg) { drawContain(cbimg, sx + S.heroBadge / 2, compY, S.heroBadge); sx += S.heroBadge + 12; }
      ctx.fillStyle = C.muted; ctx.textAlign = "left"; ctx.fillText(label, sx, compY);
      // Time banner (eyebrow) directly above the matchup.
      var eyeY = y + 24 + S.heroCompFont + 14 + S.heroEyebrowFont / 2;
      drawEyebrow(f, cx, eyeY, S.heroEyebrowFont, S.heroEyebrowLabelFont);
      var top = eyeY + S.heroEyebrowFont / 2 + 12, mid = (top + (y + S.heroH - 24)) / 2;
      var crestCy = mid - S.heroName * 0.5;
      var hcx = cx - S.heroScoreHalf - S.heroGap - S.heroCrest / 2;
      var acx = cx + S.heroScoreHalf + S.heroGap + S.heroCrest / 2;
      drawCrest(img(f.homeBadge), hcx, crestCy, S.heroCrest, f.home);
      drawCrest(img(f.awayBadge), acx, crestCy, S.heroCrest, f.away);
      var nameY = crestCy + S.heroCrest / 2 + S.heroName * 0.7;
      setFont(S.heroName, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(ellipsize(f.home, S.heroScoreHalf * 2.2), hcx, nameY);
      ctx.fillText(ellipsize(f.away, S.heroScoreHalf * 2.2), acx, nameY);
      // Centre between the crests: only "vs" or the score — never a time.
      var sc = scoreText(f);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (sc) { setFont(S.heroScore, "900"); ctx.fillStyle = C.text; ctx.fillText(sc, cx, crestCy); }
      else { setFont(S.heroVsFont, "800"); ctx.fillStyle = C.vs; ctx.fillText("VS", cx, crestCy); }
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
      ctx.fillText(isToday ? L.titleToday : L.titleDay, px, titleY);
      setFont(S.dateFont, "700"); ctx.fillStyle = C.accent; ctx.textAlign = "right";
      ctx.fillText(fmtDate(d), S.W - px, brandY - S.tagFont * 0.5);
      setFont(S.tagFont, "400"); ctx.fillStyle = C.muted;
      ctx.fillText(L.tag, S.W - px, brandY + S.dateFont * 0.6);

      var contentTop = titleY + S.titleFont / 2 + 24, contentBottom = S.H - S.pad;
      if (!hero && top.length === 0) {
        var midY = (contentTop + contentBottom) / 2;
        setFont(S.emptyFont, "800"); ctx.fillStyle = C.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(L.emptyTitle, S.W / 2, midY - S.emptyFont * 0.5);
        setFont(Math.round(S.emptyFont * 0.55), "600"); ctx.fillStyle = C.muted;
        ctx.fillText(L.emptySub, S.W / 2, midY + S.emptyFont * 0.6);
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
      buildText();
    }

    function populateHighlight(list) {
      var games = list.filter(function (f) { return f.fmid; });
      hlEl.innerHTML = '<option value=""></option>';
      hlEl.firstChild.textContent = L.noHighlight;
      games.forEach(function (f) {
        var o = document.createElement("option");
        o.value = String(f.fmid); o.textContent = f.home + " vs " + f.away;
        hlEl.appendChild(o);
      });
      // Default to featuring the top-ranked game. A ?highlight= in the URL wins;
      // once the user picks from the dropdown (incl. "no highlight"), respect that.
      var desired;
      if (wantHighlight) desired = wantHighlight;
      else if (highlightTouched) desired = hlEl.value;
      else desired = games.length ? String(games[0].fmid) : "";
      hlEl.value = (desired && games.some(function (f) { return String(f.fmid) === String(desired); })) ? String(desired) : "";
      wantHighlight = "";
    }

    function loadFixtures() {
      var d = dateEl.value || TODAY, token = ++fxToken;
      currentRich = {}; currentFmtv = { matches: [] };
      preview.classList.add("busy");
      fetch("/api/fixtures?date=" + encodeURIComponent(d) + "&all=1", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : { fixtures: [] }; })
        .catch(function () { return { fixtures: [] }; })
        .then(function (j) {
          if (token !== fxToken) return;
          // Only well-known competitions, so the card + text stay a "big games" digest.
          var list = (j && j.fixtures ? j.fixtures : []).filter(isKnown);
          list.sort(rankCmp);
          currentFixtures = list;
          populateHighlight(list);
          paint();
          loadTv(d, token);
        });
    }

    // The Portuguese TV feeds, fetched in the browser so the text post can name a
    // channel per game (matching what /g pages show). Best-effort: on failure the
    // text simply omits the channel.
    function loadTv(d, token) {
      Promise.all([
        fetch("/api/listings?date=" + encodeURIComponent(d), { headers: { Accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch("/api/fmtv?date=" + encodeURIComponent(d), { headers: { Accept: "application/json" } })
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      ]).then(function (res) {
        if (token !== fxToken) return;
        currentRich = (res[0] && res[0].matches) || {};
        currentFmtv = res[1] || { matches: [] };
        // Repaint so the rail shows the Portuguese channel under each time, then
        // rebuild the matching text post.
        paint();
        buildText();
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

    // ---- Text post -------------------------------------------------------
    // Built in the browser from the SAME fixtures the canvas drew, so the text
    // always matches the image and updates the moment games load (no separate
    // server round-trip that could come back empty). Flags resolve per team and
    // one Portuguese channel is taken from the TV feeds (free-to-air preferred).
    function ptChannelFor(f) {
      var rows = null, rec = f.fmid ? currentRich[String(f.fmid)] : null;
      if (rec && rec.rows && rec.rows.length) rows = rec.rows;
      if (!rows) {
        var matches = (currentFmtv && currentFmtv.matches) || [];
        var h = normTeam(f.home), a = normTeam(f.away), m = null;
        for (var i = 0; i < matches.length; i++) {
          var x = matches[i]; if (!x) continue;
          if ((f.fmid && String(x.id) === String(f.fmid)) ||
              (x.h === h && x.a === a) || (x.h === a && x.a === h)) { m = x; break; }
        }
        if (m && m.rows && m.rows.length) rows = m.rows;
      }
      if (!rows) return "";
      var seen = {}, pt = [];
      rows.forEach(function (r) {
        if (r && r.country === "Portugal" && r.channel && !seen[r.channel]) { seen[r.channel] = true; pt.push(r.channel); }
      });
      if (!pt.length) return "";
      // Free-to-air first, feed order preserved within each group (stable sort) —
      // the same order the game's detail page shows (lib/app-data orderChannels).
      pt.sort(function (x, y) { return (isPaid(x) ? 1 : 0) - (isPaid(y) ? 1 : 0); });
      return pt[0];
    }
    function kickText(iso) {
      var d = new Date(iso); if (isNaN(d.getTime())) return "";
      var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit", hour12: false })
        .formatToParts(d).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
      if (TEXT_LANG === "pt") { var hh = String(Number(p.hour)); return p.minute === "00" ? hh + "h" : hh + "h" + p.minute; }
      return p.hour + ":" + p.minute;
    }
    function hasScoreT(f) { return f.homeScore != null && f.homeScore !== "" && f.awayScore != null && f.awayScore !== ""; }
    function textLine(f) {
      var hf = flagFor(f.home), af = flagFor(f.away);
      var home = (hf ? hf + " " : "") + f.home, away = (af ? af + " " : "") + f.away;
      var ph = phase(f), ch = ptChannelFor(f), chs = ch ? " " + TC.on + " " + ch : "";
      if (ph === 1 || !hasScoreT(f)) {
        var t = kickText(f.kickoff), when = t ? " " + TC.at + " " + t : "";
        return home + " " + TC.vs + " " + away + when + chs;
      }
      var score = f.homeScore + "-" + f.awayScore;
      var st = ph === 0 ? (((f.status || "").toUpperCase() === "HT") ? TC.ht : TC.live) : TC.ft;
      return home + " " + score + " " + away + " " + st + chs;
    }
    function buildText() {
      if (!textEl) return;
      var head = (dateEl.value || TODAY) === TODAY ? TC.headToday : TC.headDay;
      var num = parseInt(nEl.value, 10) || 6;
      var list = currentFixtures.slice(0, num);
      var body = list.length ? list.map(textLine).join("\\n") : TC.noGames;
      textEl.value = head + "\\n\\n" + body + "\\n\\n" + TC.footer + "\\n";
    }
    function copyText() {
      if (!textEl) return;
      var v = textEl.value || "";
      function done() {
        copyTextBtn.textContent = COPIED_LABEL;
        setTimeout(function () { copyTextBtn.textContent = COPY_LABEL; }, 1600);
      }
      function fallback() { try { textEl.select(); document.execCommand("copy"); } catch (e) {} done(); }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(done, fallback);
      } else { fallback(); }
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
    hlEl.addEventListener("change", function () { highlightTouched = true; paint(); });
    dl.addEventListener("click", download);
    openBtn.addEventListener("click", openFull);
    if (copyTextBtn) copyTextBtn.addEventListener("click", copyText);

    syncNOptions();
    loadFixtures();
  })();
  `;

  return {
    robots: "noindex, follow",
    title: ic.title,
    description: ic.description,
    css: IMAGE_CSS + `.preview.busy::after{content:"${ic.loading}"}`,
    bodyHtml, scriptJs,
  };
}
