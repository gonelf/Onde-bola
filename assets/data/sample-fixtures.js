/*
 * Sample fixtures used as a fallback when the live API cannot be reached
 * (offline, blocked by CORS, or rate-limited). Times are stored as offsets
 * in hours from "now" so the sample always looks like today's schedule.
 */

function buildSampleFixtures() {
  const now = new Date();
  const at = (hoursFromNow, minutes = 0) => {
    const d = new Date(now.getTime() + hoursFromNow * 3600 * 1000);
    d.setMinutes(minutes, 0, 0);
    return d.toISOString();
  };

  return [
    {
      id: "s1",
      competition: "English Premier League",
      home: "Arsenal",
      away: "Liverpool",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(-1, 0), // already started -> live
      venue: "Emirates Stadium",
      homeScore: "2",
      awayScore: "1",
      status: "67",
    },
    {
      id: "s2",
      competition: "Spanish La Liga",
      home: "Real Madrid",
      away: "Barcelona",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(2, 0),
      venue: "Santiago Bernabéu",
    },
    {
      id: "s3",
      competition: "Primeira Liga",
      home: "Benfica",
      away: "FC Porto",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(3, 30),
      venue: "Estádio da Luz",
    },
    {
      id: "s4",
      competition: "UEFA Champions League",
      home: "Bayern Munich",
      away: "Manchester City",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(4, 0),
      venue: "Allianz Arena",
    },
    {
      id: "s5",
      competition: "Italian Serie A",
      home: "Inter",
      away: "Juventus",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(1, 45),
      venue: "San Siro",
    },
    {
      id: "s6",
      competition: "Brazilian Serie A",
      home: "Flamengo",
      away: "Palmeiras",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(6, 0),
      venue: "Maracanã",
    },
    {
      id: "s7",
      competition: "French Ligue 1",
      home: "Paris SG",
      away: "Marseille",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(5, 0),
      venue: "Parc des Princes",
    },
    {
      id: "s8",
      competition: "German Bundesliga",
      home: "Borussia Dortmund",
      away: "RB Leipzig",
      homeBadge: "",
      awayBadge: "",
      kickoff: at(0, 0), // about to / just kicked off
      venue: "Signal Iduna Park",
      homeScore: "0",
      awayScore: "0",
      status: "1H",
    },
  ];
}

window.buildSampleFixtures = buildSampleFixtures;
