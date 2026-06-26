"use client";

// Ad script tester (ported from public/admin/ad-test.html). Renders a pasted ad
// snippet in a sandboxed iframe styled like the live site, with a harness that
// reports every script insert / load / error back via postMessage.

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/components/admin/adminUtil";

const closeTag = "<" + "/script>";

const EXAMPLES = {
  adsense:
    '<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"\n' +
    '     data-ad-slot="0000000000" data-ad-format="auto" data-full-width-responsive="true"></ins>\n' +
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX">' + closeTag + '\n' +
    '<script>(adsbygoogle = window.adsbygoogle || []).push({});' + closeTag,
  banner:
    "<script>\natOptions = {\n  'key' : 'replace_with_real_key',\n  'format' : 'iframe',\n  'height' : 60,\n  'width' : 468,\n  'params' : {}\n};\n" + closeTag + "\n" +
    '<script src="https://www.highperformanceformat.com/replace_with_real_key/invoke.js">' + closeTag,
  popunder:
    "<script>\n(function(gzsj){\nvar d = document,\n    s = d.createElement('script'),\n    l = d.scripts[d.scripts.length - 1];\ns.settings = gzsj || {};\ns.src = \"//example.com/replace-with-real-loader.js\";\ns.async = true;\ns.referrerPolicy = 'no-referrer-when-downgrade';\nl.parentNode.insertBefore(s, l);\n})({})\n" + closeTag,
};

function harnessScript() {
  return (
    "<script>\n(function(){\n" +
    "  function post(type, detail){ try { parent.postMessage({__adTest:true, type:type, detail:detail, t:Date.now()}, '*'); } catch(e){} }\n" +
    "  window.addEventListener('error', function(e){\n" +
    "    if (e && e.target && e.target.tagName) post('error', 'resource error: <' + e.target.tagName.toLowerCase() + '> ' + (e.target.src || e.target.href || ''));\n" +
    "    else post('error', 'script error: ' + ((e && e.message) || 'unknown'));\n" +
    "  }, true);\n" +
    "  window.addEventListener('unhandledrejection', function(e){ post('error', 'unhandled rejection: ' + String(e.reason)); });\n" +
    "  var seen = (typeof WeakSet !== 'undefined') ? new WeakSet() : { has:function(){return false;}, add:function(){} };\n" +
    "  function watch(el){\n" +
    "    if (seen.has(el)) return; seen.add(el);\n" +
    "    var src = el.src || '';\n" +
    "    var t0 = performance.now();\n" +
    "    post('script', src ? ('+ <script src=\"' + src + '\">') : ('+ inline <script> (' + (el.textContent||'').slice(0,120).replace(/\\s+/g,' ') + ')'));\n" +
    "    if (src) {\n" +
    "      el.addEventListener('load', function(){ post('ok', 'loaded ' + src + ' (' + Math.round(performance.now()-t0) + 'ms)'); });\n" +
    "      el.addEventListener('error', function(){ post('error', 'FAILED to load ' + src + ' \\u2014 blocked / 404 / network error'); });\n" +
    "    }\n" +
    "  }\n" +
    "  var seenFrames = (typeof WeakSet !== 'undefined') ? new WeakSet() : { has:function(){return false;}, add:function(){} };\n" +
    "  function watchFrame(el){\n" +
    "    if (seenFrames.has(el)) return; seenFrames.add(el);\n" +
    "    var w = el.getAttribute('width') || el.offsetWidth || '?';\n" +
    "    var h = el.getAttribute('height') || el.offsetHeight || '?';\n" +
    "    post('frame', { src: el.getAttribute('src') || '', w: String(w), h: String(h) });\n" +
    "  }\n" +
    "  document.querySelectorAll('script').forEach(watch);\n" +
    "  document.querySelectorAll('iframe').forEach(watchFrame);\n" +
    "  new MutationObserver(function(muts){\n" +
    "    muts.forEach(function(m){\n" +
    "      Array.prototype.forEach.call(m.addedNodes, function(n){\n" +
    "        if (!n.tagName) return;\n" +
    "        if (n.tagName === 'SCRIPT') watch(n);\n" +
    "        else if (n.tagName === 'IFRAME') watchFrame(n);\n" +
    "        else if (n.querySelectorAll) { Array.prototype.forEach.call(n.querySelectorAll('script'), watch); Array.prototype.forEach.call(n.querySelectorAll('iframe'), watchFrame); }\n" +
    "      });\n" +
    "    });\n" +
    "  }).observe(document.documentElement, {childList:true, subtree:true});\n" +
    "  var bait = null;\n" +
    "  function makeBait(){\n" +
    "    bait = document.createElement('div');\n" +
    "    bait.className = 'ad ads ad-banner adsbygoogle adunit';\n" +
    "    bait.style.cssText = 'position:absolute;left:-9999px;top:0;width:2px;height:2px;';\n" +
    "    document.body.appendChild(bait);\n" +
    "  }\n" +
    "  if (document.body) makeBait(); else document.addEventListener('DOMContentLoaded', makeBait);\n" +
    "  function snapshot(){\n" +
    "    var box = document.getElementById('preview-root');\n" +
    "    var blocked = null;\n" +
    "    if (bait) { var style = getComputedStyle(bait); blocked = (bait.offsetParent === null) || style.display === 'none' || style.visibility === 'hidden'; }\n" +
    "    post('snapshot', { height: box ? box.offsetHeight : 0, childCount: box ? box.children.length : 0, blocked: blocked });\n" +
    "    var res = performance.getEntriesByType('resource').map(function(r){ return { name:r.name, ms:Math.round(r.duration), bytes:r.transferSize||0, it:r.initiatorType }; });\n" +
    "    post('resources', res);\n" +
    "  }\n" +
    "  setTimeout(snapshot, 700); setTimeout(snapshot, 2200); setTimeout(snapshot, 5000);\n" +
    "  post('ready', 'harness attached');\n" +
    "})();\n" + closeTag
  );
}

const SITE_CSS =
  ":root{--bg:#0f1722;--bg-elev:#182433;--line:#26384c;--text:#e8eef5;--text-dim:#93a4b8;--accent:#16d27a;}" +
  "html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}" +
  ".container{max-width:880px;margin:0 auto;padding:16px;}" +
  ".ad-slot{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;margin:0 auto;position:relative;padding:10px;" +
  "background:var(--bg-elev);border:1px solid var(--line);border-radius:12px;min-height:90px;flex-direction:column;align-items:center;overflow-x:auto;overflow-y:hidden;max-width:100%;}" +
  ".ad-slot .ad-label{position:absolute;top:6px;left:10px;font-size:0.6rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);}" +
  ".ad-slot .ad-unit{max-width:100%;overflow-x:auto;}" +
  ".ad-slot .ad-unit iframe,.ad-slot .ad-unit img{max-width:100%;}" +
  ".ad-slot iframe,.ad-slot img{max-width:100%;}" +
  ".ad-slot .adsbygoogle{width:100%;display:block;}";

function buildDoc(snippet, slotName) {
  return "<!doctype html><html><head><meta charset='utf-8'><base target='_blank'><style>" + SITE_CSS + "</style>" +
    harnessScript() + "</head><body><div class='container'><div id='preview-root' class='ad-slot ad-slot-" + slotName + "' data-ad-slot='" + slotName + "'>" +
    "<span class='ad-label'>Ad</span>" + snippet + "</div></div></body></html>";
}

const hostOf = (u) => { try { return new URL(u, location.href).host; } catch (e) { return ""; } };

export default function AdTestPage() {
  const [snippet, setSnippet] = useState("");
  const [slot, setSlot] = useState("home-top");
  const [doc, setDoc] = useState(null);
  const [frameHint, setFrameHint] = useState("Paste a snippet above and click Render preview.");
  const [events, setEvents] = useState([]);
  const [blocked, setBlocked] = useState(null);
  const frameRef = useRef(null);
  const declaredRef = useRef({});
  const flaggedRef = useRef({});
  const resourceRef = useRef([]);

  const add = (kind, text) => setEvents((ev) => ev.concat([{ t: Date.now(), kind, text }]));

  useEffect(() => {
    const onMsg = (e) => {
      const frame = frameRef.current;
      if (!e.data || !e.data.__adTest || !frame || e.source !== frame.contentWindow) return;
      const d = e.data;
      switch (d.type) {
        case "ready": add("ok", "harness attached — watching for script inserts"); break;
        case "script": add("script", d.detail); break;
        case "ok": add("ok", d.detail); break;
        case "error": add("error", d.detail); break;
        case "snapshot": {
          setBlocked(d.detail.blocked);
          const hasContent = d.detail.childCount > 0 && d.detail.height > 0;
          const kind = d.detail.blocked ? "box-error" : hasContent ? "box-ok" : "box-warn";
          const msg = d.detail.blocked
            ? "preview box: " + d.detail.childCount + " node(s), " + d.detail.height + "px tall · blocker bait hidden — an ad/content blocker looks active"
            : hasContent ? "preview box: " + d.detail.childCount + " node(s), " + d.detail.height + "px tall — content present"
            : "preview box: empty (" + d.detail.childCount + " node(s), " + d.detail.height + "px) — nothing rendered yet";
          add(kind, msg); break;
        }
        case "frame": add("frame", "+ <iframe" + (d.detail.src ? ' src="' + d.detail.src + '"' : "") + "> inserted — " + d.detail.w + "×" + d.detail.h + " creative slot. If blank, the network returned no ad (no-fill)."); break;
        case "resources": (d.detail || []).forEach((r) => {
          const it = r.it;
          if (!(it === "iframe" || it === "img" || it === "css" || it === "link" || it === "video" || it === "audio")) {
            const h = hostOf(r.name);
            if (h && !declaredRef.current[h] && !flaggedRef.current[h]) {
              flaggedRef.current[h] = true;
              add("warn", "⚠ contacted 3rd-party host '" + h + "' that isn't in your pasted snippet — the signature of a self-placing / redirect format (popunder, social bar, push, direct link).");
            }
          }
          if (resourceRef.current.indexOf(r.name) !== -1) return;
          resourceRef.current.push(r.name);
          add("net", "network: " + r.name + " (" + r.ms + "ms, " + r.bytes + "B)" + (r.bytes === 0 && r.ms === 0 ? " — likely cached or never actually sent" : ""));
        }); break;
        default: break;
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const render = () => {
    if (!snippet.trim()) { setFrameHint("Paste a snippet first."); return; }
    setEvents([]); setBlocked(null); resourceRef.current = []; flaggedRef.current = {};
    const declared = { [location.host]: true };
    const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi; let m;
    while ((m = re.exec(snippet))) { const h = hostOf(m[1]); if (h) declared[h] = true; }
    declaredRef.current = declared;
    setDoc(buildDoc(snippet, slot));
    setFrameHint('Rendering as slot "' + slot + '"…');
  };

  const clear = () => { setSnippet(""); setDoc(null); setEvents([]); setBlocked(null); setFrameHint("Paste a snippet above and click Render preview."); };

  const copyLog = () => {
    const lines = events.map((e) => new Date(e.t).toISOString() + "  [" + e.kind + "]  " + e.text);
    copyText(lines.length ? lines.join("\n") : "(no events — render a snippet first)");
  };

  const scripts = events.filter((e) => e.kind === "script").length;
  const okN = events.filter((e) => e.kind === "ok").length;
  const errN = events.filter((e) => e.kind === "error").length;
  const flagged = Object.keys(flaggedRef.current).length;

  return (
    <>
      <div className="sub">Paste any ad network's snippet and see it rendered the way it will look in a real ad slot, plus a live log of every script it tries to load and whether that load succeeded.</div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>📋 Ad snippet</div>
        <div className="sub" style={{ marginBottom: 10 }}>Paste the verbatim snippet — same thing you'd put in <a href="/admin/ads">Manage ads</a>.</div>
        <textarea rows={8} style={{ minHeight: 140, font: "12px/1.45 ui-monospace, Menlo, Consolas, monospace" }}
          placeholder="<script>...</script>  or  <ins class=&quot;adsbygoogle&quot;...></ins>  or anything else"
          value={snippet} onChange={(e) => setSnippet(e.target.value)} />
        <div className="toolbar">
          <select style={{ width: "auto" }} value={slot} onChange={(e) => setSlot(e.target.value)}>
            <option value="home-top">Slot: home-top</option>
            <option value="home-bottom">Slot: home-bottom</option>
            <option value="fixtures-feed">Slot: fixtures-feed</option>
            <option value="detail-top">Slot: detail-top</option>
            <option value="detail-bottom">Slot: detail-bottom</option>
          </select>
          <select style={{ width: "auto" }} value="" onChange={(e) => { if (e.target.value && EXAMPLES[e.target.value]) setSnippet(EXAMPLES[e.target.value]); }}>
            <option value="">Load an example…</option>
            <option value="adsense">Example: AdSense display unit</option>
            <option value="banner">Example: key+size banner loader</option>
            <option value="popunder">Example: self-placing loader</option>
          </select>
          <button onClick={render}>Render preview ▶</button>
          <button className="secondary" onClick={clear}>Clear</button>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>🖼️ Preview</div>
        <div className="sub" style={{ marginBottom: 10 }}>Rendered in a sandboxed iframe styled like the live site. Your own ad/content blocker still applies here too.</div>
        <div style={{ border: "1px dashed var(--line)", borderRadius: 10, overflow: "hidden" }}>
          {doc ? <iframe ref={frameRef} title="Ad preview" srcDoc={doc} sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            style={{ width: "100%", minHeight: 240, border: 0, display: "block", background: "#0f1722" }} /> : null}
        </div>
        <div className="sub" style={{ marginTop: 8 }}>{frameHint}</div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>🐞 Debug log</div>
        <div className="at-summary" style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
          {events.length ? (
            <>
              <span><b>{scripts}</b> script(s) inserted</span>
              <span><b>{okN}</b> loaded ok</span>
              <span><b>{errN}</b> failed/errored</span>
              {blocked === true ? <span style={{ color: "var(--bad)" }}>⚠ bait element hidden — blocker active</span> : null}
              {blocked === false ? <span style={{ color: "var(--ok)" }}>no cosmetic blocker detected</span> : null}
              {flagged ? <span style={{ color: "var(--warn)" }}>⚠ self-placing / redirect behavior detected — won&apos;t show a banner</span> : null}
            </>
          ) : <span className="pill">render a snippet to see results</span>}
        </div>
        <div className="toolbar" style={{ marginTop: 0, marginBottom: 10 }}>
          <button className="secondary" onClick={copyLog}>Copy debug report ⧉</button>
          <span className="pill">{events.length ? events.length + " event(s)" : "nothing yet"}</span>
        </div>
        <div style={{ maxHeight: 320, overflow: "auto", font: "12px/1.5 ui-monospace, Menlo, Consolas, monospace" }}>
          {events.map((e, i) => (
            <div key={i} className={"at-row " + e.kind} style={{ padding: "3px 0", borderBottom: "1px solid var(--line)", wordBreak: "break-all" }}>
              <span style={{ color: "var(--muted)", marginRight: 6 }}>{new Date(e.t).toLocaleTimeString()}</span>{e.text}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
