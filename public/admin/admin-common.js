/*
 * Shared helpers for the admin pages that drive a match picker: the date input,
 * the fixtures dropdown, and the home/away/fmid fields it fills. Used by the
 * Connections-debug and TV-overrides pages so the picker behaves identically.
 */
window.AdminCommon = (function () {
  "use strict";
  function $(id) { return document.getElementById(id); }
  function todayUTC() { return new Date().toISOString().slice(0, 10); }

  function params() {
    return {
      date: ($("date") && $("date").value) || todayUTC(),
      home: ($("home") && $("home").value.trim()) || "",
      away: ($("away") && $("away").value.trim()) || "",
      fmid: ($("fmid") && $("fmid").value.trim()) || "",
    };
  }

  // Populate the #match dropdown from the FotMob proxy for the chosen date.
  function loadFixtures() {
    var date = ($("date") && $("date").value) || todayUTC();
    var sel = $("match");
    if (!sel) return;
    sel.innerHTML = '<option value="">loading…</option>';
    fetch("/api/fixtures?date=" + date)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var ev = (j && j.fixtures) || [];
        if (!ev.length) { sel.innerHTML = '<option value="">no fixtures for ' + date + '</option>'; return; }
        sel.innerHTML = '<option value="">— ' + ev.length + ' matches —</option>';
        ev.forEach(function (e) {
          var o = document.createElement("option");
          o.value = (e.home || "") + "|" + (e.away || "") + "|" + (e.fmid || "");
          o.textContent = (e.home || "?") + " vs " + (e.away || "?") +
            (e.competition ? "  ·  " + e.competition : "");
          sel.appendChild(o);
        });
      })
      .catch(function () { sel.innerHTML = '<option value="">failed to load</option>'; });
  }

  // Wire the picker: default the date to today, load fixtures, and fill the
  // team/id fields when a match is chosen. onPick(params) fires after a pick.
  function initPicker(onPick) {
    if ($("date")) $("date").value = todayUTC();
    var sel = $("match");
    if (sel) {
      sel.addEventListener("change", function () {
        var parts = this.value.split("|");
        if ($("home")) $("home").value = parts[0] || "";
        if ($("away")) $("away").value = parts[1] || "";
        if ($("fmid")) $("fmid").value = parts[2] || "";
        if (onPick) onPick(params());
      });
    }
    var btn = $("loadFixtures");
    if (btn) btn.addEventListener("click", loadFixtures);
    if ($("date")) $("date").addEventListener("change", loadFixtures);
    loadFixtures();
  }

  return { $: $, todayUTC: todayUTC, params: params, loadFixtures: loadFixtures, initPicker: initPicker };
})();
