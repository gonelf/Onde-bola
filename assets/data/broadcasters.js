/*
 * Broadcaster rights mapping.
 *
 * Maps a competition to the TV channels / streaming services that hold the
 * broadcasting rights in a given country. This mirrors how real sites work:
 * fixtures come from a sports data feed, while the "where to watch" answer
 * comes from a curated rights table per market.
 *
 * Channels are listed as the *primary* channel for that competition (e.g.
 * "Sport TV 1", "BBC One"). These are sensible defaults for the main slot —
 * the exact numbered channel for a specific kickoff can vary and is not part
 * of the free fixtures feed.
 *
 * Keys are normalised competition names (lower-cased, see normaliseCompetition
 * in app.js). The special key "_default" is used as a fallback per country.
 */

window.BROADCASTERS = {
  // country code -> { competitionKey: [channels] }
  PT: {
    name: "Portugal",
    flag: "🇵🇹",
    rights: {
      "primeira liga": ["Sport TV 1", "DAZN 1"],
      "liga portugal": ["Sport TV 1", "DAZN 1"],
      "taca de portugal": ["RTP1", "Sport TV 1"],
      "english premier league": ["DAZN 1", "Eleven 1"],
      "premier league": ["DAZN 1", "Eleven 1"],
      "spanish la liga": ["DAZN 1"],
      "la liga": ["DAZN 1"],
      "italian serie a": ["Sport TV 1"],
      "serie a": ["Sport TV 1"],
      "german bundesliga": ["Sport TV 2"],
      "bundesliga": ["Sport TV 2"],
      "french ligue 1": ["DAZN 2"],
      "ligue 1": ["DAZN 2"],
      "uefa champions league": ["TVI", "DAZN 1"],
      "champions league": ["TVI", "DAZN 1"],
      "uefa europa league": ["Sport TV 1", "DAZN 1"],
      "europa league": ["Sport TV 1", "DAZN 1"],
      "uefa conference league": ["Sport TV 2"],
      "fifa world cup": ["RTP1", "Sport TV 1"],
      "uefa euro": ["RTP1", "Sport TV 1"],
      _default: ["Sport TV 1"],
    },
  },
  GB: {
    name: "United Kingdom",
    flag: "🇬🇧",
    rights: {
      "english premier league": ["Sky Sports Premier League", "TNT Sports 1", "Amazon Prime"],
      "premier league": ["Sky Sports Premier League", "TNT Sports 1", "Amazon Prime"],
      "english league championship": ["Sky Sports Football"],
      "championship": ["Sky Sports Football"],
      "english fa cup": ["BBC One", "ITV1"],
      "fa cup": ["BBC One", "ITV1"],
      "spanish la liga": ["Premier Sports 1"],
      "la liga": ["Premier Sports 1"],
      "italian serie a": ["TNT Sports 1"],
      "serie a": ["TNT Sports 1"],
      "german bundesliga": ["Sky Sports Football"],
      "bundesliga": ["Sky Sports Football"],
      "uefa champions league": ["TNT Sports 1"],
      "champions league": ["TNT Sports 1"],
      "uefa europa league": ["TNT Sports 2"],
      "europa league": ["TNT Sports 2"],
      "fifa world cup": ["BBC One", "ITV1"],
      "uefa euro": ["BBC One", "ITV1"],
      _default: ["Sky Sports Football"],
    },
  },
  US: {
    name: "United States",
    flag: "🇺🇸",
    rights: {
      "english premier league": ["NBC", "Peacock", "USA Network"],
      "premier league": ["NBC", "Peacock", "USA Network"],
      "spanish la liga": ["ESPN+"],
      "la liga": ["ESPN+"],
      "italian serie a": ["Paramount+", "CBS"],
      "serie a": ["Paramount+", "CBS"],
      "german bundesliga": ["ESPN+"],
      "bundesliga": ["ESPN+"],
      "french ligue 1": ["beIN Sports"],
      "ligue 1": ["beIN Sports"],
      "american major league soccer": ["Apple TV"],
      "major league soccer": ["Apple TV"],
      "mls": ["Apple TV"],
      "uefa champions league": ["Paramount+", "CBS"],
      "champions league": ["Paramount+", "CBS"],
      "uefa europa league": ["Paramount+"],
      "europa league": ["Paramount+"],
      "fifa world cup": ["FOX", "FS1", "Telemundo", "Fubo"],
      _default: ["Fox Soccer Plus"],
    },
  },
  ES: {
    name: "Spain",
    flag: "🇪🇸",
    rights: {
      "spanish la liga": ["Movistar Plus+", "DAZN 1"],
      "la liga": ["Movistar Plus+", "DAZN 1"],
      "spanish segunda division": ["LaLiga Hypermotion TV"],
      "copa del rey": ["La 1", "Movistar Plus+"],
      "english premier league": ["DAZN 1"],
      "premier league": ["DAZN 1"],
      "italian serie a": ["DAZN 2"],
      "serie a": ["DAZN 2"],
      "uefa champions league": ["Movistar Plus+", "Amazon Prime"],
      "champions league": ["Movistar Plus+", "Amazon Prime"],
      "uefa europa league": ["Movistar Plus+"],
      "europa league": ["Movistar Plus+"],
      "fifa world cup": ["La 1"],
      _default: ["Movistar Plus+"],
    },
  },
  BR: {
    name: "Brazil",
    flag: "🇧🇷",
    rights: {
      "brazilian serie a": ["Globo", "Premiere", "Amazon Prime"],
      "campeonato brasileiro": ["Globo", "Premiere", "Amazon Prime"],
      "english premier league": ["ESPN", "Disney+"],
      "premier league": ["ESPN", "Disney+"],
      "spanish la liga": ["ESPN", "Disney+"],
      "la liga": ["ESPN", "Disney+"],
      "italian serie a": ["CazéTV"],
      "serie a": ["CazéTV"],
      "uefa champions league": ["TNT", "Max", "Space"],
      "champions league": ["TNT", "Max", "Space"],
      "uefa europa league": ["ESPN", "Disney+"],
      "europa league": ["ESPN", "Disney+"],
      "fifa world cup": ["Globo", "SporTV", "Premiere"],
      _default: ["SporTV"],
    },
  },
};

/*
 * Free-to-air (over-the-air) broadcasters. Any channel NOT in this set is
 * treated as a paid cable / pay-TV / subscription streaming service and is
 * tagged accordingly in the UI.
 */
window.FREE_TO_AIR = {
  // Portugal
  "RTP1": true, "TVI": true,
  // United Kingdom
  "BBC One": true, "BBC Two": true, "ITV1": true,
  // United States (over-the-air networks)
  "NBC": true, "FOX": true, "CBS": true, "Telemundo": true, "ABC": true,
  // Spain
  "La 1": true,
  // Brazil
  "Globo": true, "CazéTV": true,
};

window.isPaidChannel = function (name) {
  return !window.FREE_TO_AIR[name];
};
