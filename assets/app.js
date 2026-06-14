/*
 * Onde Bola — today's football games worldwide and where to watch them.
 *
 * Fixtures are fetched client-side from TheSportsDB's free API. Each fixture
 * is matched against a curated broadcaster-rights table (broadcasters.js) to
 * resolve which TV channels / streaming services carry it in the chosen
 * country. If the API is unreachable, a bundled sample schedule is shown so
 * the page is never empty.
 */

(function () {
  "use strict";

  var API_BASE = "https://www.thesportsdb.com/api/v1/json/3";
  var STORAGE_COUNTRY = "ondebola.country";

  var state = {
    date: new Date(),
    country: localStorage.getItem(STORAGE_COUNTRY) || guessCountry(),
    search: "",
    fixtures: [],
    usingSample: false,
  };

  var el = {
    games: document.getElementById("games"),
    status: document.getElementById("status"),
    country: document.getElementById("country-select"),
    currentDate: document.getElementById("current-date"),
    search: document.getElementById("search"),
    prev: document.getElementById("prev-day"),
    next: document.getElementById("next-day"),
    today: document.getElementById("today-btn"),
  };

  // ---- Helpers ------------------------------------------------------------

  function guessCountry() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      if (tz.indexOf("Lisbon") > -1 || tz.indexOf("Azores") > -1) return "PT";
      if (tz.indexOf("Madrid") > -1) return "ES";
      if (tz.indexOf("London") > -1) return "GB";
      if (tz.indexOf("Sao_Paulo") > -1 || tz.indexOf("Brazil") > -1) return "BR";
      if (tz.indexOf("America/") === 0) return "US";
    } catch (e) {}
    return "PT";
  }

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

  function normaliseCompetition(name) {
    return (name || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Resolve channels for a competition in the active country.
  function channelsFor(competition) {
    var country = window.BROADCASTERS[state.country];
    if (!country) return [];
    var key = normaliseCompetition(competition);
    var rights = country.rights;
    if (rights[key]) return rights[key];
    // Looser match for naming differences (e.g. an API suffix like a year),
    // but anchored on word boundaries so "Brazilian Serie A" does NOT match
    // the unrelated "serie a" key — it should fall through to the default.
    for (var rkey in rights) {
      if (rkey === "_default") continue;
      if (key.indexOf(rkey + " ") === 0 || rkey.indexOf(key + " ") === 0) {
        return rights[rkey];
      }
    }
    return rights._default || [];
  }

  function formatClock(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function matchStatus(kickoff) {
    var now = new Date();
    var diffMin = (now - kickoff) / 60000;
    if (diffMin < 0) return { state: "upcoming" };
    if (diffMin <= 115) return { state: "live" };
    return { state: "finished" };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---- Data fetching ------------------------------------------------------

  function normaliseApiEvent(ev) {
    var kickoff = null;
    if (ev.strTimestamp) {
      // strTimestamp is UTC, may be "YYYY-MM-DD HH:MM:SS".
      kickoff = new Date(ev.strTimestamp.replace(" ", "T") + "Z");
    } else if (ev.dateEvent && ev.strTime) {
      kickoff = new Date(ev.dateEvent + "T" + ev.strTime + "Z");
    } else if (ev.dateEvent) {
      kickoff = new Date(ev.dateEvent + "T00:00:00Z");
    }
    if (!kickoff || isNaN(kickoff.getTime())) return null;

    return {
      id: ev.idEvent || (ev.strHomeTeam + ev.strAwayTeam + ev.strTimestamp),
      competition: ev.strLeague || "Football",
      home: ev.strHomeTeam || "Home",
      away: ev.strAwayTeam || "Away",
      homeBadge: ev.strHomeTeamBadge || "",
      awayBadge: ev.strAwayTeamBadge || "",
      kickoff: kickoff.toISOString(),
      venue: ev.strVenue || "",
    };
  }

  function loadFixtures() {
    renderSkeletons();
    state.usingSample = false;

    var url = API_BASE + "/eventsday.php?d=" + ymd(state.date) + "&s=Soccer";

    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var events = (data && data.events) || [];
        var fixtures = events
          .map(normaliseApiEvent)
          .filter(Boolean);

        if (!fixtures.length) {
          // No real data for this day — fall back so the page isn't empty.
          useSample("No live fixtures returned for this date — showing a sample schedule.");
          return;
        }
        state.fixtures = fixtures;
        showStatus("badge", "LIVE", fixtures.length + " games loaded for this date.");
        render();
      })
      .catch(function (err) {
        useSample("Couldn't reach the live data feed (" + err.message +
          "). Showing a sample schedule so you can explore the app.");
      });
  }

  function useSample(message) {
    state.usingSample = true;
    state.fixtures = window.buildSampleFixtures();
    showStatus("error", "SAMPLE", message);
    render();
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

  function timeCellHtml(kickoff) {
    var st = matchStatus(kickoff);
    var clock = formatClock(kickoff);
    if (st.state === "live") {
      return '<div class="clock">' + escapeHtml(clock) + "</div><span class=\"live\">LIVE</span>";
    }
    if (st.state === "finished") {
      return '<div class="clock">' + escapeHtml(clock) + "</div><span class=\"ft\">ENDED</span>";
    }
    return '<div class="clock">' + escapeHtml(clock) + "</div>";
  }

  function channelsHtml(competition) {
    var chans = channelsFor(competition);
    if (!chans || !chans.length) {
      return '<span class="channel none">No local listing</span>';
    }
    return chans.map(function (c) {
      return '<span class="channel">' + escapeHtml(c) + "</span>";
    }).join("");
  }

  function matchHtml(fx) {
    var kickoff = new Date(fx.kickoff);
    return '<article class="match">' +
      '<div class="match-time">' + timeCellHtml(kickoff) + "</div>" +
      '<div class="teams">' +
        '<div class="team">' + badgeHtml(fx.homeBadge, fx.home) +
          '<span class="team-name">' + escapeHtml(fx.home) + "</span></div>" +
        '<div class="team">' + badgeHtml(fx.awayBadge, fx.away) +
          '<span class="team-name">' + escapeHtml(fx.away) + "</span></div>" +
      "</div>" +
      '<div class="channels">' + channelsHtml(fx.competition) + "</div>" +
    "</article>";
  }

  function applyFilter(fixtures) {
    var q = state.search.trim().toLowerCase();
    if (!q) return fixtures;
    return fixtures.filter(function (fx) {
      return (fx.home + " " + fx.away + " " + fx.competition).toLowerCase().indexOf(q) > -1;
    });
  }

  function render() {
    var fixtures = applyFilter(state.fixtures.slice());

    if (!fixtures.length) {
      el.games.innerHTML = '<div class="empty"><div class="big">⚽</div>' +
        "<p>No games match your search for this date.</p></div>";
      return;
    }

    // Group by competition.
    var groups = {};
    var order = [];
    fixtures.forEach(function (fx) {
      var key = fx.competition || "Football";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(fx);
    });

    // Sort competitions alphabetically; matches within a group by kickoff.
    order.sort(function (a, b) { return a.localeCompare(b); });

    var html = order.map(function (comp) {
      var games = groups[comp].sort(function (a, b) {
        return new Date(a.kickoff) - new Date(b.kickoff);
      });
      return '<section class="competition">' +
        '<h2 class="competition-head">' + escapeHtml(comp) +
          '<span class="count">' + games.length + "</span></h2>" +
        games.map(matchHtml).join("") +
      "</section>";
    }).join("");

    el.games.innerHTML = html;
  }

  function renderDateLabel() {
    var today = new Date();
    var label;
    if (isSameDay(state.date, today)) {
      label = "Today";
    } else {
      label = state.date.toLocaleDateString([], {
        weekday: "long", day: "numeric", month: "long",
      });
    }
    el.currentDate.textContent = label;
  }

  // ---- Country picker -----------------------------------------------------

  function buildCountryOptions() {
    var html = "";
    Object.keys(window.BROADCASTERS).forEach(function (code) {
      var c = window.BROADCASTERS[code];
      var selected = code === state.country ? " selected" : "";
      html += '<option value="' + code + '"' + selected + ">" +
        c.flag + "  " + escapeHtml(c.name) + "</option>";
    });
    el.country.innerHTML = html;
  }

  // ---- Events -------------------------------------------------------------

  function shiftDay(delta) {
    var d = new Date(state.date);
    d.setDate(d.getDate() + delta);
    state.date = d;
    renderDateLabel();
    loadFixtures();
  }

  function bindEvents() {
    el.prev.addEventListener("click", function () { shiftDay(-1); });
    el.next.addEventListener("click", function () { shiftDay(1); });
    el.today.addEventListener("click", function () {
      state.date = new Date();
      renderDateLabel();
      loadFixtures();
    });
    el.country.addEventListener("change", function () {
      state.country = el.country.value;
      localStorage.setItem(STORAGE_COUNTRY, state.country);
      render(); // channels change, fixtures stay
    });
    var t;
    el.search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        state.search = el.search.value;
        render();
      }, 120);
    });
  }

  // ---- Init ---------------------------------------------------------------

  function init() {
    buildCountryOptions();
    renderDateLabel();
    bindEvents();
    loadFixtures();
    // Keep LIVE badges fresh.
    setInterval(function () {
      if (!state.search) render();
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
