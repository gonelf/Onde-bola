/*
 * Localization (EN default, PT when Portugal is the primary country).
 *
 * Ported from the I18N table + lang()/t()/locale() helpers in assets/app.js.
 * The old helpers read the chosen country from a module-global `state`; here
 * they are pure functions parameterised by language so they work the same in a
 * client component and in a server-rendered page.
 */

export const I18N = {
  en: {
    title: "{brand} — Football on TV worldwide",
    tagline: "Football worldwide & where to watch it",
    today: "Today", search: "Search team or competition…",
    leagues: "Leagues", showLeagues: "Show leagues", reset: "Reset filters",
    showAllGames: "Show all games", showFewer: "Show fewer",
    prevDay: "Previous day", nextDay: "Next day",
    countryAria: "Primary country for TV listings", searchAria: "Search games",
    hidden: "hidden", noLeagues: "No leagues to filter.",
    seoH1: "Football on TV today, worldwide — where to watch every match live",
    seoIntroTitle: "Where to watch football on TV today",
    seoP1: "<strong>{brand}</strong> shows you every football (soccer) match being played around the world today and exactly <strong>which TV channels and streaming services are broadcasting them in your country</strong> — with live scores, kickoff times, venues and a clear free-to-air vs. paid breakdown for each match.",
    seoP2: "Pick any day, filter by competition or search for your team, then open a match to see the full where-to-watch list per country. Listings are crowd-sourced and merged from real broadcast data, so matches without a confirmed channel are shown as “no TV listing yet” rather than a guess. It’s free, with no login or account.",
    seoLeaguesTitle: "Popular competitions on TV",
    seoOnTv: "on TV", seoTodayLink: "Today’s top games",
    remember: "Remember this next time", yourCountry: "📍 Your country",
    connDebug: "Connections debug →", adPrefs: "Ad preferences",
    footerSite: "Site",
    footerData: "Today's football from around the world and where to watch it — live on TV and streaming, wherever you are.",
    footerCopy: "© {year} {brand} · All rights reserved.",
    footerCredits: "Made with ❤️ by <a href=\"https://x.com/gonelf\" target=\"_blank\" rel=\"noopener\">@gonelf</a>, <a href=\"https://x.com/etyk\" target=\"_blank\" rel=\"noopener\">@etyk</a>, and Claude Code",
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
    mdStats: "Match stats", mdLoading: "Loading match details…",
    mdReplay: "Match replay", mdPlay: "Play replay", mdPause: "Pause", mdRestart: "Restart", mdGoal: "GOAL!",
    mdSoundOn: "Sound on", mdSoundOff: "Sound off",
    mdKickoff: "KICK-OFF", mdHalftime: "HALF-TIME", mdFulltime: "FULL-TIME", mdMiss: "MISSED", mdSaved: "SAVED!",
    mdLineups: "Line-ups", mdCoach: "Coach",
    lineupConfirmed: "Confirmed XI", lineupProbable: "Probable XI",
    mdHighlights: "Highlights", mdWatch: "▶ Watch highlights", mdYouTube: "🔎 Search on YouTube",
    mdW: "W", mdD: "D", mdL: "L",
    stPossession: "Possession", stShots: "Shots", stSot: "On target",
    stXg: "Expected goals (xG)", stCorners: "Corners", stFouls: "Fouls",
    allFiltered: "All leagues are filtered out — open <strong>Leagues</strong> and re-enable some, or hit Reset filters.",
    noSearch: "No games match your search for this date.",
    noFixtures: "No fixtures found for this date.",
    feedDown: "Couldn’t reach the live data feed. Please try again in a moment.",
    hlCard: "Highlights", hlCardAria: "Watch highlights",
    refreshingTv: "⏳ Updating TV listings in the background — new channels may appear shortly.",
    consent: "{brand} is free thanks to ads. We’d like to use cookies to show ads and measure traffic. You can change this anytime via “Ad preferences” in the footer.",
    accept: "Accept", reject: "Reject",
    swipeHint: "← Swipe to change day →",
  },
  pt: {
    title: "{brand} — Futebol na TV em todo o mundo",
    tagline: "Futebol de todo o mundo e onde ver",
    today: "Hoje", search: "Procurar equipa ou competição…",
    leagues: "Ligas", showLeagues: "Mostrar ligas", reset: "Repor filtros",
    showAllGames: "Mostrar todos os jogos", showFewer: "Mostrar menos",
    prevDay: "Dia anterior", nextDay: "Dia seguinte",
    countryAria: "País principal para as emissões de TV", searchAria: "Procurar jogos",
    hidden: "ocultas", noLeagues: "Sem ligas para filtrar.",
    seoH1: "Futebol na TV hoje, em todo o mundo — onde ver cada jogo em direto",
    seoIntroTitle: "Onde ver futebol na TV hoje",
    seoP1: "O <strong>{brand}</strong> mostra-te todos os jogos de futebol que decorrem hoje em todo o mundo e exatamente <strong>que canais de TV e serviços de streaming os transmitem no teu país</strong> — com resultados ao vivo, horas de início, estádios e uma distinção clara entre sinal aberto e pago para cada jogo.",
    seoP2: "Escolhe qualquer dia, filtra por competição ou procura a tua equipa e abre um jogo para veres a lista completa de onde ver, país a país. As emissões são reunidas a partir de dados de transmissão reais, por isso os jogos sem canal confirmado aparecem como “sem emissão conhecida” em vez de uma suposição. É grátis, sem login nem conta.",
    seoLeaguesTitle: "Competições populares na TV",
    seoOnTv: "na TV", seoTodayLink: "Os melhores jogos de hoje",
    remember: "Lembrar para a próxima", yourCountry: "📍 O teu país",
    connDebug: "Diagnóstico de ligações →", adPrefs: "Preferências de anúncios",
    footerSite: "Site",
    footerData: "O futebol de todo o mundo de hoje e onde o ver — em direto na TV e em streaming, estejas onde estiveres.",
    footerCopy: "© {year} {brand} · Todos os direitos reservados.",
    footerCredits: "Feito com ❤️ por <a href=\"https://x.com/gonelf\" target=\"_blank\" rel=\"noopener\">@gonelf</a>, <a href=\"https://x.com/etyk\" target=\"_blank\" rel=\"noopener\">@etyk</a> e o Claude Code",
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
    mdStats: "Estatísticas", mdLoading: "A carregar detalhes do jogo…",
    mdReplay: "Repetição do jogo", mdPlay: "Reproduzir", mdPause: "Pausar", mdRestart: "Recomeçar", mdGoal: "GOLO!",
    mdSoundOn: "Som ligado", mdSoundOff: "Som desligado",
    mdKickoff: "PONTAPÉ DE SAÍDA", mdHalftime: "INTERVALO", mdFulltime: "FIM DO JOGO", mdMiss: "FALHOU", mdSaved: "DEFESA!",
    mdLineups: "Onze inicial", mdCoach: "Treinador",
    lineupConfirmed: "Onze confirmado", lineupProbable: "Onze provável",
    mdHighlights: "Resumo", mdWatch: "▶ Ver resumo", mdYouTube: "🔎 Procurar no YouTube",
    mdW: "V", mdD: "E", mdL: "D",
    stPossession: "Posse de bola", stShots: "Remates", stSot: "À baliza",
    stXg: "Golos esperados (xG)", stCorners: "Cantos", stFouls: "Faltas",
    allFiltered: "Todas as ligas estão filtradas — abre <strong>Ligas</strong> e reativa algumas, ou carrega em Repor filtros.",
    noSearch: "Nenhum jogo corresponde à tua pesquisa nesta data.",
    noFixtures: "Sem jogos para esta data.",
    feedDown: "Não foi possível contactar o feed de dados. Tenta novamente daqui a momentos.",
    hlCard: "Resumo", hlCardAria: "Ver resumo",
    refreshingTv: "⏳ A atualizar as emissões em segundo plano — podem aparecer novos canais em breve.",
    consent: "O {brand} é grátis graças aos anúncios. Gostaríamos de usar cookies para mostrar anúncios e medir o tráfego. Podes alterar isto a qualquer momento em “Preferências de anúncios” no rodapé.",
    accept: "Aceitar", reject: "Rejeitar",
    swipeHint: "← Desliza para mudar de dia →",
  },
};

// Portuguese only when Portugal is the primary country; English everywhere else.
export function langFor(country) {
  return country === "Portugal" ? "pt" : "en";
}

// Server-side language for the SEO pages, from Vercel's ISO country code
// (e.g. "PT"). Mirrors langFor: Portuguese for Portugal, English otherwise —
// which also keeps search crawlers (typically non-PT) on the English copy.
export function langForCountryCode(code) {
  return String(code || "").toUpperCase().slice(0, 2) === "PT" ? "pt" : "en";
}

// Build a translator for a language, falling back to the English string. The
// optional brandName fills the "{brand}" token in the copy so the same strings
// serve every domain (defaults to the Portuguese "Hoje Há Bola").
export function makeT(lang, brandName) {
  const L = I18N[lang] || I18N.en;
  const brand = brandName || "Hoje Há Bola";
  return function t(key) {
    const v = L[key] != null ? L[key] : I18N.en[key];
    return typeof v === "string" ? v.replace(/\{brand\}/g, brand) : v;
  };
}

// Intl locale for date/time formatting (undefined = the browser default).
export function localeFor(lang) {
  return lang === "pt" ? "pt-PT" : undefined;
}
