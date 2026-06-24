"use client";

// Manage ad units (ported from public/admin/ads.html). NB: classes stay
// "loader-*" (not "ad-*") so ad blockers don't hide the admin UI.

import { useEffect, useRef, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

const DEFAULT_SLOTS = [
  { id: "list-top", label: "Games list — top" },
  { id: "list-bottom", label: "Games list — bottom" },
  { id: "detail", label: "Per-game page" },
  { id: "global", label: "Site-wide (self-placing)" },
];

// Mirrors lib/ads-store.js#bannerSnippet — client-side, for Preview only.
function bannerSnippet(key, width, height) {
  const closeTag = "<" + "/script>";
  const k = String(key || ""), w = Number(width) || 468, h = Number(height) || 60;
  return "<script>\natOptions = {\n  'key' : " + JSON.stringify(k) + ",\n  'format' : 'iframe',\n" +
    "  'height' : " + h + ",\n  'width' : " + w + ",\n  'params' : {}\n};\n" + closeTag +
    "\n<script src=\"https://www.highperformanceformat.com/" + encodeURIComponent(k) + "/invoke.js\">" + closeTag;
}

const SITE_CSS =
  ":root{--bg:#0f1722;--bg-elev:#182433;--line:#26384c;--text:#e8eef5;--text-dim:#93a4b8;}" +
  "html,body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}" +
  ".ad-slot{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;position:relative;padding:10px;" +
  "background:var(--bg-elev);border:1px solid var(--line);border-radius:10px;min-height:60px;" +
  "flex-direction:column;align-items:center;overflow-x:auto;overflow-y:hidden;max-width:100%;box-sizing:border-box;}" +
  ".ad-slot .ad-label{position:absolute;top:6px;left:10px;font-size:0.6rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);}" +
  ".ad-slot .ad-unit{max-width:100%;overflow-x:auto;}" +
  ".ad-slot .ad-unit iframe,.ad-slot .ad-unit img{max-width:100%;}" +
  ".ad-slot iframe,.ad-slot img{max-width:100%;}" +
  ".ad-slot .adsbygoogle{width:100%;display:block;}";

let UID = 1;
function toRow(u) {
  u = u || {};
  const isBanner = !!(u.banner && u.banner.key);
  return {
    uid: UID++, enabled: u.enabled !== false, slot: u.slot || "global",
    kind: isBanner ? "banner" : "snippet", script: u.script || "", label: u.label || "",
    key: (u.banner && u.banner.key) || "", width: (u.banner && u.banner.width) || 468,
    height: (u.banner && u.banner.height) || 60, preview: false,
  };
}

export default function AdsPage() {
  const [slots, setSlots] = useState(DEFAULT_SLOTS);
  const [rows, setRows] = useState([]);
  const [hint, setHint] = useState("loading…");

  const load = async () => {
    setHint("loading…");
    try {
      const j = await asJson(await fetch("/api/ads"));
      if (j && Array.isArray(j.slots) && j.slots.length) setSlots(j.slots);
      const units = (j && Array.isArray(j.ads)) ? j.ads : [];
      setRows(units.map(toRow));
      const note = (j && j.kvConfigured) ? "" : " · ⚠️ KV not configured — saves won’t persist";
      setHint("loaded · " + units.length + " unit" + (units.length === 1 ? "" : "s") + note);
    } catch (e) { setHint(String(e.message || e)); }
  };

  useEffect(() => { load(); }, []);

  const upd = (uid, patch) => setRows((rs) => rs.map((r) => r.uid === uid ? Object.assign({}, r, patch) : r));
  const del = (uid) => setRows((rs) => rs.filter((r) => r.uid !== uid));
  const add = () => setRows((rs) => rs.concat([toRow({ enabled: true, slot: "list-top" })]));

  const collect = () => rows.map((r) => {
    const common = { label: r.label.trim(), enabled: r.enabled, slot: r.slot };
    if (r.kind === "banner") {
      if (!String(r.key).trim()) return null;
      common.banner = { key: String(r.key).trim(), width: Number(r.width) || 468, height: Number(r.height) || 60 };
      return common;
    }
    if (!String(r.script).trim()) return null;
    common.script = String(r.script).trim();
    return common;
  }).filter(Boolean);

  const save = async () => {
    setHint("saving…");
    try {
      const j = await asJson(await fetch("/api/ads", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ads: collect() }),
      }));
      if (j && j.ok) { setRows((j.ads || []).map(toRow)); setHint("saved ✓ (live within a few minutes)"); }
      else setHint((j && j.error) || "error");
    } catch (e) { setHint(String(e.message || e)); }
  };

  const previewDoc = (r) => {
    const snippet = r.kind === "banner" ? bannerSnippet(r.key, r.width, r.height) : r.script;
    if (!String(snippet).trim()) return null;
    return "<!doctype html><html><head><meta charset='utf-8'><base target='_blank'><style>" + SITE_CSS + "</style></head><body>" +
      "<div class='ad-slot ad-slot-" + r.slot + "' data-ad-slot='" + r.slot + "'><span class='ad-label'>Ad</span>" + snippet + "</div></body></html>";
  };

  return (
    <>
      <div className="sub">Third-party ad units and where each one renders in the layout.</div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>📢 Manage ads</div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Add a unit, pick where it shows, and Save. For a key+size iframe banner switch to <b>Banner ad</b> and fill the key
          and size. Otherwise leave <b>Custom snippet</b> and paste the full <code>&lt;script&gt;…&lt;/script&gt;</code>. Stored
          server-side (needs <code>ADMIN_USER</code> / <code>ADMIN_PASSWORD</code> and KV). For a deeper look try the <a href="/admin/ad-test">Ad script tester</a>.
        </div>
        <div>
          {rows.length ? rows.map((r) => {
            const doc = r.preview ? previewDoc(r) : null;
            return (
              <div className="loader-row" key={r.uid}>
                <div className="loader-head">
                  <label className="loader-onlabel"><input type="checkbox" checked={r.enabled} onChange={(e) => upd(r.uid, { enabled: e.target.checked })} /> on</label>
                  <select className="loader-kind" value={r.kind} onChange={(e) => upd(r.uid, { kind: e.target.value })}>
                    <option value="snippet">Custom snippet</option>
                    <option value="banner">Banner ad (key + size)</option>
                  </select>
                  <select className="loader-slot" value={r.slot} onChange={(e) => upd(r.uid, { slot: e.target.value })}>
                    {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <button type="button" className="loader-del" title="Remove" onClick={() => del(r.uid)}>✕</button>
                </div>
                {r.kind === "snippet" ? (
                  <div className="loader-snippet-view">
                    <textarea className="loader-src" rows={4} placeholder={"<script>…</" + "script>  or  banner HTML"} value={r.script} onChange={(e) => upd(r.uid, { script: e.target.value })} />
                  </div>
                ) : (
                  <div className="loader-banner-view row">
                    <div><label>Key</label><input type="text" value={r.key} onChange={(e) => upd(r.uid, { key: e.target.value })} /></div>
                    <div><label>Width</label><input type="number" value={r.width} onChange={(e) => upd(r.uid, { width: e.target.value })} /></div>
                    <div><label>Height</label><input type="number" value={r.height} onChange={(e) => upd(r.uid, { height: e.target.value })} /></div>
                  </div>
                )}
                <input type="text" className="loader-label" placeholder="label (optional)" value={r.label} onChange={(e) => upd(r.uid, { label: e.target.value })} />
                <div className="loader-actions">
                  <button type="button" className="secondary loader-preview" onClick={() => upd(r.uid, { preview: !r.preview })}>Preview</button>
                </div>
                {r.preview ? (
                  <div className="loader-preview-box">
                    {doc ? <iframe className="loader-preview-frame" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} title="Ad preview" /> : "(empty)"}
                  </div>
                ) : null}
              </div>
            );
          }) : <div className="loader-empty">Nothing configured — click “Add unit” to create one.</div>}
        </div>
        <div className="toolbar">
          <button className="secondary" onClick={add}>+ Add unit</button>
          <button onClick={save}>Save</button>
          <button className="secondary" onClick={load}>Reload</button>
          <span className="pill">{hint}</span>
        </div>
      </div>
    </>
  );
}
