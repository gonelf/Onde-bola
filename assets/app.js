/*
 * Hoje Há Bola — today's football games worldwide and where to watch them.
 *
 * Fixtures come from FotMob's day feed via the cached /api/fixtures proxy
 * (long-term cached/DB-backed, so past days never re-hit upstream). Real TV
 * channels come from TheSportsDB's TV feeds, plus FotMob (api/fmtv) and
 * SofaScore (api/sofatv) as unofficial broadcaster sources. Only real listings
 * are ever shown — when no source has data the match shows "No TV listing yet",
 * and when there are no fixtures the page shows an empty state.
 */

(function () {
  "use strict";

  var API_BASE = "https://www.thesportsdb.com/api/v1/json/123";

  // FotMob's day-bulk source now fills cards with Portuguese (and other) channels
  // up front, so the per-match SofaScore call is off by default — it's kept as an
  // optional fallback (flip to true to consult it on match open).
  var USE_SOFASCORE = false;

  var STORAGE_HIDDEN = "ondebola.hiddenLeagues";
  var STORAGE_REMEMBER = "ondebola.rememberFilters";
  var STORAGE_COUNTRY = "ondebola.primaryCountry";

  var state = {
    date: new Date(),
    search: "",
    fixtures: [],
    hidden: {},       // competition name -> true when hidden from the list
    remember: false,  // persist the filter selection across visits
    primaryCountry: "Portugal", // country shown first on cards; default by IP
    highlightsById: {}, // fmid -> highlight record, for the per-card button
  };

  var el = {
    games: document.getElementById("games"),
    status: document.getElementById("status"),
    currentDate: document.getElementById("current-date"),
    search: document.getElementById("search"),
    prev: document.getElementById("prev-day"),
    next: document.getElementById("next-day"),
    today: document.getElementById("today-btn"),
    leagueToggle: document.getElementById("league-toggle"),
    leagueToggleLabel: document.getElementById("league-toggle-label"),
    filterPanel: document.getElementById("filter-panel"),
    leagueList: document.getElementById("league-list"),
    resetFilters: document.getElementById("reset-filters"),
    rememberFilters: document.getElementById("remember-filters"),
    detailOverlay: document.getElementById("detail-overlay"),
    detailClose: document.getElementById("detail-close"),
    detailShare: document.getElementById("detail-share"),
    detailBody: document.getElementById("detail-body"),
    countrySelect: document.getElementById("country-select"),
    adPrefs: document.getElementById("ad-prefs"),
    adTop: document.getElementById("ad-top"),
    adBottom: document.getElementById("ad-bottom"),
  };

  // ---- Display ads + consent ----------------------------------------------
  var ADS = window.ADS_CONFIG || {};
  var STORAGE_CONSENT = "ondebola.adConsent";
  var adsScriptLoaded = false;

  function consentStatus() {
    try { return localStorage.getItem(STORAGE_CONSENT); } catch (e) { return null; }
  }
  function adsAllowed() { return consentStatus() === "granted"; }
  function hasPublisher() { return !!ADS.client; }
  function slotConfigured(slot) { return !!(ADS.client && slot); }
  // Whether to emit an ad unit for a slot (a real banner once its slot id is
  // set, otherwise a labelled placeholder) — only after the visitor accepts.
  function slotEnabled(slot) {
    return adsAllowed() && (slotConfigured(slot) || ADS.showPlaceholder);
  }
  // Whether to emit in-feed ad slots between match cards.
  function adsEnabled() { return slotEnabled(ADS.slot); }

  // Build one ad unit. `extraClass` lets banners differ visually from in-feed
  // slots; a configured slot renders a real AdSense unit, otherwise a labelled
  // placeholder so the placement stays visible during setup.
  function adSlotHtml(slot, extraClass) {
    var cls = "ad-slot" + (extraClass ? " " + extraClass : "");
    var label = '<span class="ad-label">Publicidade</span>';
    if (slotConfigured(slot)) {
      return '<div class="' + cls + '" aria-label="Advertisement">' + label +
        '<ins class="adsbygoogle" style="display:block" data-ad-client="' +
          escapeHtml(ADS.client) + '" data-ad-slot="' + escapeHtml(slot) +
          '" data-ad-format="auto" data-full-width-responsive="true"' +
          (ADS.test ? ' data-adtest="on"' : "") + "></ins></div>";
    }
    return '<div class="' + cls + ' ad-placeholder" aria-label="Advertisement">' + label +
      '<span class="ad-ph-text">Ad space — set IDs in assets/data/ads.js</span></div>';
  }

  // Fill (or clear) the fixed top/bottom banner containers based on consent.
  function renderBanners() {
    fillBanner(el.adTop, ADS.topSlot);
    fillBanner(el.adBottom, ADS.bottomSlot);
  }
  function fillBanner(node, slot) {
    if (!node) return;
    if (slotEnabled(slot)) {
      node.innerHTML = adSlotHtml(slot, "ad-banner-unit");
      node.hidden = false;
    } else {
      node.innerHTML = "";
      node.hidden = true;
    }
  }

  function loadAdSenseScript() {
    if (adsScriptLoaded || !ADS.client) return;
    adsScriptLoaded = true;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" +
      encodeURIComponent(ADS.client);
    s.crossOrigin = "anonymous";
    document.head.appendChild(s);
  }

  function anySlotConfigured() {
    return slotConfigured(ADS.topSlot) || slotConfigured(ADS.slot) ||
      slotConfigured(ADS.bottomSlot);
  }

  function mountAds() {
    if (!adsAllowed() || !hasPublisher() || !anySlotConfigured()) return;
    loadAdSenseScript();
    try {
      // Activate every unmounted unit on the page (feed slots + banners).
      var slots = document.querySelectorAll("ins.adsbygoogle:not([data-ad-status])");
      for (var i = 0; i < slots.length; i++) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      }
    } catch (e) { /* adblock or not ready — ignore */ }
  }

  function showConsentBanner() {
    if (document.getElementById("consent-banner")) return;
    var b = document.createElement("div");
    b.id = "consent-banner";
    b.className = "consent-banner";
    b.innerHTML =
      '<div class="consent-inner">' +
      '<p class="consent-text">' + t("consent") + "</p>" +
      '<div class="consent-actions">' +
      '<button id="consent-reject" type="button" class="consent-btn ghost">' + t("reject") + "</button>" +
      '<button id="consent-accept" type="button" class="consent-btn primary">' + t("accept") + "</button>" +
      "</div></div>";
    document.body.appendChild(b);
    document.getElementById("consent-accept").addEventListener("click", function () { setConsent("granted"); });
    document.getElementById("consent-reject").addEventListener("click", function () { setConsent("denied"); });
  }

  function setConsent(v) {
    try { localStorage.setItem(STORAGE_CONSENT, v); } catch (e) {}
    var b = document.getElementById("consent-banner");
    if (b && b.parentNode) b.parentNode.removeChild(b);
    render();          // add/remove in-feed slots
    renderBanners();   // add/remove top & bottom banners
    if (v === "granted") mountAds();
  }

  function initConsent() {
    var s = consentStatus();
    if (s !== "granted" && s !== "denied") showConsentBanner();
  }

  // ---- Localization (EN default, PT when Portugal is the primary country) --
  var I18N = {
    en: {
      title: "Hoje Há Bola — Football on TV worldwide",
      tagline: "Football worldwide & where to watch it",
      today: "Today", search: "Search team or competition…",
      leagues: "Leagues", showLeagues: "Show leagues", reset: "Reset filters",
      remember: "Remember this next time", yourCountry: "📍 Your country",
      connDebug: "Connections debug →", adPrefs: "Ad preferences",
      footerSite: "Site",
      footerData: "Today's football from around the world and where to watch it — live on TV and streaming, wherever you are.",
      footerCopy: "© {year} Hoje Há Bola · All rights reserved.",
      close: "Close",
      shareGame: "Share game", copied: "Link copied!",
      noListing: "No TV listing yet", clickDetails: "Click for details ›",
      listings: "📡 Listings", moreOne: "more country in details ›",
      moreMany: "more countries in details ›",
      game: "game", games: "games", competition: "competition",
      competitions: "competitions", liveNow: "live now", group: "Group",
      withTv: "with real TV listings", updated: "updated", live: "LIVE", ft: "FT",
      freeAir: "Free-to-air", paidSub: "Paid cable / subscription",
      whereToWatch: "Where to watch", realListings: "📡 Real broadcast listings",
      checking: "⏳ Checking live listings…",
      noListingDetail: "No broadcast listing found for this match yet.", vs: "vs",
      mdReferee: "Referee", mdAttendance: "Attendance", mdMotm: "Player of the match",
      mdForm: "Recent form", mdH2h: "Head-to-head", mdTimeline: "Timeline",
      mdLineups: "Starting line-ups", mdLineupsProb: "Probable line-ups",
      mdLineupsNote: "Predicted from recent selections — confirmed XI is announced ~1h before kick-off.",
      mdStats: "Match stats", mdLoading: "Loading match details…",
      mdHighlights: "Highlights", mdWatch: "▶ Watch highlights", mdYouTube: "🔎 Search on YouTube",
      mdW: "W", mdD: "D", mdL: "L",
      stPossession: "Possession", stShots: "Shots", stSot: "On target",
      stXg: "Expected goals (xG)", stCorners: "Corners", stFouls: "Fouls",
      allFiltered: "All leagues are filtered out — open <strong>Leagues</strong> and re-enable some, or hit Reset filters.",
      noSearch: "No games match your search for this date.",
      noFixtures: "No fixtures found for this date.",
      feedDown: "Couldn’t reach the live data feed. Please try again in a moment.",
      hlCard: "Highlights", hlCardAria: "Watch highlights",
      consent: "Hoje Há Bola is free thanks to ads. We’d like to use cookies to show ads and measure traffic. You can change this anytime via “Ad preferences” in the footer.",
      accept: "Accept", reject: "Reject",
    },
    pt: {
      title: "Hoje Há Bola — Futebol na TV em todo o mundo",
      tagline: "Futebol de todo o mundo e onde ver",
      today: "Hoje", search: "Procurar equipa ou competição…",
      leagues: "Ligas", showLeagues: "Mostrar ligas", reset: "Repor filtros",
      remember: "Lembrar para a próxima", yourCountry: "📍 O teu país",
      connDebug: "Diagnóstico de ligações →", adPrefs: "Preferências de anúncios",
      footerSite: "Site",
      footerData: "O futebol de todo o mundo de hoje e onde o ver — em direto na TV e em streaming, estejas onde estiveres.",
      footerCopy: "© {year} Hoje Há Bola · Todos os direitos reservados.",
      close: "Fechar",
      shareGame: "Partilhar jogo", copied: "Link copiado!",
      noListing: "Sem emissão conhecida", clickDetails: "Clica para detalhes ›",
      listings: "📡 Emissões", moreOne: "mais país nos detalhes ›",
      moreMany: "mais países nos detalhes ›",
      game: "jogo", games: "jogos", competition: "competição",
      competitions: "competições", liveNow: "ao vivo", group: "Grupo",
      withTv: "com emissão de TV", updated: "atualizado", live: "AO VIVO", ft: "FIM",
      freeAir: "Sinal aberto", paidSub: "Cabo / subscrição",
      whereToWatch: "Onde ver", realListings: "📡 Emissões de TV reais",
      checking: "⏳ A verificar emissões…",
      noListingDetail: "Ainda sem emissão conhecida para este jogo.", vs: "vs",
      mdReferee: "Árbitro", mdAttendance: "Assistência", mdMotm: "Homem do jogo",
      mdForm: "Forma recente", mdH2h: "Confrontos diretos", mdTimeline: "Cronologia",
      mdLineups: "Onze inicial", mdLineupsProb: "Onzes prováveis",
      mdLineupsNote: "Previsto a partir das escolhas recentes — o onze confirmado é anunciado ~1h antes do início.",
      mdStats: "Estatísticas", mdLoading: "A carregar detalhes do jogo…",
      mdHighlights: "Resumo", mdWatch: "▶ Ver resumo", mdYouTube: "🔎 Procurar no YouTube",
      mdW: "V", mdD: "E", mdL: "D",
      stPossession: "Posse de bola", stShots: "Remates", stSot: "À baliza",
      stXg: "Golos esperados (xG)", stCorners: "Cantos", stFouls: "Faltas",
      allFiltered: "Todas as ligas estão filtradas — abre <strong>Ligas</strong> e reativa algumas, ou carrega em Repor filtros.",
      noSearch: "Nenhum jogo corresponde à tua pesquisa nesta data.",
      noFixtures: "Sem jogos para esta data.",
      feedDown: "Não foi possível contactar o feed de dados. Tenta novamente daqui a momentos.",
      hlCard: "Resumo", hlCardAria: "Ver resumo",
      consent: "O Hoje Há Bola é grátis graças aos anúncios. Gostaríamos de usar cookies para mostrar anúncios e medir o tráfego. Podes alterar isto a qualquer momento em “Preferências de anúncios” no rodapé.",
      accept: "Aceitar", reject: "Rejeitar",
    },
  };

  function lang() { return state.primaryCountry === "Portugal" ? "pt" : "en"; }
  function t(k) { var L = I18N[lang()]; return (L && L[k] != null) ? L[k] : I18N.en[k]; }
  function locale() { return lang() === "pt" ? "pt-PT" : undefined; }

  // Apply the current language to the fixed page chrome (everything not rebuilt
  // by render()). Called on load and whenever the primary country changes.
  function applyStaticText() {
    document.title = t("title");
    document.documentElement.lang = lang();
    var set = function (sel, prop, val) {
      var n = document.querySelector(sel); if (n) n[prop] = val;
    };
    set(".tagline", "textContent", t("tagline"));
    set("#today-btn", "textContent", t("today"));
    if (el.search) el.search.placeholder = t("search");
    set("#league-toggle-label", "textContent", t("leagues"));
    set(".filter-panel-head strong", "textContent", t("showLeagues"));
    set("#reset-filters", "textContent", t("reset"));
    set(".remember-row span", "textContent", t("remember"));
    set(".country-label", "textContent", t("yourCountry"));
    set("#conn-debug", "textContent", t("connDebug"));
    set("#ad-prefs", "textContent", t("adPrefs"));
    set("#footer-data", "textContent", t("footerData"));
    set("#footer-site-title", "textContent", t("footerSite"));
    set("#footer-copy", "textContent", t("footerCopy").replace("{year}", new Date().getFullYear()));
    set("#detail-close", "ariaLabel", t("close"));
    set("#detail-share", "ariaLabel", t("shareGame"));
    set("#detail-share", "title", t("shareGame"));
  }

  // ---- Helpers ------------------------------------------------------------

  function ymd(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function formatClock(date) {
    return date.toLocaleTimeString(locale() || [], { hour: "2-digit", minute: "2-digit" });
  }

  function matchStatus(kickoff) {
    var now = new Date();
    var diffMin = (now - kickoff) / 60000;
    if (diffMin < 0) return { state: "upcoming" };
    if (diffMin <= 115) return { state: "live" };
    return { state: "finished" };
  }

  // Resolve a match's state/label, preferring the live API status string
  // (e.g. "1H", "HT", "FT", "Match Finished", or a minute like "67") and
  // falling back to a time-based estimate when the feed gives nothing.
  function statusOf(fx) {
    var kickoff = new Date(fx.kickoff);
    var raw = (fx.status || "").trim();
    var s = raw.toUpperCase();

    if (/(FT|AET|PEN|FINISHED|ENDED|MATCH FINISHED|FULL TIME)/.test(s)) {
      return { state: "finished", label: t("ft") };
    }
    if (/^(HT|HALF[\s-]?TIME)$/.test(s)) {
      return { state: "live", label: "HT" };
    }
    var min = s.match(/(\d{1,3})\s*'?\+?\d*\s*$/);
    if (/(1H|2H|ET|LIVE|IN PLAY|PLAYING)/.test(s) || (min && s !== "")) {
      return { state: "live", label: min ? min[1] + "'" : t("live") };
    }
    if (/^(NS|NOT STARTED|SCHEDULED|TBD|PREVIEW)$/.test(s) || raw === "") {
      // Nothing definitive from the feed — estimate from the clock.
      var est = matchStatus(kickoff);
      if (est.state === "live") return { state: "live", label: t("live") };
      if (est.state === "finished") return { state: "finished", label: t("ft") };
      return { state: "upcoming", label: "" };
    }
    // Unknown non-empty status: treat as live with the raw label.
    return { state: "live", label: raw };
  }

  function hasScore(fx) {
    return fx.homeScore !== null && fx.homeScore !== undefined &&
      fx.awayScore !== null && fx.awayScore !== undefined;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fixtureById(id) {
    return state.fixtures.filter(function (f) { return String(f.id) === String(id); })[0];
  }

  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // ---- Share --------------------------------------------------------------

  // Three-dot "share" glyph (inherits currentColor).
  var SHARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>' +
    '<circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/>' +
    '<line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';

  // The kickoff day in Europe/Lisbon, so the share URL the client builds matches
  // the canonical the server-rendered page emits (which also uses Lisbon time).
  function lisbonYmd(date) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(date);
    } catch (e) { return ymd(date); }
  }
  // A team's URL slug (matches the server's slugify): accent-folded, a-z0-9, "-".
  function teamSlug(name) { return normName(name).replace(/ /g, "-"); }

  // Competitions that carry an edition year in the URL: periodic tournaments
  // (World Cup, Euro…) plus the European continental club cups. Everything else
  // is an annual, continuous competition and stays evergreen (no year).
  var EDITION_RE = /world cup|copa am[eé]rica|nations league|european championship|\beuro\b|africa cup of nations|afcon|asian cup|gold cup|champions league|europa league|conference league|super cup/i;
  // A football season is named by the year it ends (Aug–Dec belong to the next
  // year's season), so World Cup 2026 → 2026 and Champions League 26/27 → 2027.
  function editionYear(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    return m >= 8 ? y + 1 : y;
  }
  // League slug for the URL hierarchy, with the edition appended where it matters.
  function leagueSlugFor(comp, iso) {
    var base = teamSlug(comp || "football");
    if (EDITION_RE.test(comp || "")) {
      var y = editionYear(iso);
      if (y) return base + "-" + y;
    }
    return base;
  }

  // Build the public share / detail URL for a match: a descriptive, crawlable
  // /g/<league>/<date>/<home>-vs-<away> page that nests under the league hub
  // (/g/<league>). The server resolves it back to the day's fixture to render
  // the Open Graph card, broadcasts and match facts, then deep-links real
  // visitors into the app with the match open.
  function shareLink(fx) {
    var d = new Date(fx.kickoff);
    var date = isNaN(d.getTime()) ? lisbonYmd(new Date()) : lisbonYmd(d);
    var league = leagueSlugFor(fx.competition, fx.kickoff);
    return location.origin + "/g/" + league + "/" + date + "/" +
      teamSlug(fx.home) + "-vs-" + teamSlug(fx.away);
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) { return false; }
  }

  // Briefly flag a share button as "copied".
  function flashCopied(btn) {
    if (!btn) return;
    btn.classList.add("copied");
    btn.setAttribute("title", t("copied"));
    btn.setAttribute("aria-label", t("copied"));
    clearTimeout(btn._copyT);
    btn._copyT = setTimeout(function () {
      btn.classList.remove("copied");
      btn.setAttribute("title", t("shareGame"));
      btn.setAttribute("aria-label", t("shareGame"));
    }, 1800);
  }

  // Native share sheet where available (mobile, modern desktop), otherwise copy
  // the link to the clipboard and confirm on the button.
  function shareMatch(fx, btn) {
    if (!fx) return;
    var url = shareLink(fx);
    var title = fx.home + " vs " + fx.away;
    var text = title + (fx.competition ? " — " + fx.competition : "");
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url })["catch"](function () {});
      return;
    }
    var confirm = function () { flashCopied(btn); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(confirm, function () {
        if (legacyCopy(url)) confirm();
      });
    } else if (legacyCopy(url)) {
      confirm();
    }
  }

  // ---- Data fetching ------------------------------------------------------

  // The day's fixtures from FotMob via the cached /api/fixtures proxy, which
  // already returns them fully normalised (id, competition, teams, badges,
  // kickoff, scores, status). Rejects on a hard failure so the caller can tell
  // "no games today" apart from "the feed is unreachable".
  function fetchFotMobFixtures(day) {
    return fetch("/api/fixtures?date=" + day, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("fixtures " + r.status); return r.json(); })
      .then(function (d) {
        return ((d && d.fixtures) || []).map(function (fx) {
          fx.tv = fx.tv || [];
          // FotMob lists each World Cup / continental group as its own
          // "competition" (e.g. "World Cup Grp F"). Collapse them into the one
          // tournament so the count and the list group correctly, keeping the
          // group letter for a per-match label.
          var parts = splitCompetition(fx.competition);
          fx.competition = parts.base;
          fx.group = parts.group;
          return fx;
        });
      });
  }

  // Split a feed competition name into its tournament and (optional) group,
  // e.g. "World Cup Grp F" -> { base: "World Cup", group: "F" }. Names without
  // a "Grp"/"Group" marker (incl. tiers like "Nations League A") are left whole.
  function splitCompetition(name) {
    var m = /^(.+?)\s+(?:Grp|Group)\.?\s+([A-Z0-9]+)$/i.exec((name || "").trim());
    if (m) return { base: m[1].trim(), group: m[2].toUpperCase() };
    return { base: name || "Football", group: "" };
  }

  // Real broadcast listings for the day (TheSportsDB TV feed, free key).
  // Returns lookups by event id and by "home vs away" name. Coverage is
  // crowd-sourced, so only some matches will have entries.
  function nameKey(home, away) {
    return (home + " vs " + away).toLowerCase().replace(/\s+/g, " ").trim();
  }

  // Fetch TV rows via the cached /api/tv proxy when available (it caches in a
  // Vercel DB to avoid repeat upstream calls), falling back to TheSportsDB
  // directly when the proxy isn't deployed (e.g. static/local hosting).
  function fetchTvRows(proxyQuery, directUrl) {
    return fetch("/api/tv?" + proxyQuery, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("proxy " + r.status); return r.json(); })
      .catch(function () {
        return fetch(directUrl, { headers: { Accept: "application/json" } })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
      })
      .then(function (data) { return (data && (data.tvevent || data.events)) || []; })
      .catch(function () { return []; });
  }

  function fetchTv(day) {
    return fetchTvRows("date=" + day, API_BASE + "/eventstv.php?d=" + day + "&s=Soccer")
      .then(function (rows) {
        var byId = {}, byName = {};
        rows.forEach(function (row) {
          var channel = row.strChannel;
          if (!channel) return;
          var entry = { channel: channel, country: row.strCountry || "International" };
          var id = row.idEvent && String(row.idEvent);
          if (id) (byId[id] = byId[id] || []).push(entry);
          var nm = (row.strEvent || "").toLowerCase().replace(/\s+/g, " ").trim();
          if (nm) (byName[nm] = byName[nm] || []).push(entry);
        });
        return { byId: byId, byName: byName };
      });
  }

  // Attach real listings to fixtures, matching by event id then by name.
  function attachTv(fixtures, tv) {
    fixtures.forEach(function (fx) {
      var t = tv.byId[String(fx.id)] ||
        tv.byName[nameKey(fx.home, fx.away)] ||
        tv.byName[nameKey(fx.away, fx.home)];
      fx.tv = t || [];
    });
  }

  // Second free source: TheSportsDB's per-event TV lookup, fetched on demand
  // (when a match is opened) to fill gaps the day feed missed. Cached per id.
  var tvCache = {};
  // Merged per-event listings, kept for the session so silent 60s refreshes
  // (which rebuild fixture objects) don't re-fetch everything. Keyed by event id.
  var loadedTv = {};

  function fetchEventTv(id) {
    if (tvCache[id]) return Promise.resolve(tvCache[id]);
    return fetchTvRows("id=" + encodeURIComponent(id),
        API_BASE + "/lookuptv.php?id=" + encodeURIComponent(id))
      .then(function (rows) {
        var list = rows.filter(function (r) { return r.strChannel; }).map(function (r) {
          return { channel: r.strChannel, country: r.strCountry || "International" };
        });
        tvCache[id] = list;
        return list;
      });
  }

  // Unofficial secondary source (SofaScore via our server proxy). Best effort:
  // only works where /api/sofatv is deployed, and degrades to [] on any failure.
  function fetchSofaTv(fx) {
    var day = ymd(state.date);
    var q = "date=" + day + "&home=" + encodeURIComponent(fx.home) +
      "&away=" + encodeURIComponent(fx.away);
    return fetch("/api/sofatv?" + q, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("sofa " + r.status); return r.json(); })
      .then(function (data) {
        return ((data && data.tvevent) || []).filter(function (r) { return r.strChannel; })
          .map(function (r) { return { channel: r.strChannel, country: r.strCountry || "International" }; });
      })
      .catch(function () { return []; });
  }

  // FotMob day-bulk broadcaster source (free, Portugal-first). One request per
  // country returns every match's TV stations for the day, keyed by match.
  function fetchFotMobDay(day) {
    return fetch("/api/fmtv?date=" + day, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("fmtv " + r.status); return r.json(); })
      .then(function (d) { return (d && d.matches) || []; })
      .catch(function () { return []; });
  }

  function normName(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  }

  function teamMatch(a, b) {
    a = normName(a); b = normName(b);
    if (!a || !b) return false;
    return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  // Merge two listing arrays, de-duplicating by country + channel.
  function mergeTv(a, b) {
    var out = (a || []).slice();
    var seen = {};
    out.forEach(function (t) { seen[(t.country || "") + "|" + t.channel] = true; });
    (b || []).forEach(function (t) {
      var k = (t.country || "") + "|" + t.channel;
      if (!seen[k]) { seen[k] = true; out.push(t); }
    });
    return out;
  }

  // Resolve real listings for one fixture by combining EVERY source: the day
  // feed (already on fx.tv), TheSportsDB's per-event lookup, and the SofaScore
  // proxy. Merging (rather than first-wins) is what surfaces Portuguese
  // channels that only one source happens to carry. Cached via fx._tvLoaded.
  function ensureEventTv(fx) {
    if (fx._tvLoaded) return Promise.resolve(fx.tv || []);
    var dayList = (fx.tv || []).slice();
    // Only spend a TheSportsDB per-event call when the day feed gave nothing;
    // always consult SofaScore, since that's what surfaces Portuguese channels.
    var primary = (!dayList.length && /^\d+$/.test(String(fx.id)))
      ? fetchEventTv(fx.id) : Promise.resolve([]);
    var sofa = USE_SOFASCORE ? fetchSofaTv(fx) : Promise.resolve([]);
    return Promise.all([primary, sofa]).then(function (res) {
      fx.tv = mergeTv(mergeTv(dayList, res[0]), res[1]);
      fx._tvLoaded = true;
      loadedTv[fx.id] = fx.tv;
      return fx.tv || [];
    });
  }

  // Per-match FotMob detail (venue, referee, timeline, form, h2h, stats) via the
  // cached /api/matchdetails proxy. Loaded on demand when a match is opened —
  // it's a heavier per-match call, so we never prefetch it. Cached per id and
  // stashed on the fixture (fx._details / fx._detailsLoaded) for the session.
  var detailsCache = {};
  function fetchMatchDetails(id) {
    if (detailsCache[id]) return Promise.resolve(detailsCache[id]);
    return fetch("/api/matchdetails?id=" + encodeURIComponent(id),
        { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("md " + r.status); return r.json(); })
      .then(function (d) { var det = (d && d.ok && d.details) || null; detailsCache[id] = det; return det; })
      .catch(function () { return null; });
  }

  function ensureDetails(fx) {
    if (fx._detailsLoaded) return Promise.resolve(fx._details || null);
    if (!fx.fmid) { fx._detailsLoaded = true; return Promise.resolve(null); }
    return fetchMatchDetails(fx.fmid).then(function (det) {
      fx._details = det;
      fx._detailsLoaded = true;
      return det;
    })["catch"](function () {
      // A failed/blocked matchdetails fetch shouldn't leave the modal stuck on
      // the "loading…" note — mark it resolved (empty) so the rest still renders.
      fx._details = null;
      fx._detailsLoaded = true;
      return null;
    });
  }

  // Eagerly load listings for every visible fixture (bounded concurrency) so
  // channels appear without the user having to open each match. Stale runs are
  // abandoned when the date changes via the load token.
  function prefetchListings(token) {
    var queue = state.fixtures.filter(function (f) {
      return !f._tvLoaded && !isHidden(f.competition);
    });
    var i = 0, active = 0, CONCURRENCY = 4;
    function pump() {
      if (token !== state.loadToken) return; // a newer load superseded us
      while (active < CONCURRENCY && i < queue.length) {
        var fx = queue[i++];
        active++;
        ensureEventTv(fx)["catch"](function () {})["then"](function () {
          active--;
          if (token === state.loadToken) updateCardListings(fx);
          pump();
        });
      }
      if (active === 0 && i >= queue.length && token === state.loadToken) updateTvCount();
    }
    pump();
  }

  // Patch a single card's channel row (and the open modal) in place, avoiding a
  // full re-render that would disturb scroll position.
  function updateCardListings(fx) {
    try {
      var card = el.games.querySelector('article[data-id=' + JSON.stringify(String(fx.id)) + ']');
      if (card) {
        var box = card.querySelector(".channels");
        if (box) box.innerHTML = channelsHtml(fx);
      }
    } catch (e) { /* selector edge cases — ignore */ }
    if (!el.detailOverlay.hidden && state.detailId === String(fx.id)) {
      el.detailBody.innerHTML = buildDetailBody(fx, false);
    }
  }

  // Refresh the "N with real TV listings" figure in the status bar.
  function updateTvCount() {
    var withTv = state.fixtures.filter(function (f) { return f.tv && f.tv.length; }).length;
    var node = el.status && el.status.querySelector(".tv-count");
    if (node) node.textContent = withTv ? " · 📡 " + withTv + " " + t("withTv") : "";
  }

  function loadFixtures(silent) {
    if (!silent) renderSkeletons();

    // Bumped each load so a stale prefetch run from a previous date stops.
    state.loadToken = (state.loadToken || 0) + 1;
    var token = state.loadToken;

    var day = ymd(state.date);

    // Track whether the fixtures feed was reachable so we can tell "no games
    // today" apart from "the feed is unreachable".
    var feedReachable = true;
    var fixturesReq = fetchFotMobFixtures(day)
      .catch(function () { feedReachable = false; return []; });

    return Promise.all([fixturesReq, fetchTv(day), fetchFotMobDay(day)])
      .then(function (res) {
        var fixtures = res[0] || [];
        var tv = res[1];
        // FotMob day-bulk broadcaster map, merged through one path below.
        var dayMaps = res[2] || [];
        attachTv(fixtures, tv);

        // Merge the FotMob day-bulk broadcaster map. This gives every match its
        // broadcasters up front, with no per-match call.
        if (dayMaps.length) {
          fixtures.forEach(function (fx) {
            var h = normName(fx.home), a = normName(fx.away);
            for (var i = 0; i < dayMaps.length; i++) {
              var e = dayMaps[i];
              if (e.rows && e.rows.length && teamMatch(h, e.h) && teamMatch(a, e.a)) {
                fx.tv = mergeTv(fx.tv, e.rows);
              }
            }
          });
        }

        // Reapply listings already fetched this session so a silent refresh
        // keeps them and doesn't re-hit the sources.
        fixtures.forEach(function (fx) {
          if (loadedTv[fx.id]) { fx.tv = mergeTv(fx.tv, loadedTv[fx.id]); fx._tvLoaded = true; }
          // Likewise reuse any match detail already fetched this session.
          if (fx.fmid && Object.prototype.hasOwnProperty.call(detailsCache, fx.fmid)) {
            fx._details = detailsCache[fx.fmid];
            fx._detailsLoaded = true;
          }
        });

        if (!fixtures.length) {
          if (silent) return; // keep current view on an empty silent refresh
          showEmpty(feedReachable ? t("noFixtures") : t("feedDown"));
          return;
        }
        state.fixtures = fixtures;
        populateCountrySelect(); // surface any extra countries seen in listings
        var comps = {};
        fixtures.forEach(function (f) { comps[f.competition] = true; });
        var live = fixtures.filter(function (f) { return statusOf(f).state === "live"; }).length;
        var withTv = fixtures.filter(function (f) { return f.tv && f.tv.length; }).length;
        var nGames = fixtures.length, nComps = Object.keys(comps).length;
        var base = nGames + " " + t(nGames === 1 ? "game" : "games") + " · " +
          nComps + " " + t(nComps === 1 ? "competition" : "competitions") +
          (live ? " · " + live + " " + t("liveNow") : "");
        el.status.hidden = false;
        el.status.className = "status";
        el.status.innerHTML = '<span class="badge">' + (live ? t("live") : "OK") + "</span>" +
          escapeHtml(base) +
          '<span class="tv-count">' +
            (withTv ? " · 📡 " + withTv + " " + t("withTv") : "") + "</span>" +
          escapeHtml(" · " + t("updated") + " " + formatClock(new Date()));
        render();
        updateLeaguePanel();
        prefetchListings(token); // fill in real channels without a click
        maybeOpenShared(); // a ?match= deep link from a shared card
      });
  }

  // Parse a share deep link (/?match=<id>&date=<YYYY-MM-DD>): jump to that day
  // and remember the match to open once its fixtures have loaded.
  function readDeepLink() {
    try {
      var params = new URLSearchParams(location.search);
      var d = parseYmd(params.get("date"));
      if (d) state.date = d;
      var m = params.get("match");
      if (m) state.pendingMatch = m;
    } catch (e) { /* malformed query — ignore */ }
  }

  function maybeOpenShared() {
    if (!state.pendingMatch) return;
    var id = state.pendingMatch;
    state.pendingMatch = null;
    var fx = fixtureById(id);
    if (!fx) return;
    // Normalize a ?match= deep link to the canonical /g/<id> URL without adding
    // a history entry, then open the match (the entry we replace is the deep link).
    if (window.history && history.replaceState) {
      try { history.replaceState({ hhbMatch: String(fx.id) }, "", shareLink(fx)); } catch (e) {}
    }
    openDetails(fx.id, { push: false });
  }

  function showEmpty(message) {
    state.fixtures = [];
    showStatus("error", "NONE", message);
    render();
    updateLeaguePanel();
  }

  // ---- Highlights view ----------------------------------------------------

  // Switch between the day's fixtures and the recent-highlights feed. Marks the
  // active tab, hides the date pager + league filter (which don't apply to
  // Fetch the highlights collected by the cron sweep (/api/highlights) and index
  // them by FotMob match id, so each finished game's card can show a Highlights
  // button. Best effort: any failure just leaves the map empty (no buttons).
  function loadHighlights() {
    fetch("/api/highlights", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var map = {};
        ((d && d.highlights) || []).forEach(function (h) {
          if (h && h.fmid) map[String(h.fmid)] = h;
        });
        state.highlightsById = map;
        // Re-render only if games are already on screen (otherwise the fixtures
        // load will render with the map in place, with no empty-state flash).
        if (state.fixtures.length) render();
      })
      .catch(function () {});
  }

  // The watch link for a finished game's highlight, or "" when none is available.
  // Prefers the embeddable YouTube video, then FotMob's own clip.
  function highlightLink(fx) {
    var h = fx && fx.fmid && state.highlightsById[String(fx.fmid)];
    if (!h) return "";
    var id = ytIdOf(h);
    if (id) return "https://youtu.be/" + id;
    if (h.url && /^https?:\/\//.test(h.url)) return h.url;
    return "";
  }

  // Resolve an 11-char YouTube id from a highlight record — the cron's resolved
  // youtubeId, or one parsed from the FotMob clip URL when it's a YouTube link.
  function ytIdOf(h) {
    var direct = h && h.youtubeId;
    if (direct && /^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;
    var m = String((h && h.url) || "").match(
      /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }

  // Click-to-load facade: a thumbnail + play button. The iframe is only created
  // on click (lighter, and no YouTube cookies until the user opts in).
  function ytFacadeHtml(id) {
    return '<button class="hl-embed" type="button" data-yt="' + escapeHtml(id) +
        '" aria-label="' + escapeHtml(t("mdWatch")) + '">' +
      '<img class="hl-thumb" loading="lazy" alt="" src="https://i.ytimg.com/vi/' +
        encodeURIComponent(id) + '/hqdefault.jpg" />' +
      '<span class="hl-play" aria-hidden="true">▶</span>' +
    "</button>";
  }

  function loadHlEmbed(box) {
    var id = box.getAttribute("data-yt") || "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || box.querySelector("iframe")) return;
    box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' +
      encodeURIComponent(id) + '?autoplay=1&rel=0" title="' + escapeHtml(t("mdHighlights")) +
      '" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture; web-share" ' +
      "allowfullscreen></iframe>";
    box.classList.add("playing");
  }

  // ---- Rendering ----------------------------------------------------------

  function showStatus(kind, badge, text) {
    el.status.hidden = false;
    el.status.className = "status" + (kind === "error" ? " error" : "");
    el.status.innerHTML = '<span class="badge">' + escapeHtml(badge) + "</span>" + escapeHtml(text);
  }

  function renderSkeletons() {
    var html = "";
    for (var i = 0; i < 5; i++) html += '<div class="skeleton"></div>';
    el.games.innerHTML = html;
    el.status.hidden = true;
  }

  function badgeHtml(url, name) {
    if (url) {
      return '<img src="' + escapeHtml(url) + '" alt="" loading="lazy" ' +
        "onerror=\"this.outerHTML='<span class=\\'badge-fallback\\'>" +
        escapeHtml(initials(name)) + "</span>'\" />";
    }
    return '<span class="badge-fallback">' + escapeHtml(initials(name)) + "</span>";
  }

  function initials(name) {
    return (name || "?").trim().slice(0, 2).toUpperCase();
  }

  // Championship / league logo, with a monogram fallback when the feed has
  // no badge (e.g. offline sample data or a competition without artwork).
  function leagueLogoHtml(url, name) {
    if (url) {
      return '<img class="league-logo" src="' + escapeHtml(url) + '" alt="" loading="lazy" ' +
        "onerror=\"this.outerHTML='<span class=\\'league-logo league-fallback\\'>" +
        escapeHtml(initials(name)) + "</span>'\" />";
    }
    return '<span class="league-logo league-fallback">' + escapeHtml(initials(name)) + "</span>";
  }

  function timeCellHtml(fx) {
    var st = statusOf(fx);
    var clock = formatClock(new Date(fx.kickoff));
    if (st.state === "live") {
      return '<div class="clock">' + escapeHtml(clock) + "</div>" +
        '<span class="live">' + escapeHtml(st.label || "LIVE") + "</span>";
    }
    if (st.state === "finished") {
      return '<div class="clock">' + escapeHtml(clock) + "</div>" +
        '<span class="ft">' + escapeHtml(st.label || "FT") + "</span>";
    }
    return '<div class="clock">' + escapeHtml(clock) + "</div>";
  }

  function scoreHtml(fx, side) {
    if (!hasScore(fx)) return "";
    var st = statusOf(fx);
    if (st.state === "upcoming") return "";
    var val = side === "home" ? fx.homeScore : fx.awayScore;
    return '<span class="score">' + escapeHtml(val) + "</span>";
  }

  // Country name -> flag emoji, for real listings which come keyed by the
  // broadcaster's country (any unknown country falls back to a generic icon).
  var COUNTRY_FLAGS = {
    "Portugal": "🇵🇹", "United Kingdom": "🇬🇧", "England": "🇬🇧", "Ireland": "🇮🇪",
    "United States": "🇺🇸", "USA": "🇺🇸", "Spain": "🇪🇸", "Brazil": "🇧🇷",
    "France": "🇫🇷", "Germany": "🇩🇪", "Italy": "🇮🇹", "Netherlands": "🇳🇱",
    "Belgium": "🇧🇪", "Portugal ": "🇵🇹", "Argentina": "🇦🇷", "Mexico": "🇲🇽",
    "Canada": "🇨🇦", "Australia": "🇦🇺", "Saudi Arabia": "🇸🇦", "Turkey": "🇹🇷",
    "Greece": "🇬🇷", "Switzerland": "🇨🇭", "Austria": "🇦🇹", "Poland": "🇵🇱",
    "Sweden": "🇸🇪", "Norway": "🇳🇴", "Denmark": "🇩🇰", "Finland": "🇫🇮",
    "Japan": "🇯🇵", "South Korea": "🇰🇷", "China": "🇨🇳", "India": "🇮🇳",
    "Russia": "🇷🇺", "Croatia": "🇭🇷", "Serbia": "🇷🇸", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
    "Romania": "🇷🇴", "Ukraine": "🇺🇦", "Czech Republic": "🇨🇿", "Hungary": "🇭🇺",
    "International": "🌍", "Worldwide": "🌍",
  };

  function countryFlag(name) {
    return COUNTRY_FLAGS[(name || "").trim()] || "📺";
  }

  // ISO country code -> display name, for the IP-derived default country.
  var CODE_TO_COUNTRY = {
    PT: "Portugal", GB: "United Kingdom", IE: "Ireland", US: "United States",
    ES: "Spain", BR: "Brazil", FR: "France", DE: "Germany", IT: "Italy",
    NL: "Netherlands", BE: "Belgium", AR: "Argentina", MX: "Mexico", CA: "Canada",
    AU: "Australia", SA: "Saudi Arabia", TR: "Turkey", GR: "Greece", CH: "Switzerland",
    AT: "Austria", PL: "Poland", SE: "Sweden", NO: "Norway", DK: "Denmark",
    FI: "Finland", JP: "Japan", KR: "South Korea", CN: "China", IN: "India",
    RO: "Romania", UA: "Ukraine", CZ: "Czech Republic", HU: "Hungary", RS: "Serbia",
    HR: "Croatia",
  };

  // Listings are surfaced with the user's chosen country first (defaults to the
  // IP country, or Portugal), then a few major markets, then the rest A–Z.
  var COUNTRY_PRIORITY = ["United Kingdom", "England", "Spain",
    "Brazil", "France", "Italy", "Germany", "Netherlands", "United States"];

  function orderCountries(names) {
    var primary = state.primaryCountry;
    return names.slice().sort(function (a, b) {
      if (a === primary && b !== primary) return -1;
      if (b === primary && a !== primary) return 1;
      var ia = COUNTRY_PRIORITY.indexOf(a); if (ia === -1) ia = 999;
      var ib = COUNTRY_PRIORITY.indexOf(b); if (ib === -1) ib = 999;
      return ia !== ib ? ia - ib : a.localeCompare(b);
    });
  }

  // A single channel chip, tagged free-to-air or paid cable / subscription.
  function channelChip(name) {
    var paid = window.isPaidChannel(name);
    return '<span class="channel ' + (paid ? "paid" : "free") + '" title="' +
      (paid ? t("paidSub") : t("freeAir")) + '">' +
      (paid ? '<span class="lock" aria-hidden="true">🔒</span>' : "") +
      escapeHtml(name) + "</span>";
  }

  function groupByCountry(tv) {
    var byCountry = {};
    tv.forEach(function (t) {
      var c = t.country || "International";
      if (!byCountry[c]) byCountry[c] = [];
      if (byCountry[c].indexOf(t.channel) === -1) byCountry[c].push(t.channel);
    });
    return byCountry;
  }

  // Card view: show the primary country's channels (or the top available country
  // if the primary has none for this match), with the rest summarised as
  // "+N more in details" — the full per-country breakdown lives in the modal.
  var MAX_CARD_CHIPS = 3; // keep cards compact on mobile; rest live in the modal
  function realChannelsHtml(tv) {
    var byCountry = groupByCountry(tv);
    var ordered = orderCountries(Object.keys(byCountry));
    var lead = byCountry[state.primaryCountry] ? state.primaryCountry : ordered[0];
    var leadChannels = byCountry[lead];
    var chips = leadChannels.slice(0, MAX_CARD_CHIPS).map(channelChip).join("");
    var hiddenChips = leadChannels.length - MAX_CARD_CHIPS;
    if (hiddenChips > 0) chips += '<span class="channel more-inline">+' + hiddenChips + "</span>";
    var others = ordered.filter(function (c) { return c !== lead; }).length;
    var more = others
      ? '<span class="more-countries">+' + others + " " +
        (others === 1 ? t("moreOne") : t("moreMany")) + "</span>"
      : "";
    return '<span class="src-tag real" title="' + escapeHtml(t("realListings")) + '">' +
      t("listings") + "</span>" +
      '<span class="country-group" title="' + escapeHtml(lead) + '">' +
      '<span class="flag">' + countryFlag(lead) + "</span>" + chips + "</span>" + more;
  }

  // Real listings only — no curated guesswork. Matches without a crowd-sourced
  // listing simply show "No TV listing yet".
  function channelsHtml(fx) {
    if (fx && fx.tv && fx.tv.length) return realChannelsHtml(fx.tv);
    return '<span class="channel none">' + t("noListing") + "</span>";
  }

  // A "▶ Highlights" link on the card, shown only when the cron has collected a
  // watchable highlight for this game (see highlightLink). Opens the video.
  function highlightBtnHtml(fx) {
    var link = highlightLink(fx);
    if (!link) return "";
    return '<a class="hl-card-btn" href="' + escapeHtml(link) + '" target="_blank" rel="noopener" ' +
      'aria-label="' + escapeHtml(t("hlCardAria")) + '">▶ ' + escapeHtml(t("hlCard")) + "</a>";
  }

  function matchHtml(fx) {
    var st = statusOf(fx);
    var cls = "match" + (st.state === "live" ? " is-live" : "");
    // The card's title (time + teams) is a real link to the game's /g/<id>
    // page so crawlers can discover it and the URL is shareable; JS intercepts
    // the click to open the in-app detail modal instead of navigating
    // (progressive enhancement). The share button and the highlights link stay
    // siblings of the link — never interactive elements nested inside an <a>.
    return '<article class="' + cls + '" data-id="' + escapeHtml(fx.id) + '">' +
      '<button class="share-btn" type="button" data-share aria-label="' +
        escapeHtml(t("shareGame")) + '" title="' + escapeHtml(t("shareGame")) + '">' +
        SHARE_ICON + "</button>" +
      '<a class="match-link" href="' + escapeHtml(shareLink(fx)) +
        '" aria-label="' + escapeHtml(fx.home + " vs " + fx.away) + '">' +
        '<div class="match-time">' + timeCellHtml(fx) + "</div>" +
        '<div class="teams">' +
          '<div class="team">' + badgeHtml(fx.homeBadge, fx.home) +
            '<span class="team-name">' + escapeHtml(fx.home) + "</span>" +
            scoreHtml(fx, "home") + "</div>" +
          '<div class="team">' + badgeHtml(fx.awayBadge, fx.away) +
            '<span class="team-name">' + escapeHtml(fx.away) + "</span>" +
            scoreHtml(fx, "away") + "</div>" +
        "</div>" +
      "</a>" +
      '<div class="channels">' + highlightBtnHtml(fx) + channelsHtml(fx) + "</div>" +
      '<span class="details-hint">' + t("clickDetails") + "</span>" +
    "</article>";
  }

  function applyFilter(fixtures) {
    var q = state.search.trim().toLowerCase();
    if (!q) return fixtures;
    return fixtures.filter(function (fx) {
      return (fx.home + " " + fx.away + " " + fx.competition).toLowerCase().indexOf(q) > -1;
    });
  }

  function isHidden(competition) {
    return !!state.hidden[competition || "Football"];
  }

  // Competition ordering: the biggest tournaments first (by FotMob league id),
  // then the selected country's competitions, then everything else A–Z.
  var COMP_PRIORITY = [77, 76, 50, 44, 9134, 42, 73, 10216, 45];
  var COUNTRY_CCODES = {
    "Portugal": ["POR"], "Spain": ["ESP"], "England": ["ENG"],
    "United Kingdom": ["ENG", "SCO", "WAL", "NIR"], "France": ["FRA"],
    "Germany": ["GER"], "Italy": ["ITA"], "Netherlands": ["NED"],
    "Brazil": ["BRA"], "United States": ["USA"], "Argentina": ["ARG"],
    "Mexico": ["MEX"],
  };

  function compRank(meta) {
    var pri = meta.leagueId != null ? COMP_PRIORITY.indexOf(Number(meta.leagueId)) : -1;
    if (pri >= 0) return [0, pri, ""];
    var mine = COUNTRY_CCODES[state.primaryCountry] || [];
    if (meta.ccode && mine.indexOf(meta.ccode) >= 0) return [1, 0, meta.name];
    return [2, 0, meta.name];
  }

  function render() {
    // Drop leagues the user has filtered out, then apply the search.
    var shown = state.fixtures.filter(function (fx) { return !isHidden(fx.competition); });
    var hiddenSome = shown.length !== state.fixtures.length;
    var fixtures = applyFilter(shown);

    if (!fixtures.length) {
      var msg = state.fixtures.length && hiddenSome && !state.search
        ? t("allFiltered") : t("noSearch");
      el.games.innerHTML = '<div class="empty"><div class="big">⚽</div><p>' + msg + "</p></div>";
      return;
    }

    // Group by competition, capturing each group's league id + country code.
    var groups = {};
    var meta = {};
    var order = [];
    fixtures.forEach(function (fx) {
      var key = fx.competition || "Football";
      if (!groups[key]) {
        groups[key] = [];
        meta[key] = { name: key, leagueId: fx.leagueId, ccode: fx.ccode };
        order.push(key);
      }
      groups[key].push(fx);
    });

    // Order by importance (big tournaments) → selected country → rest A–Z;
    // matches within a group by kickoff.
    order.sort(function (a, b) {
      var ra = compRank(meta[a]), rb = compRank(meta[b]);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2].localeCompare(rb[2]);
    });

    // Insert an ad after every Nth card, counted across all competitions.
    var ads = adsEnabled();
    var everyN = ADS.everyN || 6;
    var cardCount = 0;

    function cardFor(g) {
      var out = matchHtml(g);
      cardCount++;
      if (ads && cardCount % everyN === 0) out += adSlotHtml(ADS.slot);
      return out;
    }

    var html = order.map(function (comp) {
      // Sort by group first (so a tournament reads A, B, C…), then by kickoff.
      var games = groups[comp].sort(function (a, b) {
        return (a.group || "").localeCompare(b.group || "") ||
          new Date(a.kickoff) - new Date(b.kickoff);
      });
      var badged = games.filter(function (g) { return g.leagueBadgeUrl; })[0];
      var badgeUrl = badged ? badged.leagueBadgeUrl : "";

      // When a tournament spans several groups (World Cup, continental cups),
      // split its section into one labelled block per group.
      var buckets = {}, groupOrder = [];
      games.forEach(function (g) {
        var k = g.group || "";
        if (!buckets[k]) { buckets[k] = []; groupOrder.push(k); }
        buckets[k].push(g);
      });
      var multiGroup = groupOrder.length > 1 || (groupOrder.length === 1 && groupOrder[0]);

      var body = groupOrder.map(function (k) {
        var head = (multiGroup && k)
          ? '<h3 class="group-head">' + escapeHtml(t("group") + " " + k) + "</h3>"
          : "";
        return head + buckets[k].map(cardFor).join("");
      }).join("");

      return '<section class="competition">' +
        '<h2 class="competition-head">' +
          leagueLogoHtml(badgeUrl, comp) +
          '<span class="competition-name">' + escapeHtml(comp) + "</span>" +
          '<span class="count">' + games.length + "</span></h2>" +
        body +
      "</section>";
    }).join("");

    el.games.innerHTML = html;
    if (ads) mountAds();
  }

  function renderDateLabel() {
    var today = new Date();
    var label;
    if (isSameDay(state.date, today)) {
      label = t("today");
    } else {
      label = state.date.toLocaleDateString(locale() || [], {
        weekday: "long", day: "numeric", month: "long",
      });
    }
    el.currentDate.textContent = label;
  }

  // ---- League filter ------------------------------------------------------

  function loadFilters() {
    state.remember = localStorage.getItem(STORAGE_REMEMBER) === "1";
    state.hidden = {};
    if (state.remember) {
      try {
        var saved = JSON.parse(localStorage.getItem(STORAGE_HIDDEN) || "[]");
        if (Array.isArray(saved)) {
          saved.forEach(function (name) { state.hidden[name] = true; });
        }
      } catch (e) {}
    }
    el.rememberFilters.checked = state.remember;
  }

  // Persist the remember flag always; persist the hidden set only while the
  // user has opted in to remembering it.
  function saveFilters() {
    localStorage.setItem(STORAGE_REMEMBER, state.remember ? "1" : "0");
    if (state.remember) {
      localStorage.setItem(STORAGE_HIDDEN, JSON.stringify(Object.keys(state.hidden)));
    } else {
      localStorage.removeItem(STORAGE_HIDDEN);
    }
  }

  function hiddenCount() {
    return Object.keys(state.hidden).filter(function (k) { return state.hidden[k]; }).length;
  }

  // Rebuild the checkbox list from the competitions currently in the data,
  // and refresh the toggle button's "N hidden" badge.
  function updateLeaguePanel() {
    var counts = {};
    state.fixtures.forEach(function (fx) {
      var c = fx.competition || "Football";
      counts[c] = (counts[c] || 0) + 1;
    });
    var comps = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });

    el.leagueList.innerHTML = comps.map(function (c) {
      var checked = isHidden(c) ? "" : " checked";
      return '<label class="league-row">' +
        '<input type="checkbox" value="' + escapeHtml(c) + '"' + checked + " />" +
        '<span class="name">' + escapeHtml(c) + "</span>" +
        '<span class="n">' + counts[c] + "</span></label>";
    }).join("") || '<p class="n" style="padding:6px 4px">No leagues to filter.</p>';

    var n = hiddenCount();
    el.leagueToggleLabel.innerHTML = "Leagues" +
      (n ? ' <span class="count-badge">' + n + " hidden</span>" : "");
  }

  function setLeagueHidden(name, hidden) {
    if (hidden) state.hidden[name] = true;
    else delete state.hidden[name];
    saveFilters();
    render();
    // Keep the toggle badge in sync without rebuilding the open list.
    var n = hiddenCount();
    el.leagueToggleLabel.innerHTML = "Leagues" +
      (n ? ' <span class="count-badge">' + n + " hidden</span>" : "");
  }

  function resetFilters() {
    state.hidden = {};
    saveFilters();
    updateLeaguePanel();
    render();
  }

  function openPanel(open) {
    el.filterPanel.hidden = !open;
    el.leagueToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---- Match details modal ------------------------------------------------

  // One row per country, with channels labelled free-to-air or paid. Uses the
  // real broadcast listings when available, otherwise the curated rights guide.
  function detailChannelRow(flag, label, chips) {
    return '<div class="detail-channel-row">' +
      '<span class="detail-country"><span class="flag">' + flag + "</span>" +
        escapeHtml(label) + "</span>" +
      '<span class="detail-chips">' + chips + "</span></div>";
  }

  function detailChannelsHtml(fx, checking) {
    if (fx.tv && fx.tv.length) {
      var byCountry = {};
      fx.tv.forEach(function (t) {
        var c = t.country || "International";
        if (!byCountry[c]) byCountry[c] = [];
        if (byCountry[c].indexOf(t.channel) === -1) byCountry[c].push(t.channel);
      });
      return '<p class="src-note real">' + t("realListings") + "</p>" +
        orderCountries(Object.keys(byCountry)).map(function (c) {
          return detailChannelRow(countryFlag(c), c, byCountry[c].map(channelChip).join(""));
        }).join("");
    }
    return checking
      ? '<p class="src-note checking">' + t("checking") + "</p>"
      : '<p class="src-note guide">' + t("noListingDetail") + "</p>";
  }

  // Localised label for a normalised stat key from /api/matchdetails.
  var STAT_LABEL = { possession: "stPossession", shots: "stShots", sot: "stSot",
    xg: "stXg", corners: "stCorners", fouls: "stFouls" };
  function statLabel(key) { return STAT_LABEL[key] ? t(STAT_LABEL[key]) : key; }

  function formPills(arr) {
    if (!arr || !arr.length) return '<span class="muted">—</span>';
    return arr.map(function (r) {
      var cls = r === "W" ? "w" : r === "L" ? "l" : "d";
      var label = r === "W" ? t("mdW") : r === "L" ? t("mdL") : t("mdD");
      return '<span class="form-pill ' + cls + '">' + escapeHtml(label) + "</span>";
    }).join("");
  }

  var EVENT_ICON = { goal: "⚽", owngoal: "⚽", pengoal: "⚽", yellow: "🟨", red: "🟥", sub: "🔁" };
  function eventLine(ev, scoreStr) {
    var kindCls = (ev.kind === "yellow" || ev.kind === "red") ? "card "
      : ev.kind === "sub" ? "sub " : "goal ";
    var icon = '<span class="event-icon ' + kindCls + ev.kind + '">' + (EVENT_ICON[ev.kind] || "•") +
      (scoreStr ? '<b>' + escapeHtml(scoreStr) + "</b>" : "") + "</span>";
    var who = '<span class="event-player">' + escapeHtml(ev.player || "") + "</span>";
    if (ev.kind === "owngoal") who += ' <span class="event-note">(OG)</span>';
    else if (ev.kind === "pengoal") who += ' <span class="event-note">(pen.)</span>';
    else if (ev.kind === "sub" && ev.note) who += ' <span class="event-note">↔ ' + escapeHtml(ev.note) + "</span>";
    else if (ev.note) who += ' <span class="event-note">(' + escapeHtml(ev.note) + ")</span>";
    var min = '<span class="event-min">' + escapeHtml(ev.min || "") + "</span>";
    var side = ev.side === "away" ? "away" : "home";
    // Home: [min][icon][who] left-aligned. Away: row-reversed so it reads
    // [who][icon][min] anchored to the right edge.
    return '<div class="event-row ' + side + '">' + min + icon +
      '<span class="event-text">' + who + "</span></div>";
  }

  // ---- Pitch line-up rendering --------------------------------------------
  // Default row split (outfield only) when FotMob gives no usable formation.
  function defaultRows(out) {
    if (out === 10) return [4, 3, 3];
    var rows = [], rem = out;
    while (rem > 0) { var take = Math.min(4, rem); rows.push(take); rem -= take; }
    return rows;
  }
  // Parse "4-3-3" → [4,3,3], but only trust it when it accounts for every
  // outfield player; otherwise fall back to a sensible default split.
  function parseFormation(f, out) {
    var r = String(f || "").trim().split(/[^0-9]+/).filter(Boolean)
      .map(Number).filter(function (n) { return n > 0 && n <= 6; });
    if (!r.length) return null;
    var sum = r.reduce(function (a, b) { return a + b; }, 0);
    return sum === out ? r : null;
  }
  // Group a starting XI into bands [GK, ...formation rows], goal-line first.
  function lineupBands(starters, formation) {
    var s = (starters || []).slice(0, 11);
    if (!s.length) return [];
    var out = s.length - 1;
    var rows = parseFormation(formation, out) || defaultRows(out);
    var bands = [[s[0]]], idx = 1;
    rows.forEach(function (cnt) {
      var band = [];
      for (var i = 0; i < cnt && idx < s.length; i++) band.push(s[idx++]);
      if (band.length) bands.push(band);
    });
    if (idx < s.length) bands.push(s.slice(idx));
    return bands;
  }
  // Black or white number text for legibility on a given shirt colour.
  function contrastText(hex) {
    var c = String(hex || "").replace("#", "");
    if (c.length !== 6) return "#fff";
    var r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#111" : "#fff";
  }
  // Resolve each side's shirt colour, falling back to a blue/light pair and
  // nudging them apart if FotMob reports the same colour for both teams.
  function jerseyColors(lineups) {
    var c = (lineups && lineups.colors) || {};
    var home = (c.home || "#2563eb").toLowerCase();
    var away = (c.away || "#e5e7eb").toLowerCase();
    if (home === away) away = contrastText(home) === "#fff" ? "#e5e7eb" : "#1f2937";
    return { home: home, away: away };
  }
  var JERSEY_PATH = "M22 4 C25 9 35 9 38 4 L47 7 L58 16 L49 28 L43 24 L43 52 L17 52 L17 24 L11 28 L2 16 L13 7 Z";
  // Pitch labels are narrow (~54px). When a full name would overflow, shorten it
  // to "F. Lastname" (first initial + the rest); a still-too-long surname is left
  // to the CSS ellipsis. The full name always stays in the node's title.
  var _nameCanvas;
  function pitchLabel(name) {
    var full = String(name || "").trim();
    if (!full) return "";
    try {
      if (!_nameCanvas) _nameCanvas = document.createElement("canvas").getContext("2d");
      _nameCanvas.font = '600 10.9px "Segoe UI", system-ui, -apple-system, Roboto, sans-serif';
      if (_nameCanvas.measureText(full).width <= 54) return full;
      var parts = full.split(/\s+/);
      if (parts.length > 1) return parts[0].charAt(0) + ". " + parts.slice(1).join(" ");
    } catch (e) {}
    return full;
  }
  // One team's XI laid out on a vertical pitch (GK at the bottom goal).
  function pitchHtml(side, color) {
    var bands = lineupBands(side && side.starters, side && side.formation);
    if (!bands.length) return "";
    var txt = contrastText(color);
    var n = bands.length;
    var nodes = "";
    bands.forEach(function (band, bi) {
      var y = n > 1 ? 92 - bi * (84 / (n - 1)) : 50;
      var k = band.length;
      band.forEach(function (p, pj) {
        // Spread the row across most of the pitch width (10%–90%) so adjacent
        // name labels don't collide; a lone player sits on the centre line.
        var x = k > 1 ? 10 + (pj / (k - 1)) * 80 : 50;
        var num = p.num ? '<span class="pitch-num" style="color:' + txt + '">' +
          escapeHtml(String(p.num)) + "</span>" : "";
        nodes += '<div class="pitch-player" style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + '%">' +
          '<span class="pitch-jersey"><svg class="jersey" viewBox="0 0 60 56" aria-hidden="true">' +
            '<path d="' + JERSEY_PATH + '" fill="' + color + '" stroke="rgba(0,0,0,.28)" stroke-width="1.5"/>' +
          "</svg>" + num + "</span>" +
          '<span class="pitch-name" title="' + escapeHtml(p.name) + '">' + escapeHtml(pitchLabel(p.name)) + "</span>" +
          "</div>";
      });
    });
    return '<div class="pitch">' +
      '<span class="pm-line"></span><span class="pm-circle"></span>' +
      '<span class="pm-box top"></span><span class="pm-box bottom"></span>' +
      nodes + "</div>";
  }
  // Header + pitch for one side; "" when that side has no XI yet.
  function pitchWrap(teamName, side, color) {
    if (!side || !Array.isArray(side.starters) || !side.starters.length) return "";
    var formation = side.formation
      ? ' <span class="lineup-formation">' + escapeHtml(side.formation) + "</span>" : "";
    return '<div class="pitch-wrap"><p class="pitch-team">' + escapeHtml(teamName) + formation + "</p>" +
      pitchHtml(side, color) + "</div>";
  }

  // Everything sourced from /api/matchdetails. Renders only the sections that
  // came back with data; shows a one-line loading hint until the fetch resolves.
  function detailExtrasHtml(fx) {
    if (!fx._detailsLoaded) {
      return '<p class="src-note checking">' + t("mdLoading") + "</p>";
    }
    var d = fx._details;
    if (!d) return "";
    var out = "";

    // Highlights: embed the video inline when we have an embeddable YouTube id
    // (from FotMob's own clip or the cron's Data API lookup), link FotMob's clip
    // when present, and always offer a keyless YouTube search for finished games.
    var finished = statusOf(fx).state === "finished";
    if (d.highlights && (d.highlights.url || d.highlights.youtubeId) || finished) {
      var embedId = d.highlights ? ytIdOf(d.highlights) : "";
      var ytq = encodeURIComponent(fx.home + " vs " + fx.away + " " +
        (fx.competition || "") + " highlights");
      var ytUrl = "https://www.youtube.com/results?search_query=" + ytq;
      out += '<h3 class="detail-h">' + t("mdHighlights") + "</h3>" +
        (embedId ? '<div class="detail-embed">' + ytFacadeHtml(embedId) + "</div>" : "") +
        '<div class="detail-highlights">' +
          (d.highlights && d.highlights.url
            ? '<a class="hl-btn" href="' + escapeHtml(d.highlights.url) +
                '" target="_blank" rel="noopener">' + t("mdWatch") + "</a>"
            : "") +
          '<a class="hl-btn yt" href="' + ytUrl + '" target="_blank" rel="noopener">' +
            t("mdYouTube") + "</a>" +
        "</div>";
    }

    if (d.events && d.events.length) {
      var hs = 0, as = 0;
      var rows = d.events.map(function (ev) {
        var scoreStr = "";
        if (ev.kind === "goal" || ev.kind === "pengoal" || ev.kind === "owngoal") {
          // An own goal credits the opposing side.
          var scoresHome = ev.kind === "owngoal" ? (ev.side === "away") : (ev.side === "home");
          if (scoresHome) hs++; else as++;
          scoreStr = hs + "–" + as;
        }
        return eventLine(ev, scoreStr);
      });
      out += '<h3 class="detail-h">' + t("mdTimeline") + "</h3>" +
        '<div class="detail-timeline">' +
          '<div class="timeline-legend"><span>' + escapeHtml(fx.home) + "</span>" +
            "<span>" + escapeHtml(fx.away) + "</span></div>" +
          rows.join("") + "</div>";
    }

    if (d.stats && d.stats.length) {
      out += '<h3 class="detail-h">' + t("mdStats") + "</h3>" +
        '<div class="detail-stats">' + d.stats.map(function (s) {
          return '<div class="stat-row"><span class="stat-h">' + escapeHtml(s.home) + "</span>" +
            '<span class="stat-label">' + escapeHtml(statLabel(s.key)) + "</span>" +
            '<span class="stat-a">' + escapeHtml(s.away) + "</span></div>";
        }).join("") + "</div>";
    }

    // Probable (or confirmed) starting line-ups, drawn on a pitch per team with
    // the club's shirt colours, formation and shirt numbers.
    var lu = d.lineups;
    if (lu && (lu.home || lu.away)) {
      var col = jerseyColors(lu);
      var pitches = pitchWrap(fx.home, lu.home, col.home) + pitchWrap(fx.away, lu.away, col.away);
      if (pitches) {
        out += '<h3 class="detail-h">' + (lu.confirmed ? t("mdLineups") : t("mdLineupsProb")) + "</h3>" +
          '<div class="detail-pitches">' + pitches + "</div>" +
          (lu.confirmed ? "" : '<p class="src-note">' + t("mdLineupsNote") + "</p>");
      }
    }

    if (d.form && (d.form.home.length || d.form.away.length)) {
      out += '<h3 class="detail-h">' + t("mdForm") + "</h3>" +
        '<div class="detail-form">' +
          '<div class="form-side"><span>' + escapeHtml(fx.home) + "</span>" + formPills(d.form.home) + "</div>" +
          '<div class="form-side"><span>' + escapeHtml(fx.away) + "</span>" + formPills(d.form.away) + "</div>" +
        "</div>";
    }

    if (d.h2h) {
      out += '<h3 class="detail-h">' + t("mdH2h") + "</h3>" +
        '<div class="detail-h2h">' +
          "<span><strong>" + d.h2h.home + "</strong> " + escapeHtml(fx.home) + "</span>" +
          "<span><strong>" + d.h2h.draw + "</strong> " + t("mdD") + "</span>" +
          "<span><strong>" + d.h2h.away + "</strong> " + escapeHtml(fx.away) + "</span>" +
        "</div>";
    }

    return out;
  }

  function buildDetailBody(fx, checking) {
    var d = fx._details || null;
    var st = statusOf(fx);
    var kickoff = new Date(fx.kickoff);
    var dateStr = kickoff.toLocaleDateString(locale() || [], {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    var timeStr = kickoff.toLocaleTimeString(locale() || [], { hour: "2-digit", minute: "2-digit" });
    var score = hasScore(fx) && st.state !== "upcoming"
      ? '<div class="detail-score">' + escapeHtml(fx.homeScore) + " – " + escapeHtml(fx.awayScore) + "</div>"
      : '<div class="detail-vs">' + t("vs") + "</div>";
    var statusBadge = st.state === "live"
      ? '<span class="detail-status live">' + escapeHtml(st.label || "LIVE") + "</span>"
      : st.state === "finished"
        ? '<span class="detail-status ft">' + escapeHtml(st.label || "FT") + "</span>"
        : '<span class="detail-status">' + escapeHtml(timeStr) + "</span>";

    var round = d && d.round ? " · " + d.round : "";
    var compLabel = fx.competition + (fx.group ? " · " + t("group") + " " + fx.group : "") + round;
    var venue = fx.venue || (d && d.venue) || "";
    return '<div class="detail-comp">' + leagueLogoHtml(fx.leagueBadgeUrl, fx.competition) +
        '<span id="detail-title">' + escapeHtml(compLabel) + "</span></div>" +
      '<div class="detail-teams">' +
        '<div class="detail-team">' + badgeHtml(fx.homeBadge, fx.home) +
          "<span>" + escapeHtml(fx.home) + "</span></div>" +
        score +
        '<div class="detail-team">' + badgeHtml(fx.awayBadge, fx.away) +
          "<span>" + escapeHtml(fx.away) + "</span></div>" +
      "</div>" +
      '<div class="detail-meta">' + statusBadge +
        (fx.note ? '<span class="detail-note">⚠ ' + escapeHtml(fx.note) + "</span>" : "") +
        "<span>📅 " + escapeHtml(dateStr) + " · " + escapeHtml(timeStr) + "</span>" +
        (venue ? "<span>📍 " + escapeHtml(venue) + "</span>" : "") +
        (d && d.referee ? "<span>🧑‍⚖️ " + escapeHtml(d.referee) + "</span>" : "") +
        (d && d.attendance ? "<span>👥 " + escapeHtml(d.attendance) + "</span>" : "") +
        (d && d.motm ? '<span class="detail-motm">⭐ ' + t("mdMotm") + ": " + escapeHtml(d.motm.name) +
          (d.motm.rating ? " (" + escapeHtml(d.motm.rating) + ")" : "") + "</span>" : "") +
      "</div>" +
      '<h3 class="detail-h">' + t("whereToWatch") + "</h3>" +
      '<div class="detail-legend">' +
        '<span class="channel free">' + t("freeAir") + "</span>" +
        '<span class="channel paid"><span class="lock">🔒</span>' + t("paidSub") + "</span>" +
      "</div>" +
      detailChannelsHtml(fx, checking) +
      detailExtrasHtml(fx);
  }

  function openDetails(id, opts) {
    opts = opts || {};
    var fx = state.fixtures.filter(function (f) { return String(f.id) === String(id); })[0];
    if (!fx) return;
    state.detailId = String(id);

    // Reflect the open match in the URL (the same /g/<id> page that's server-
    // rendered for crawlers), so it's shareable and the back button closes it.
    // Skipped when we're reacting to a popstate/deep-link (opts.push === false).
    if (opts.push !== false && window.history && history.pushState) {
      try { history.pushState({ hhbMatch: String(id) }, "", shareLink(fx)); } catch (e) {}
    }

    // Listings usually arrive via the background prefetch; if this match hasn't
    // resolved yet, show a "checking" state and load it on demand.
    var pending = !fx._tvLoaded;

    el.detailBody.innerHTML = buildDetailBody(fx, pending);
    el.detailOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    el.detailClose.focus();

    // Re-render the modal in place once either source resolves, but only while
    // this same match is still open.
    var stillOpen = function () { return !el.detailOverlay.hidden && state.detailId === String(id); };
    var repaint = function () { if (stillOpen()) el.detailBody.innerHTML = buildDetailBody(fx, !fx._tvLoaded); };

    if (pending) {
      ensureEventTv(fx).then(function (list) {
        repaint();
        if (stillOpen() && list && list.length) { updateCardListings(fx); updateTvCount(); }
      });
    }
    if (!fx._detailsLoaded) {
      ensureDetails(fx).then(repaint);
    }
  }

  function closeDetails(opts) {
    opts = opts || {};
    if (el.detailOverlay.hidden) return;
    el.detailOverlay.hidden = true;
    document.body.style.overflow = "";
    state.detailId = null;
    // Pop the history entry we pushed on open so the URL returns to the list
    // (unless we're already handling a popstate, where the URL has moved itself).
    if (opts.pop !== false && window.history && history.state && history.state.hhbMatch) {
      try { history.back(); } catch (e) {}
    }
  }

  // ---- Events -------------------------------------------------------------

  function shiftDay(delta) {
    var d = new Date(state.date);
    d.setDate(d.getDate() + delta);
    state.date = d;
    renderDateLabel();
    loadFixtures();
  }

  // ---- Primary country (TV listings) --------------------------------------

  // Options = the known countries plus any seen in the loaded fixtures, A–Z.
  function countryOptionSet() {
    var set = {};
    Object.keys(CODE_TO_COUNTRY).forEach(function (k) { set[CODE_TO_COUNTRY[k]] = true; });
    state.fixtures.forEach(function (fx) {
      (fx.tv || []).forEach(function (t) { if (t.country) set[t.country] = true; });
    });
    set[state.primaryCountry] = true;
    return Object.keys(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function populateCountrySelect() {
    if (!el.countrySelect) return;
    el.countrySelect.innerHTML = countryOptionSet().map(function (c) {
      return '<option value="' + escapeHtml(c) + '"' +
        (c === state.primaryCountry ? " selected" : "") + ">" +
        countryFlag(c) + " " + escapeHtml(c) + "</option>";
    }).join("");
  }

  function setPrimaryCountry(name, persist) {
    if (!name || name === state.primaryCountry) {
      if (persist && name) { try { localStorage.setItem(STORAGE_COUNTRY, name); } catch (e) {} }
      return;
    }
    var langBefore = lang();
    state.primaryCountry = name;
    if (persist) { try { localStorage.setItem(STORAGE_COUNTRY, name); } catch (e) {} }
    if (lang() !== langBefore) applyStaticText(); // switched to/from Portuguese
    populateCountrySelect();
    render();
    if (!el.detailOverlay.hidden && state.detailId) {
      var fx = state.fixtures.filter(function (f) { return String(f.id) === state.detailId; })[0];
      if (fx) el.detailBody.innerHTML = buildDetailBody(fx, !fx._tvLoaded);
    }
  }

  // Default the primary country to the visitor's IP country (no geolocation
  // permission prompt) unless they've already chosen one. Their choice wins and
  // is remembered.
  function initCountry() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_COUNTRY); } catch (e) {}
    if (stored) { state.primaryCountry = stored; populateCountrySelect(); return; }
    populateCountrySelect();
    fetch("/api/geo", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var name = d && d.country && CODE_TO_COUNTRY[d.country];
        if (name) setPrimaryCountry(name, false);
      })
      .catch(function () {});
  }

  function bindEvents() {
    if (el.countrySelect) {
      el.countrySelect.addEventListener("change", function () {
        setPrimaryCountry(el.countrySelect.value, true);
      });
    }
    if (el.adPrefs) {
      el.adPrefs.addEventListener("click", function (e) {
        e.preventDefault();
        showConsentBanner();
      });
    }
    el.prev.addEventListener("click", function () { shiftDay(-1); });
    el.next.addEventListener("click", function () { shiftDay(1); });
    el.today.addEventListener("click", function () {
      state.date = new Date();
      renderDateLabel();
      loadFixtures();
    });
    var t;
    el.search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        state.search = el.search.value;
        render();
      }, 120);
    });

    // League filter dropdown.
    el.leagueToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      openPanel(el.filterPanel.hidden);
    });
    el.filterPanel.addEventListener("click", function (e) { e.stopPropagation(); });
    el.leagueList.addEventListener("change", function (e) {
      var box = e.target;
      if (box && box.type === "checkbox") {
        setLeagueHidden(box.value, !box.checked);
      }
    });
    el.resetFilters.addEventListener("click", resetFilters);
    el.rememberFilters.addEventListener("change", function () {
      state.remember = el.rememberFilters.checked;
      saveFilters();
    });

    // Open match details on click or keyboard activation. Clicks on the card's
    // share button or highlights link act on their own, not opening the modal.
    el.games.addEventListener("click", function (e) {
      var shareBtn = e.target.closest(".share-btn");
      if (shareBtn) {
        e.stopPropagation();
        var sc = shareBtn.closest(".match[data-id]");
        if (sc) shareMatch(fixtureById(sc.getAttribute("data-id")), shareBtn);
        return;
      }
      if (e.target.closest(".hl-card-btn")) { e.stopPropagation(); return; } // the link navigates itself
      var card = e.target.closest(".match[data-id]");
      if (!card) return;
      // Let modified clicks (new tab/window) follow the real /g/<id> link.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      e.preventDefault(); // stay in the app: open the modal instead of navigating
      openDetails(card.getAttribute("data-id"));
    });
    el.games.addEventListener("keydown", function (e) {
      // The card link handles Enter natively (it's an <a>); only Space needs us.
      // The highlights link sits outside .match-link, so it's excluded already.
      if (e.key !== " " && e.key !== "Spacebar") return;
      if (e.target.closest(".share-btn")) return; // let the share button act itself
      var card = e.target.closest(".match-link") && e.target.closest(".match[data-id]");
      if (card) { e.preventDefault(); openDetails(card.getAttribute("data-id")); }
    });
    // Back/forward between the list and an open match.
    window.addEventListener("popstate", function (e) {
      var s = e.state;
      if (s && s.hhbMatch && fixtureById(s.hhbMatch)) openDetails(s.hhbMatch, { push: false });
      else closeDetails({ pop: false });
    });
    el.detailClose.addEventListener("click", closeDetails);
    if (el.detailShare) {
      el.detailShare.addEventListener("click", function () {
        if (state.detailId) shareMatch(fixtureById(state.detailId), el.detailShare);
      });
    }
    el.detailOverlay.addEventListener("click", function (e) {
      if (e.target === el.detailOverlay) closeDetails();
    });

    // Click-to-load a highlight video in the match-detail modal: swap the
    // thumbnail facade for the YouTube iframe.
    document.addEventListener("click", function (e) {
      var box = e.target.closest(".hl-embed[data-yt]");
      if (box) { e.preventDefault(); loadHlEmbed(box); }
    });

    // Close the dropdown when clicking elsewhere or pressing Escape.
    document.addEventListener("click", function () { openPanel(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { openPanel(false); closeDetails(); }
    });
  }

  // ---- Init ---------------------------------------------------------------

  function init() {
    loadFilters();
    initCountry();
    applyStaticText();
    readDeepLink(); // open a shared match (and its day) if the URL asks for one
    renderDateLabel();
    bindEvents();
    initConsent();
    renderBanners();
    loadFixtures();
    loadHighlights(); // index recent highlights so finished cards get a button
    // When viewing today, silently refresh live scores/status every 60s.
    // On other days just re-render to keep time-based badges accurate.
    setInterval(function () {
      if (isSameDay(state.date, new Date())) {
        loadFixtures(true);
        loadHighlights(); // pick up clips for games that just finished
      } else if (!state.search) {
        render();
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
