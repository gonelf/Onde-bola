"use client";

// Feature flags admin (ported from public/admin/flags.html). Behind Basic Auth
// via middleware, so /api/flags calls carry the admin credentials automatically.

import { useEffect, useState } from "react";
import { asJson } from "@/components/admin/adminUtil";

export default function FlagsPage() {
  const [flags, setFlags] = useState([]);
  const [hint, setHint] = useState("loading…");

  const load = async () => {
    setHint("loading…");
    try {
      const j = await asJson(await fetch("/api/flags"));
      const fl = Array.isArray(j.flags) ? j.flags : [];
      setFlags(fl);
      const note = j.kvConfigured ? "" : " · ⚠️ KV not configured — saves won’t persist";
      setHint("loaded · " + fl.length + " flag" + (fl.length === 1 ? "" : "s") + note);
    } catch (e) { setHint(String(e.message || e)); }
  };

  const save = async () => {
    setHint("saving…");
    try {
      const j = await asJson(await fetch("/api/flags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flags: flags.map((f) => ({ id: f.id, state: f.state })) }),
      }));
      if (j && j.ok) { setFlags(j.flags || []); setHint("saved ✓ (live within a few minutes)"); }
      else setHint((j && j.error) || "error");
    } catch (e) { setHint(String(e.message || e)); }
  };

  useEffect(() => { load(); }, []);

  const setState = (id, state) =>
    setFlags((fl) => fl.map((f) => f.id === id ? Object.assign({}, f, { state }) : f));

  return (
    <>
      <div className="sub">Turn app behavior on per environment without a deploy.</div>
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 2 }}>🚩 Feature flags</div>
        <div className="sub" style={{ marginBottom: 10 }}>
          Each flag is read by the live site; pick where it&apos;s on and Save to change behavior within
          a few minutes. <strong>Off</strong> = nowhere · <strong>Dev</strong> = localhost only ·
          <strong> Staging</strong> = <code>hojehabola.cfd</code> only · <strong>Production</strong> = all hosts.
          Stored server-side (needs <code>ADMIN_USER</code> / <code>ADMIN_PASSWORD</code> and KV configured).
        </div>
        <div>
          {flags.length ? flags.map((f) => (
            <div className="loader-row" key={f.id}>
              <div className="loader-head">
                <select value={f.state || "off"} onChange={(e) => setState(f.id, e.target.value)}>
                  <option value="off">Off</option>
                  <option value="dev">Dev</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
                <strong style={{ marginLeft: 8 }}>{f.label || f.id}</strong>
              </div>
              {f.description ? <div className="sub" style={{ margin: "6px 0 0" }}>{f.description}</div> : null}
            </div>
          )) : <div className="loader-empty">No flags defined.</div>}
        </div>
        <div className="toolbar">
          <button onClick={save}>Save</button>
          <button className="secondary" onClick={load}>Reload</button>
          <span className="pill">{hint}</span>
        </div>
      </div>
    </>
  );
}
