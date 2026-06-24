"use client";

// Connections debug (ported from public/admin/index.html). Live-tests each TV
// source through its own proxy, from the deployed server. Read-only.

import { useEffect, useRef, useState } from "react";
import MatchPicker from "@/components/admin/MatchPicker";
import { todayUTC, copyText } from "@/components/admin/adminUtil";

const TESTS = [
  { id: "health", label: "Health / config", needs: [],
    url: () => "/api/health",
    summary: (j) => {
      if (!j) return "no response";
      let kvSeen = "";
      if (j.kv && j.kv.env) {
        const seen = Object.keys(j.kv.env).filter((k) => j.kv.env[k]);
        kvSeen = " (env seen: " + (seen.length ? seen.join(", ") : "none") + ")";
      }
      return "KV " + (j.kv && j.kv.ping ? "✅ " + j.kv.ping : (j.kv && j.kv.configured ? "⚠️ configured, no ping" + (j.kv.status ? " (HTTP " + j.kv.status + ")" : "") : "❌ off" + kvSeen)) +
        " · SofaScore " + (j.sofascore && j.sofascore.enabled ? "on" : "off") +
        " · FotMob " + (j.fotmob && j.fotmob.enabled ? "on" : "off");
    } },
  { id: "fixtures", label: "FotMob · fixtures (api/fixtures)", needs: ["date"],
    url: (p) => "/api/fixtures?date=" + p.date + "&debug=1",
    summary: (j) => { if (!j) return "no response"; const n = (j.fixtures || []).length; const d = j._debug || {}; return n + " fixtures · via " + (d.via || "?") + " · upstream " + (d.upstream ? "ok" : "fail"); } },
  { id: "tsdb_tv", label: "TheSportsDB · TV day (api/tv)", needs: ["date"],
    url: (p) => "/api/tv?date=" + p.date,
    summary: (j) => { const ev = (j && j.tvevents) || (j && j.events) || []; return ev.length + " TV rows"; } },
  { id: "fmtv", label: "FotMob (api/fmtv)", needs: ["date"],
    url: (p) => "/api/fmtv?date=" + p.date + "&debug=1" + (p.home ? "&home=" + encodeURIComponent(p.home) : "") + (p.away ? "&away=" + encodeURIComponent(p.away) : ""),
    summary: (j) => {
      if (!j) return "no response";
      const m = (j.matches || []).length; const d = j._debug || {}; const cs = d.countries || {};
      const parts = Object.keys(cs).map((c) => c + ":" + (cs[c].matchKeys || 0));
      let line = m + " matches merged · per-country " + (parts.join(" ") || "—");
      if (d.match) {
        const fmt = (x) => Object.keys(x.byCountry).map((c) => "      " + c + ": " + x.byCountry[c].join(", ")).join("\n");
        const mm = d.match.matched || [], nm = d.match.nearMisses || [];
        line += "\n  this match: " + (mm.length ? "merged ✅" : "NOT merged ❌");
        mm.forEach((x) => { line += "\n" + fmt(x); });
        const raw = d.match.rawById || {};
        Object.keys(raw).forEach((id) => {
          line += "\n  raw feed for id " + id + ":";
          const per = raw[id], codes = Object.keys(per);
          if (!codes.length) { line += " (no country's raw feed has this id)"; return; }
          codes.forEach((c) => { line += "\n      " + c + ": " + per[c].map((e) => e.station + " @ " + e.start).join(" | "); });
        });
        if (nm.length) { line += "\n  near-misses (only one team name matched — listing dropped):"; nm.forEach((x) => { line += "\n    " + x.home + " vs " + x.away + " (" + x.matched + " side matched)\n" + fmt(x); }); }
      }
      return line;
    } },
  { id: "sporttvscan", label: "FotMob · Sport TV scan (which matches PT has)", needs: ["date"],
    url: (p) => "/api/fmtv?date=" + p.date + "&debug=1&chan=" + encodeURIComponent("sport tv"),
    summary: (j) => {
      if (!j) return "no response";
      const sc = (j._debug && j._debug.channelScan) || null;
      if (!sc) return "no scan";
      let line = sc.count + " matches carry a \"Sport TV\" channel";
      (sc.hits || []).forEach((h) => { line += "\n  " + h.home + " vs " + h.away + " (id " + h.id + "): " + h.channels.join(", "); });
      return line;
    } },
  { id: "listings", label: "Merged store (api/listings)", needs: ["date"],
    url: (p) => "/api/listings?date=" + p.date,
    summary: (j, p) => {
      if (!j) return "no response";
      const m = (j && j.matches) || {};
      let line = Object.keys(m).length + " matches stored (built by cron-listings)";
      const fmid = (p.fmid || "").trim();
      if (fmid && m[fmid]) {
        const rec = m[fmid], byC = {};
        (rec.rows || []).forEach((r) => { (byC[r.country] = byC[r.country] || []).push(r.channel); });
        line += "\n  this match: " + (rec.rows || []).length + " channels";
        Object.keys(byC).forEach((c) => { line += "\n      " + c + ": " + byC[c].join(", "); });
      } else if (fmid) { line += "\n  this match (id " + fmid + "): not in store yet — run /api/cron-listings"; }
      return line;
    } },
  { id: "matchdetails", label: "FotMob · match details (api/matchdetails)", needs: ["fmid"],
    url: (p) => "/api/matchdetails?id=" + encodeURIComponent(p.fmid) + "&debug=1",
    summary: (j) => {
      if (!j) return "no response";
      if (!j.ok) return "no details (ok=false)";
      const d = j.details || {};
      let line = "venue " + (d.venue ? "✅" : "—") + " · ref " + (d.referee ? "✅" : "—") + " · att " + (d.attendance || "—") +
        " · events " + ((d.events || []).length) + " · stats " + ((d.stats || []).length) +
        " · form " + (d.form ? "✅" : "—") + " · h2h " + (d.h2h ? "✅" : "—") + " · motm " + (d.motm ? "✅" : "—") + " · highlights " + (d.highlights ? "✅" : "—");
      const s = j._shape;
      if (s) line += "\n  content: " + (s.content || []).join(",") + "\n  matchFacts: " + (s.matchFacts || []).join(",") +
        "\n  h2h keys: " + (s.h2h_keys ? s.h2h_keys.join(",") : "none") + "\n  h2h sample: " + (s.h2h_sample || "") + "\n  motm: " + (s.motm_candidates || "");
      const b = j._broadcast || [];
      line += "\n  broadcast scan: " + b.length + " hit(s)";
      b.forEach((h) => { line += "\n      " + h.path + (h.value ? " = " + h.value : (h.sample ? " → " + h.sample : "")); });
      return line;
    } },
  { id: "sofatv", label: "SofaScore (api/sofatv)", needs: ["date", "home", "away"],
    url: (p) => "/api/sofatv?date=" + p.date + "&home=" + encodeURIComponent(p.home) + "&away=" + encodeURIComponent(p.away) + "&debug=1",
    summary: (j) => {
      if (!j) return "no response";
      const tv = (j.tvevent || []).length; const d = j._debug || {}; const pt = d.countries && d.countries.PT;
      return tv + " channels · dayIndex " + (d.dayIndexSize != null ? d.dayIndexSize : "?") + " · event " + (d.matchedEventId || "—") +
        " · resolved " + (d.resolved || 0) + "/" + (d.totalPairs || 0) + (pt != null ? " · PT raw " + pt : " · no PT");
    } },
];

export default function ConnectionsPage() {
  const [pick, setPick] = useState({ date: todayUTC(), home: "", away: "", fmid: "" });
  const [results, setResults] = useState({});
  const [hint, setHint] = useState("tip: pick a match, then Run all");
  const [copying, setCopying] = useState(false);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const runTest = async (t) => {
    const p = pickRef.current;
    const missing = t.needs.filter((n) => !p[n]);
    if (missing.length) {
      setResults((r) => Object.assign({}, r, { [t.id]: { dot: "warn", status: "needs " + missing.join(", "), line: "", sum: "skipped — fill " + missing.join(", "), url: "", pre: "—" } }));
      return;
    }
    const url = t.url(p);
    const t0 = performance.now();
    setResults((r) => Object.assign({}, r, { [t.id]: Object.assign({}, r[t.id], { status: "running…", url }) }));
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      const ms = Math.round(performance.now() - t0);
      const cache = resp.headers.get("X-Cache") || "";
      const txt = await resp.text();
      let j = null; try { j = JSON.parse(txt); } catch (e) {}
      const status = "HTTP " + resp.status + (cache ? " · " + cache : "") + " · " + ms + "ms";
      const line = j ? t.summary(j, p) : "non-JSON response";
      setResults((r) => Object.assign({}, r, { [t.id]: { dot: resp.ok ? "ok" : "bad", status, line, sum: line, url, pre: j ? JSON.stringify(j, null, 2) : txt.slice(0, 4000) } }));
    } catch (e) {
      setResults((r) => Object.assign({}, r, { [t.id]: { dot: "bad", status: "fetch error", line: String(e), sum: String(e), url, pre: "—" } }));
    }
  };

  const runAll = async () => { for (const t of TESTS) { await runTest(t); } };

  const copyReport = async () => {
    if (copying) return;
    setCopying(true);
    await runAll();
    const p = pickRef.current;
    const lines = ["Hoje Há Bola — connections report", "Date: " + p.date + (p.home ? "  ·  " + p.home + " vs " + p.away : ""), "Generated: " + new Date().toISOString(), ""];
    TESTS.forEach((t) => {
      const r = results[t.id];
      lines.push("[" + t.label + "]");
      if (!r) { lines.push("  not run"); lines.push(""); return; }
      if (r.url) lines.push("  " + r.url);
      lines.push("  " + (r.status || ""));
      if (r.line) lines.push("  " + r.line);
      lines.push("");
    });
    await copyText(lines.join("\n"));
    setCopying(false);
    setHint("report copied ✓");
  };

  useEffect(() => { runTest(TESTS[0]); }, []); // health on open

  return (
    <>
      <div className="sub">Live-tests each TV source through its own proxy. Runs from the deployed server, so it can reach upstreams your browser and CI can't. Read-only.</div>

      <MatchPicker value={pick} onChange={setPick}>
        <button className="run-all" onClick={runAll}>Run all tests ▶</button>
        <button className="secondary" onClick={copyReport}>{copying ? "Running…" : "Copy report ⧉"}</button>
        <span className="pill">{hint}</span>
      </MatchPicker>

      <div className="tests">
        {TESTS.map((t) => {
          const r = results[t.id] || {};
          return (
            <details className="test" key={t.id} open>
              <summary>
                <span className={"dot " + (r.dot || "")} />
                <span className="name">{t.label}</span>
                <span className="meta">{r.status || ""}</span>
                <button className="copy" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyText(r.pre || ""); }}>Copy</button>
              </summary>
              <div className="summary-line">{r.url ? <><span className="k">{r.url}</span><br /></> : <span className="k">not run yet</span>}{r.sum || ""}</div>
              <pre>{r.pre || "—"}</pre>
            </details>
          );
        })}
      </div>
    </>
  );
}
