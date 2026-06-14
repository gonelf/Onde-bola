/*
 * Onde Bola — today's football games worldwide and where to watch them.
 *
 * Fixtures are fetched client-side from TheSportsDB's free API. Real TV
 * channels come from TheSportsDB's TV feeds, with SofaScore (via the
 * api/sofatv proxy) as an unofficial on-demand fallback. Only real listings
 * are ever shown — when no source has data the match shows "No TV listing yet",
 * and when there are no fixtures the page shows an empty state.
 */

(function () {
  "use strict";

  var API_BASE = "https://www.thesportsdb.com/api/v1/json/123";

  // The worldwide "all soccer" feed for a day can be dominated by a single big
  // tournament (e.g. the World Cup, when most domestic leagues pause). To keep
  // coverage broad we also query a set of leagues that commonly run mid-year,
  // by name, and merge in any games they have that day. Unknown names simply
  // return nothing, so the list is safe to extend.
  var ACTIVE_LEAGUES = [
    "American Major League Soccer",
    "Brazilian Serie A",
    "Mexican Primera League",
    "Argentine Primera Division",
    "Swedish Allsvenskan",
    "Norwegian Eliteserien",
    "Finnish Veikkausliiga",
    "Japanese J League",
    "South Korean K League 1",
    "Chinese Super League",
    "Australian A-League",
    "Indian Super League",
  ];

  var STORAGE_HIDDEN = "ondebola.hiddenLeagues";
  var STORAGE_REMEMBER = "ondebola.rememberFilters";

  var state = {
    date: new Date(),
    search: "",
    fixtures: [],
    hidden: {},       // competition name -> true when hidden from the list
    remember: false,  // persist the filter selection across visits
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
    detailBody: document.getElementById("detail-body"),
  };

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
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
      return { state: "finished", label: "FT" };
    }
    if (/^(HT|HALF[\s-]?TIME)$/.test(s)) {
      return { state: "live", label: "HT" };
    }
    var min = s.match(/(\d{1,3})\s*'?\+?\d*\s*$/);
    if (/(1H|2H|ET|LIVE|IN PLAY|PLAYING)/.test(s) || (min && s !== "")) {
      return { state: "live", label: min ? min[1] + "'" : "LIVE" };
    }
    if (/^(NS|NOT STARTED|SCHEDULED|TBD|PREVIEW)$/.test(s) || raw === "") {
      // Nothing definitive from the feed — estimate from the clock.
      var est = matchStatus(kickoff);
      if (est.state === "live") return { state: "live", label: "LIVE" };
      if (est.state === "finished") return { state: "finished", label: "FT" };
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

    var hs = ev.intHomeScore;
    var as = ev.intAwayScore;
    return {
      id: ev.idEvent || (ev.strHomeTeam + ev.strAwayTeam + ev.strTimestamp),
      competition: ev.strLeague || "Football",
      home: ev.strHomeTeam || "Home",
      away: ev.strAwayTeam || "Away",
      homeBadge: ev.strHomeTeamBadge || "",
      awayBadge: ev.strAwayTeamBadge || "",
      kickoff: kickoff.toISOString(),
      venue: ev.strVenue || "",
      leagueBadgeUrl: ev.strLeagueBadge || "",
      homeScore: (hs === 0 || hs) ? String(hs) : null,
      awayScore: (as === 0 || as) ? String(as) : null,
      status: ev.strStatus || ev.strProgress || "",
    };
  }

  // Fetch one endpoint and return its normalised fixtures (never rejects).
  function fetchEvents(url) {
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        return ((data && data.events) || []).map(normaliseApiEvent).filter(Boolean);
      })
      .catch(function () { return []; });
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

  // Day-bulk SportMonks broadcaster source (official paid API). One request
  // returns every match's TV stations for the day; disabled server-side (empty)
  // unless a SPORTMONKS_KEY is configured, so it's harmless when not set up.
  function fetchSportMonksDay(day) {
    return fetch("/api/smtv?date=" + day, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("smtv " + r.status); return r.json(); })
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
    return Promise.all([primary, fetchSofaTv(fx)]).then(function (res) {
      fx.tv = mergeTv(mergeTv(dayList, res[0]), res[1]);
      fx._tvLoaded = true;
      loadedTv[fx.id] = fx.tv;
      return fx.tv || [];
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
    if (node) node.textContent = withTv ? " · 📡 " + withTv + " with real TV listings" : "";
  }

  function loadFixtures(silent) {
    if (!silent) renderSkeletons();

    // Bumped each load so a stale prefetch run from a previous date stops.
    state.loadToken = (state.loadToken || 0) + 1;
    var token = state.loadToken;

    var day = ymd(state.date);
    var requests = [
      // The worldwide soccer feed for the day (catches the World Cup etc).
      fetchEvents(API_BASE + "/eventsday.php?d=" + day + "&s=Soccer"),
    ].concat(ACTIVE_LEAGUES.map(function (league) {
      // Plus each commonly-active league explicitly, by name.
      return fetchEvents(API_BASE + "/eventsday.php?d=" + day +
        "&l=" + encodeURIComponent(league));
    }));

    // Track whether the primary worldwide call actually succeeded so we can
    // tell "no games today" apart from "the feed is unreachable".
    var feedReachable = true;
    requests[0] = requests[0].catch(function () { feedReachable = false; return []; });

    return Promise.all([Promise.all(requests), fetchTv(day), fetchSportMonksDay(day)])
      .then(function (res) {
        var lists = res[0];
        var tv = res[1];
        var smDay = res[2] || [];
        // Merge all sources and de-duplicate by event id.
        var seen = {};
        var fixtures = [];
        lists.forEach(function (list) {
          list.forEach(function (fx) {
            if (seen[fx.id]) return;
            seen[fx.id] = true;
            fixtures.push(fx);
          });
        });
        attachTv(fixtures, tv);

        // Merge the SportMonks day map (empty unless the paid source is
        // enabled). This gives every match its broadcasters up front, with no
        // per-match call.
        if (smDay.length) {
          fixtures.forEach(function (fx) {
            var h = normName(fx.home), a = normName(fx.away), hit = null;
            for (var i = 0; i < smDay.length; i++) {
              if (teamMatch(h, smDay[i].h) && teamMatch(a, smDay[i].a)) { hit = smDay[i]; break; }
            }
            if (hit && hit.rows && hit.rows.length) fx.tv = mergeTv(fx.tv, hit.rows);
          });
        }

        // Reapply listings already fetched this session so a silent refresh
        // keeps them and doesn't re-hit the sources.
        fixtures.forEach(function (fx) {
          if (loadedTv[fx.id]) { fx.tv = mergeTv(fx.tv, loadedTv[fx.id]); fx._tvLoaded = true; }
        });

        if (!fixtures.length) {
          if (silent) return; // keep current view on an empty silent refresh
          showEmpty(feedReachable
            ? "No fixtures found for this date."
            : "Couldn't reach the live data feed. Please try again in a moment.");
          return;
        }
        state.fixtures = fixtures;
        var comps = {};
        fixtures.forEach(function (f) { comps[f.competition] = true; });
        var live = fixtures.filter(function (f) { return statusOf(f).state === "live"; }).length;
        var withTv = fixtures.filter(function (f) { return f.tv && f.tv.length; }).length;
        var base = fixtures.length + " games · " + Object.keys(comps).length + " competitions" +
          (live ? " · " + live + " live now" : "");
        el.status.hidden = false;
        el.status.className = "status";
        el.status.innerHTML = '<span class="badge">' + (live ? "LIVE" : "OK") + "</span>" +
          escapeHtml(base) +
          '<span class="tv-count">' +
            (withTv ? " · 📡 " + withTv + " with real TV listings" : "") + "</span>" +
          escapeHtml(" · updated " + formatClock(new Date()));
        render();
        updateLeaguePanel();
        prefetchListings(token); // fill in real channels without a click
      });
  }

  function showEmpty(message) {
    state.fixtures = [];
    showStatus("error", "NONE", message);
    render();
    updateLeaguePanel();
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

  // This is a Portuguese app, so listings are surfaced Portugal-first, then a
  // few major markets, then everything else alphabetically.
  var COUNTRY_PRIORITY = ["Portugal", "United Kingdom", "England", "Spain",
    "Brazil", "France", "Italy", "Germany", "Netherlands", "United States"];

  function orderCountries(names) {
    return names.slice().sort(function (a, b) {
      var ia = COUNTRY_PRIORITY.indexOf(a); if (ia === -1) ia = 999;
      var ib = COUNTRY_PRIORITY.indexOf(b); if (ib === -1) ib = 999;
      return ia !== ib ? ia - ib : a.localeCompare(b);
    });
  }

  // A single channel chip, tagged free-to-air or paid cable / subscription.
  function channelChip(name) {
    var paid = window.isPaidChannel(name);
    return '<span class="channel ' + (paid ? "paid" : "free") + '" title="' +
      (paid ? "Paid cable / subscription" : "Free-to-air") + '">' +
      (paid ? '<span class="lock" aria-hidden="true">🔒</span>' : "") +
      escapeHtml(name) + "</span>";
  }

  // Real per-match listings (from TheSportsDB's TV feed), grouped by country.
  function realChannelsHtml(tv) {
    var byCountry = {};
    tv.forEach(function (t) {
      var c = t.country || "International";
      if (!byCountry[c]) byCountry[c] = [];
      if (byCountry[c].indexOf(t.channel) === -1) byCountry[c].push(t.channel);
    });
    var groups = orderCountries(Object.keys(byCountry)).map(function (c) {
      var chips = byCountry[c].map(channelChip).join("");
      return '<span class="country-group" title="' + escapeHtml(c) + '">' +
        '<span class="flag">' + countryFlag(c) + "</span>" + chips + "</span>";
    });
    return '<span class="src-tag real" title="Real broadcast listings">📡 Listings</span>' +
      groups.join("");
  }

  // Real listings only — no curated guesswork. Matches without a crowd-sourced
  // listing simply show "No TV listing yet".
  function channelsHtml(fx) {
    if (fx && fx.tv && fx.tv.length) return realChannelsHtml(fx.tv);
    return '<span class="channel none">No TV listing yet</span>';
  }

  function matchHtml(fx) {
    var st = statusOf(fx);
    var cls = "match" + (st.state === "live" ? " is-live" : "");
    return '<article class="' + cls + '" data-id="' + escapeHtml(fx.id) +
        '" tabindex="0" role="button" aria-label="Match details">' +
      '<div class="match-time">' + timeCellHtml(fx) + "</div>" +
      '<div class="teams">' +
        '<div class="team">' + badgeHtml(fx.homeBadge, fx.home) +
          '<span class="team-name">' + escapeHtml(fx.home) + "</span>" +
          scoreHtml(fx, "home") + "</div>" +
        '<div class="team">' + badgeHtml(fx.awayBadge, fx.away) +
          '<span class="team-name">' + escapeHtml(fx.away) + "</span>" +
          scoreHtml(fx, "away") + "</div>" +
      "</div>" +
      '<div class="channels">' + channelsHtml(fx) + "</div>" +
      '<span class="details-hint">Click for details ›</span>' +
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

  function render() {
    // Drop leagues the user has filtered out, then apply the search.
    var shown = state.fixtures.filter(function (fx) { return !isHidden(fx.competition); });
    var hiddenSome = shown.length !== state.fixtures.length;
    var fixtures = applyFilter(shown);

    if (!fixtures.length) {
      var msg = state.fixtures.length && hiddenSome && !state.search
        ? "All leagues are filtered out — open <strong>Leagues</strong> and re-enable some, or hit Reset filters."
        : "No games match your search for this date.";
      el.games.innerHTML = '<div class="empty"><div class="big">⚽</div><p>' + msg + "</p></div>";
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
      var badged = games.filter(function (g) { return g.leagueBadgeUrl; })[0];
      var badgeUrl = badged ? badged.leagueBadgeUrl : "";
      return '<section class="competition">' +
        '<h2 class="competition-head">' +
          leagueLogoHtml(badgeUrl, comp) +
          '<span class="competition-name">' + escapeHtml(comp) + "</span>" +
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
      return '<p class="src-note real">📡 Real broadcast listings</p>' +
        orderCountries(Object.keys(byCountry)).map(function (c) {
          return detailChannelRow(countryFlag(c), c, byCountry[c].map(channelChip).join(""));
        }).join("");
    }
    return checking
      ? '<p class="src-note checking">⏳ Checking live listings…</p>'
      : '<p class="src-note guide">No broadcast listing found for this match yet.</p>';
  }

  function buildDetailBody(fx, checking) {
    var st = statusOf(fx);
    var kickoff = new Date(fx.kickoff);
    var dateStr = kickoff.toLocaleDateString([], {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
    var timeStr = kickoff.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var score = hasScore(fx) && st.state !== "upcoming"
      ? '<div class="detail-score">' + escapeHtml(fx.homeScore) + " – " + escapeHtml(fx.awayScore) + "</div>"
      : '<div class="detail-vs">vs</div>';
    var statusBadge = st.state === "live"
      ? '<span class="detail-status live">' + escapeHtml(st.label || "LIVE") + "</span>"
      : st.state === "finished"
        ? '<span class="detail-status ft">' + escapeHtml(st.label || "FT") + "</span>"
        : '<span class="detail-status">' + escapeHtml(timeStr) + "</span>";

    return '<div class="detail-comp">' + leagueLogoHtml(fx.leagueBadgeUrl, fx.competition) +
        '<span id="detail-title">' + escapeHtml(fx.competition) + "</span></div>" +
      '<div class="detail-teams">' +
        '<div class="detail-team">' + badgeHtml(fx.homeBadge, fx.home) +
          "<span>" + escapeHtml(fx.home) + "</span></div>" +
        score +
        '<div class="detail-team">' + badgeHtml(fx.awayBadge, fx.away) +
          "<span>" + escapeHtml(fx.away) + "</span></div>" +
      "</div>" +
      '<div class="detail-meta">' + statusBadge +
        "<span>📅 " + escapeHtml(dateStr) + " · " + escapeHtml(timeStr) + "</span>" +
        (fx.venue ? "<span>📍 " + escapeHtml(fx.venue) + "</span>" : "") +
      "</div>" +
      '<h3 class="detail-h">Where to watch</h3>' +
      '<div class="detail-legend">' +
        '<span class="channel free">Free-to-air</span>' +
        '<span class="channel paid"><span class="lock">🔒</span>Paid cable / subscription</span>' +
      "</div>" +
      detailChannelsHtml(fx, checking);
  }

  function openDetails(id) {
    var fx = state.fixtures.filter(function (f) { return String(f.id) === String(id); })[0];
    if (!fx) return;
    state.detailId = String(id);

    // Listings usually arrive via the background prefetch; if this match hasn't
    // resolved yet, show a "checking" state and load it on demand.
    var pending = !fx._tvLoaded;

    el.detailBody.innerHTML = buildDetailBody(fx, pending);
    el.detailOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    el.detailClose.focus();

    if (pending) {
      ensureEventTv(fx).then(function (list) {
        // Only patch if the same match's modal is still open.
        if (el.detailOverlay.hidden || state.detailId !== String(id)) return;
        el.detailBody.innerHTML = buildDetailBody(fx, false);
        if (list && list.length) { updateCardListings(fx); updateTvCount(); }
      });
    }
  }

  function closeDetails() {
    el.detailOverlay.hidden = true;
    document.body.style.overflow = "";
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

    // Open match details on click or keyboard activation.
    el.games.addEventListener("click", function (e) {
      var card = e.target.closest(".match[data-id]");
      if (card) openDetails(card.getAttribute("data-id"));
    });
    el.games.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest(".match[data-id]");
      if (card) { e.preventDefault(); openDetails(card.getAttribute("data-id")); }
    });
    el.detailClose.addEventListener("click", closeDetails);
    el.detailOverlay.addEventListener("click", function (e) {
      if (e.target === el.detailOverlay) closeDetails();
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
    renderDateLabel();
    bindEvents();
    loadFixtures();
    // When viewing today, silently refresh live scores/status every 60s.
    // On other days just re-render to keep time-based badges accurate.
    setInterval(function () {
      if (isSameDay(state.date, new Date())) {
        loadFixtures(true);
      } else if (!state.search) {
        render();
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
