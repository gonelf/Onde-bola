"use client";

/*
 * AdDebug — opt-in on-page diagnostics for "why isn't this ad showing".
 *
 * Off by default (no cost to real visitors). Enable once via ?addebug=1 (the
 * flag is sticky in localStorage so it survives navigation); ?addebug=0 turns
 * it back off. While on, a small panel tracks every <script> inserted
 * anywhere on the page (most ad loaders self-insert their real script tag
 * rather than shipping one with a src up front), whether each one actually
 * loaded or errored, a simple ad-blocker probe (a classically-blocklisted
 * bait element), and which `.ad-slot`s rendered vs came back empty — so a
 * blank slot can be told apart as "no unit assigned", "script never loaded"
 * or "loaded but produced nothing".
 */

import { useEffect, useState } from "react";

const AD_HOST_HINTS = [
  "googlesyndication", "doubleclick", "googleadservices", "adsbygoogle",
  "massivesalad", "highperformanceformat", "propellerads", "adsterra",
  "popads", "exoclick", "revcontent", "taboola", "outbrain",
];

function isAdHost(url) {
  try {
    return AD_HOST_HINTS.some((s) => new URL(url, location.href).hostname.includes(s));
  } catch (e) {
    return AD_HOST_HINTS.some((s) => String(url).includes(s));
  }
}

export default function AdDebug() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(true);
  const [events, setEvents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    const qs = new URLSearchParams(location.search);
    const flag = qs.get("addebug");
    if (flag === "1") localStorage.setItem("adDebug", "1");
    if (flag === "0") localStorage.removeItem("adDebug");
    if (localStorage.getItem("adDebug") !== "1") return;
    setEnabled(true);

    const log = (kind, text) =>
      setEvents((prev) => [...prev.slice(-199), { t: Date.now(), kind, text }]);
    log("init", "ad debug enabled — watching script loads on this page");

    // Classic cosmetic-filter bait: many blocklists hide elements whose
    // class looks ad-related. If this gets hidden, a blocker is active.
    const bait = document.createElement("div");
    bait.className = "ad ads ad-banner adsbygoogle adunit";
    bait.style.cssText = "position:absolute;left:-9999px;top:0;width:2px;height:2px;";
    document.body.appendChild(bait);

    const seen = new WeakSet();
    function watch(el) {
      if (seen.has(el)) return;
      seen.add(el);
      const src = el.src || "";
      const t0 = performance.now();
      log("script", src ? `+ <script src="${src}">` : `+ inline <script> (${(el.textContent || "").slice(0, 80).replace(/\s+/g, " ")})`);
      if (src) {
        el.addEventListener("load", () => log("ok", `loaded ${src} (${Math.round(performance.now() - t0)}ms)`));
        el.addEventListener("error", () => log("error", `FAILED to load ${src} — blocked, 404, or network error`));
      }
    }
    document.querySelectorAll("script").forEach(watch);
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (!n.tagName) return;
          if (n.tagName === "SCRIPT") watch(n);
          else if (n.querySelectorAll) n.querySelectorAll("script").forEach(watch);
        })
      );
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    function onError(e) {
      if (e && e.target && e.target.tagName) {
        log("error", `resource error: <${e.target.tagName.toLowerCase()}> ${e.target.src || e.target.href || ""}`);
      }
    }
    window.addEventListener("error", onError, true);

    function snapshot() {
      const els = Array.from(document.querySelectorAll(".ad-slot[data-ad-slot]"));
      setSlots(
        els.map((el) => ({
          name: el.dataset.adSlot,
          height: el.offsetHeight,
          units: el.children.length,
          empty: el.innerHTML.trim() === "",
        }))
      );
      const style = getComputedStyle(bait);
      setBlocked(bait.offsetParent === null && document.body.contains(bait) ? true : style.display === "none" || style.visibility === "hidden");
      const hits = performance
        .getEntriesByType("resource")
        .filter((r) => isAdHost(r.name))
        .map((r) => `${r.name} (${Math.round(r.duration)}ms, ${r.transferSize || 0}B)`);
      if (hits.length) log("net", `ad-network requests seen: ${hits.join(" | ")}`);
    }
    const timers = [setTimeout(snapshot, 1000), setTimeout(snapshot, 3000), setTimeout(snapshot, 6000)];

    return () => {
      mo.disconnect();
      window.removeEventListener("error", onError, true);
      timers.forEach(clearTimeout);
      bait.remove();
    };
  }, []);

  if (!enabled) return null;

  const panelStyle = {
    position: "fixed", bottom: 8, right: 8, zIndex: 999999,
    width: open ? 360 : "auto", maxWidth: "calc(100vw - 16px)",
    background: "#0b1220", color: "#e6edf6", border: "1px solid #243349",
    borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.45)",
    font: "12px/1.45 ui-monospace, Menlo, Consolas, monospace",
  };

  return (
    <div style={panelStyle}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer", borderBottom: open ? "1px solid #243349" : "none" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "none", background: blocked ? "#f87171" : blocked === false ? "#34d399" : "#475569" }} />
        <b style={{ fontFamily: "-apple-system, sans-serif" }}>Ad debug</b>
        <span style={{ marginLeft: "auto", opacity: 0.6 }}>{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div style={{ padding: "8px 10px", maxHeight: "60vh", overflow: "auto" }}>
          {blocked === true && <div style={{ color: "#f87171", marginBottom: 6 }}>⚠ bait element hidden — an ad/content blocker looks active in this browser</div>}
          {blocked === false && <div style={{ color: "#34d399", marginBottom: 6 }}>no cosmetic ad-blocker detected (bait element visible)</div>}

          <div style={{ marginBottom: 6 }}>
            <b style={{ fontFamily: "-apple-system, sans-serif" }}>Slots on this page</b>
            {!slots.length && <div style={{ opacity: 0.6 }}>none rendered yet</div>}
            {slots.map((s) => (
              <div key={s.name}>
                {s.name}: {s.empty ? "empty (no unit assigned, or blocked before paint)" : `${s.units} node(s), ${s.height}px tall`}
              </div>
            ))}
          </div>

          <div>
            <b style={{ fontFamily: "-apple-system, sans-serif" }}>Events</b>
            <div style={{ marginTop: 2 }}>
              {events.map((e, i) => (
                <div key={i} style={{ color: e.kind === "error" ? "#f87171" : e.kind === "ok" ? "#34d399" : "#93a3b8", wordBreak: "break-all" }}>
                  {new Date(e.t).toLocaleTimeString()} · {e.text}
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => { localStorage.removeItem("adDebug"); location.reload(); }}
            style={{ marginTop: 8, font: "inherit", color: "#e6edf6", background: "#131c2e", border: "1px solid #243349", borderRadius: 7, padding: "5px 9px", cursor: "pointer" }}
          >
            Disable
          </button>
        </div>
      )}
    </div>
  );
}
