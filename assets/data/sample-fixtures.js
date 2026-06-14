/*
 * Sample fixtures used as a fallback when the live API cannot be reached
 * (offline, blocked by CORS, or rate-limited). Times are stored as offsets
 * in hours from "now" so the sample always looks like today's schedule.
 *
 * This is a deliberately broad, worldwide spread (Europe, the Americas,
 * Asia, Middle East) so the app demonstrates games "from all countries"
 * even with no live connection. Live data from the API is far larger still.
 */

function buildSampleFixtures() {
  var now = new Date();
  var at = function (hoursFromNow, minutes) {
    var d = new Date(now.getTime() + hoursFromNow * 3600 * 1000);
    d.setMinutes(minutes || 0, 0, 0);
    return d.toISOString();
  };

  var g = function (o) {
    return {
      id: o.id,
      competition: o.competition,
      home: o.home,
      away: o.away,
      homeBadge: "",
      awayBadge: "",
      leagueBadgeUrl: "",
      kickoff: o.kickoff,
      venue: o.venue || "",
      homeScore: o.homeScore != null ? String(o.homeScore) : null,
      awayScore: o.awayScore != null ? String(o.awayScore) : null,
      status: o.status || "",
    };
  };

  return [
    g({ id: "s1", competition: "English Premier League", home: "Arsenal", away: "Liverpool",
        kickoff: at(-1, 0), venue: "Emirates Stadium", homeScore: 2, awayScore: 1, status: "67" }),
    g({ id: "s2", competition: "English League Championship", home: "Leeds United", away: "Leicester City",
        kickoff: at(1, 0), venue: "Elland Road" }),
    g({ id: "s3", competition: "Spanish La Liga", home: "Real Madrid", away: "Barcelona",
        kickoff: at(2, 0), venue: "Santiago Bernabéu" }),
    g({ id: "s4", competition: "Italian Serie A", home: "Inter", away: "Juventus",
        kickoff: at(1, 45), venue: "San Siro" }),
    g({ id: "s5", competition: "German Bundesliga", home: "Borussia Dortmund", away: "RB Leipzig",
        kickoff: at(0, 0), venue: "Signal Iduna Park", homeScore: 0, awayScore: 0, status: "1H" }),
    g({ id: "s6", competition: "French Ligue 1", home: "Paris SG", away: "Marseille",
        kickoff: at(3, 0), venue: "Parc des Princes" }),
    g({ id: "s7", competition: "Primeira Liga", home: "Benfica", away: "FC Porto",
        kickoff: at(3, 30), venue: "Estádio da Luz" }),
    g({ id: "s8", competition: "Dutch Eredivisie", home: "Ajax", away: "PSV Eindhoven",
        kickoff: at(2, 30), venue: "Johan Cruijff ArenA" }),
    g({ id: "s9", competition: "UEFA Champions League", home: "Bayern Munich", away: "Manchester City",
        kickoff: at(4, 0), venue: "Allianz Arena" }),
    g({ id: "s10", competition: "UEFA Europa League", home: "AS Roma", away: "Sevilla",
        kickoff: at(4, 0), venue: "Stadio Olimpico" }),
    g({ id: "s11", competition: "Brazilian Serie A", home: "Flamengo", away: "Palmeiras",
        kickoff: at(6, 0), venue: "Maracanã" }),
    g({ id: "s12", competition: "American Major League Soccer", home: "Inter Miami", away: "LA Galaxy",
        kickoff: at(8, 0), venue: "Chase Stadium" }),
    g({ id: "s13", competition: "Argentine Primera Division", home: "Boca Juniors", away: "River Plate",
        kickoff: at(7, 0), venue: "La Bombonera" }),
    g({ id: "s14", competition: "Mexican Liga MX", home: "Club América", away: "Guadalajara",
        kickoff: at(7, 30), venue: "Estadio Azteca" }),
    g({ id: "s15", competition: "Saudi Pro League", home: "Al Nassr", away: "Al Hilal",
        kickoff: at(-2, 0), venue: "Al-Awwal Park", homeScore: 1, awayScore: 1, status: "HT" }),
    g({ id: "s16", competition: "Scottish Premiership", home: "Celtic", away: "Rangers",
        kickoff: at(1, 30), venue: "Celtic Park" }),
    g({ id: "s17", competition: "Belgian Pro League", home: "Club Brugge", away: "Anderlecht",
        kickoff: at(2, 0), venue: "Jan Breydel Stadium" }),
    g({ id: "s18", competition: "Turkish Super Lig", home: "Galatasaray", away: "Fenerbahçe",
        kickoff: at(3, 0), venue: "Rams Park" }),
  ];
}

window.buildSampleFixtures = buildSampleFixtures;
