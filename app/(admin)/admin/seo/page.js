"use client";

// pSEO / sitemap registry admin (ported from public/admin/seo.html).

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

export default function SeoPage() {
  const [statHint, setStatHint] = useState("loading…");
  const [stats, setStats] = useState("—");
  const [actionHint, setActionHint] = useState("sweep needs the fixtures feed reachable");
  const [actionOut, setActionOut] = useState("—");
  const [prefix, setPrefix] = useState("");
  const [delPath, setDelPath] = useState("");
  const [listHint, setListHint] = useState("read-only until you click");
  const [urls, setUrls] = useState("—");
  const [busy, setBusy] = useState("");

  const showStats = (j) => {
    const s = (j && j.stats) || {};
    setStatHint(j && j.kv && j.kv.configured ? "KV ✅ connected" : "KV ❌ not configured — sweeps won't persist");
    const lines = [
      "Total URLs:   " + (s.total || 0),
      "  hubs:       " + (s.hubs || 0) + "  (/g/<league>)",
      "  matches:    " + (s.matches || 0) + "  (/g/<league>/<date>/<slug>)",
      "lastmod:      " + (s.oldest || "—") + "  →  " + (s.newest || "—"),
      "",
      "Sample (hubs first, newest first):",
    ];
    (j.sample || []).forEach((e) => lines.push("  " + e.lastmod + "  " + e.path));
    if (!(j.sample || []).length) lines.push("  (registry empty — run a Sweep)");
    setStats(lines.join("\n"));
  };

  const refresh = async () => {
    setStatHint("loading…");
    try { showStats(await asJson(await fetch("/api/seo"))); }
    catch (e) { setStatHint(String(e.message || e)); setStats("—"); }
  };

  const act = async (action) => {
    setBusy(action); setActionHint(action + "…");
    try {
      const j = await asJson(await fetch("/api/seo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      }));
      setActionHint("done ✓"); setActionOut(JSON.stringify(j, null, 2)); refresh();
    } catch (e) { setActionHint(String(e.message || e)); setActionOut(String(e.message || e)); }
    finally { setBusy(""); }
  };

  const list = async () => {
    setListHint("loading…");
    try {
      const j = await asJson(await fetch("/api/seo?list=1" + (prefix.trim() ? "&prefix=" + encodeURIComponent(prefix.trim()) : "")));
      const u = (j && j.urls) || [];
      setListHint((j.count || 0) + " URL(s)" + (prefix.trim() ? " under " + prefix.trim() : ""));
      setUrls(u.length ? u.map((x) => (x.hub ? "[hub]   " : "[match] ") + x.lastmod + "  " + x.path).join("\n")
        : "no URLs" + (prefix.trim() ? " under " + prefix.trim() : "") + " yet");
    } catch (e) { setListHint(String(e.message || e)); }
  };

  const remove = async () => {
    const path = delPath.trim();
    if (!path) { setListHint("enter a path to remove"); return; }
    try { await asJson(await fetch("/api/seo?path=" + encodeURIComponent(path), { method: "DELETE" })); setListHint("removed " + path); list(); refresh(); }
    catch (e) { setListHint(String(e.message || e)); }
  };

  const clearAll = async () => {
    if (!window.confirm("Clear the ENTIRE sitemap registry? The next sweep/cron will rebuild it.")) return;
    try { await asJson(await fetch("/api/seo?all=1", { method: "DELETE" })); setListHint("registry cleared"); setUrls("—"); refresh(); }
    catch (e) { setListHint(String(e.message || e)); }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <>
      <div className="sub">Inspect and manage the programmatic-SEO sitemap registry (KV <code>seo:urls</code>) that <code>/sitemap.xml</code> serves and <code>/api/cron-sitemap</code> maintains.</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Registry status</div>
        <div className="sub" style={{ marginBottom: 10 }}>Counts of league/edition hubs vs per-match pages, and the lastmod range. Needs KV connected to persist anything.</div>
        <div className="toolbar">
          <button onClick={refresh}>Refresh status</button>
          <a className="secondary" href="/sitemap.xml" target="_blank" rel="noopener" style={{ textDecoration: "none", padding: "9px 11px", border: "1px solid var(--line)", borderRadius: 9 }}>Open /sitemap.xml ↗</a>
          <span className="pill">{statHint}</span>
        </div>
        <pre>{stats}</pre>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Rebuild the registry</div>
        <div className="sub" style={{ marginBottom: 10 }}><b>Sweep</b> scans the fixtures window and upserts canonical URLs. <b>Rebuild</b> clears first, then sweeps. <b>Prune</b> drops stale entries.</div>
        <div className="toolbar">
          <button disabled={!!busy} onClick={() => act("sweep")}>{busy === "sweep" ? "Working…" : "Sweep ▶"}</button>
          <button className="secondary" disabled={!!busy} onClick={() => { if (window.confirm("Rebuild clears the registry first, then sweeps. Continue?")) act("rebuild"); }}>{busy === "rebuild" ? "Working…" : "Rebuild (clear + sweep)"}</button>
          <button className="secondary" disabled={!!busy} onClick={() => act("prune")}>{busy === "prune" ? "Working…" : "Prune stale"}</button>
          <span className="pill">{actionHint}</span>
        </div>
        <pre>{actionOut}</pre>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Browse / remove URLs</div>
        <div className="sub" style={{ marginBottom: 10 }}>List registered URLs (optionally filtered by path prefix), or remove a single one / clear everything.</div>
        <div className="row">
          <div><label>Path prefix (optional)</label><input type="text" placeholder="e.g. /g/champions-league" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
          <div><label>Path to remove</label><input type="text" placeholder="e.g. /g/euro-2024/2024-06-14/germany-vs-scotland" value={delPath} onChange={(e) => setDelPath(e.target.value)} /></div>
        </div>
        <div className="toolbar">
          <button onClick={list}>List URLs</button>
          <button className="secondary" onClick={remove}>Remove path</button>
          <button className="secondary" onClick={clearAll}>Clear ALL</button>
          <span className="pill">{listHint}</span>
        </div>
        <pre>{urls}</pre>
      </div>
    </>
  );
}
