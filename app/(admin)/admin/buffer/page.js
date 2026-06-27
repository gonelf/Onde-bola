"use client";

// Buffer automation admin: see the config + scheduling log, preview the post for
// a day (square card + caption), and schedule it on Buffer on demand. Behind
// Basic Auth via middleware, so /api/buffer calls carry the admin credentials
// automatically. The daily cron (/api/cron-buffer) writes to the same log.

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

function fmtWhen(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
}

export default function BufferPage() {
  const [config, setConfig] = useState(null);
  const [kvConfigured, setKvConfigured] = useState(true);
  const [log, setLog] = useState([]);
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [textHint, setTextHint] = useState("");
  const [hint, setHint] = useState("loading…");
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState(null);
  const [channelHint, setChannelHint] = useState("");

  const load = async () => {
    setHint("loading…");
    try {
      const j = await asJson(await fetch("/api/buffer"));
      setConfig(j.config || null);
      setKvConfigured(j.kvConfigured !== false);
      setLog(Array.isArray(j.log) ? j.log : []);
      if (!date && j.nextDate) setDate(j.nextDate);
      const note = j.kvConfigured ? "" : " · ⚠️ KV not configured — log won’t persist";
      const cfg = j.config && j.config.configured ? "Buffer configured" : "⚠️ Buffer not configured";
      setHint(cfg + note);
    } catch (e) { setHint(String(e.message || e)); }
  };

  // Pull the caption for the chosen day from the public text endpoint — the same
  // words the cron schedules and that /image shows.
  const loadText = async (d) => {
    if (!d) return;
    setTextHint("loading caption…");
    setText("");
    try {
      const r = await fetch(`/image/${encodeURIComponent(d)}/text`, { headers: { Accept: "text/plain" } });
      const t = await r.text();
      setText(t);
      setTextHint(r.ok ? `${t.split("\n").filter(Boolean).length} lines` : `HTTP ${r.status}`);
    } catch (e) { setTextHint(String(e.message || e)); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (date) loadText(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleNow = async () => {
    if (busy) return;
    if (!config || !config.configured) { setHint("⚠️ set BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_IDS first"); return; }
    if (!window.confirm(`Schedule the ${date} post on Buffer for ${date} 09:00 UTC?`)) return;
    setBusy(true);
    setHint("scheduling…");
    try {
      const j = await asJson(await fetch("/api/buffer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "schedule", date }),
      }));
      setLog(Array.isArray(j.log) ? j.log : []);
      const r = j.result || {};
      setHint(r.ok ? `scheduled ✓ for ${r.scheduledAt}` : `failed: ${r.message || "error"}`);
    } catch (e) { setHint(String(e.message || e)); }
    setBusy(false);
  };

  const discoverChannels = async () => {
    if (busy) return;
    setBusy(true);
    setChannelHint("discovering…");
    try {
      const j = await asJson(await fetch("/api/buffer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "channels" }),
      }));
      setChannels(Array.isArray(j.channels) ? j.channels : []);
      setChannelHint(`${(j.channels || []).length} channel(s) — copy ids into BUFFER_CHANNEL_IDS`);
    } catch (e) { setChannels([]); setChannelHint(String(e.message || e)); }
    setBusy(false);
  };

  const clearLog = async () => {
    if (busy) return;
    if (!window.confirm("Clear the Buffer schedule log?")) return;
    setBusy(true);
    try {
      const j = await asJson(await fetch("/api/buffer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      }));
      setLog(Array.isArray(j.log) ? j.log : []);
      setHint("log cleared ✓");
    } catch (e) { setHint(String(e.message || e)); }
    setBusy(false);
  };

  const imageUrl = date ? `/image/${date}/square` : "";

  return (
    <>
      <div className="sub">
        Schedule the day&apos;s &ldquo;games of the day&rdquo; post on Buffer — the square card plus the matching
        caption. The daily cron (<code>/api/cron-buffer</code>) does this automatically for 09:00 UTC; here you can
        preview a day, schedule it on demand and review the history.
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>⚙️ Configuration</div>
        {config ? (
          <div className="sub" style={{ marginBottom: 0 }}>
            API key: <strong>{config.tokenSet ? "set ✓" : "missing ✗"}</strong> ·{" "}
            Channels: <strong>{config.channelCount}</strong>
            {config.channelIds && config.channelIds.length ? <> (<code>{config.channelIds.join(", ")}</code>)</> : null} ·{" "}
            Status: <strong>{config.configured ? "ready ✓" : "not configured ✗"}</strong>
            {config.configured ? null : (
              <> — set <code>BUFFER_ACCESS_TOKEN</code> (a Buffer personal API key) and <code>BUFFER_CHANNEL_IDS</code> in the environment.</>
            )}
            {kvConfigured ? null : <> · <span style={{ color: "var(--warn)" }}>KV not configured — the log won&apos;t persist.</span></>}
          </div>
        ) : <div className="sub" style={{ marginBottom: 0 }}>—</div>}
        <div className="toolbar">
          <button className="secondary" onClick={discoverChannels} disabled={busy || !(config && config.tokenSet)}>Discover channels</button>
          {channelHint ? <span className="pill">{channelHint}</span> : null}
        </div>
        {channels && channels.length ? (
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {channels.map((c) => (
              <div className="loader-row" key={c.id} style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <code>{c.id}</code>
                <strong>{c.name || "(unnamed)"}</strong>
                {c.service ? <span className="pill">{c.service}</span> : null}
                {c.organizationName ? <span className="sub" style={{ margin: 0 }}>· {c.organizationName}</span> : null}
              </div>
            ))}
          </div>
        ) : (channels && !channels.length ? <div className="loader-empty" style={{ marginTop: 10 }}>No channels found.</div> : null)}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>📅 Schedule a day</div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Pick the day to post about; it&apos;s scheduled on Buffer for <strong>09:00 UTC</strong> that day. Buffer
          fetches the square image itself from its public URL.
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <label htmlFor="bdate">Day (YYYY-MM-DD)</label>
            <input id="bdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div style={{ flex: "1 1 280px" }}>
            <label>Square card preview</label>
            {imageUrl ? (
              <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                <img src={imageUrl} alt={`Square card for ${date}`} style={{ width: "100%", borderRadius: 10, border: "1px solid var(--line)", background: "#0a1120" }} />
              </a>
            ) : <div className="loader-empty">Pick a day.</div>}
          </div>
          <div style={{ flex: "1 1 280px" }}>
            <label>Caption {textHint ? <span style={{ color: "var(--muted)" }}>· {textHint}</span> : null}</label>
            <textarea readOnly value={text} placeholder="loading…" aria-label="Post caption"
              style={{ width: "100%", minHeight: 220, resize: "vertical", font: "12px/1.5 ui-monospace, Menlo, Consolas, monospace",
                color: "var(--text)", background: "var(--panel2)", border: "1px solid var(--line)", borderRadius: 10, padding: 12 }} />
          </div>
        </div>

        <div className="toolbar">
          <button onClick={scheduleNow} disabled={busy || !config || !config.configured}>Schedule on Buffer ▶</button>
          <button className="secondary" onClick={() => loadText(date)} disabled={busy}>Refresh preview</button>
          <span className="pill">{hint}</span>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginTop: 0, marginBottom: 10, justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600 }}>🧾 Schedule log <span className="sub" style={{ marginLeft: 6 }}>({log.length})</span></div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="secondary" onClick={load} disabled={busy}>Reload</button>
            <button className="secondary" onClick={clearLog} disabled={busy || !log.length}>Clear log</button>
          </div>
        </div>
        {log.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {log.map((e, i) => (
              <div className="loader-row" key={(e.at || "") + i} style={{ marginBottom: 0 }}>
                <div className="loader-head" style={{ marginBottom: 4, flexWrap: "wrap" }}>
                  <span className={"dot " + (e.ok ? "ok" : "bad")} />
                  <strong>{e.date}</strong>
                  <span className="pill">{e.trigger || "manual"}</span>
                  <span className="sub" style={{ margin: 0 }}>→ {e.scheduledAt}</span>
                  <span className="meta" style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>{fmtWhen(e.at)}</span>
                </div>
                <div className="sub" style={{ margin: 0 }}>
                  {e.ok ? "scheduled" : "failed"}
                  {typeof e.status === "number" && e.status ? <> · HTTP {e.status}</> : null}
                  {e.message ? <> · {e.message}</> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="loader-empty">No scheduling attempts yet.</div>}
      </div>
    </>
  );
}
