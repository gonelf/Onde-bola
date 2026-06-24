"use client";

/*
 * Match Animation Lab (React) — tunes the replay animation by rendering the SAME
 * <MatchPitch> the public site uses, driven by live controls. Reuses the shared
 * engine (replay-sim.js). Can also load a real finished game via /api/fixtures +
 * /api/matchdetails. This replaces the old static public/admin/replay.html.
 */

import { useMemo, useState } from "react";
import MatchPitch from "@/components/MatchPitch";
import useReplayClock from "@/components/useReplayClock";
import { recordReplayVideo } from "@/components/admin/recordReplay";
import { prepEvents, maxMinute, runningScore, addShotEvents, num, DEFAULT_CONFIG } from "@/public/admin/replay-sim";

const SCENARIOS = {
  thriller: {
    label: "3–3 thriller", home: "Rovers", away: "City", possHome: 56, shots: [14, 11],
    events: [
      { side: "home", min: "9'", kind: "goal", player: "Silva" },
      { side: "away", min: "23'", kind: "yellow", player: "Costa" },
      { side: "away", min: "31'", kind: "goal", player: "Mendes" },
      { side: "home", min: "44'", kind: "goal", player: "Pereira" },
      { side: "home", min: "58'", kind: "sub", player: "Nunes", note: "Dias" },
      { side: "away", min: "67'", kind: "goal", player: "Lopes" },
      { side: "away", min: "79'", kind: "red", player: "Costa" },
      { side: "home", min: "90+2'", kind: "goal", player: "Silva" },
    ],
  },
  grind: {
    label: "1–0 grind", home: "United", away: "Athletic", possHome: 48, shots: [9, 8],
    events: [
      { side: "away", min: "26'", kind: "yellow", player: "Reis" },
      { side: "home", min: "52'", kind: "yellow", player: "Tavares" },
      { side: "home", min: "71'", kind: "goal", player: "Borges" },
      { side: "away", min: "84'", kind: "sub", player: "Faria", note: "Pinto" },
    ],
  },
  rout: {
    label: "4–0 rout", home: "Galácticos", away: "Rangers", possHome: 68, shots: [21, 5],
    events: [
      { side: "home", min: "5'", kind: "goal", player: "Marco" },
      { side: "home", min: "19'", kind: "goal", player: "Vidal" },
      { side: "home", min: "38'", kind: "pengoal", player: "Marco" },
      { side: "away", min: "61'", kind: "red", player: "Hale" },
      { side: "home", min: "73'", kind: "goal", player: "Sousa" },
    ],
  },
};
const FORMATIONS = ["4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "3-4-3", "5-3-2", "4-5-1"];
const BASE_DURATION_MS = 14000; // full match at game speed 1×
const STAT_LABEL = { possession: "Possession", shots: "Shots", sot: "On target", xg: "xG", corners: "Corners", fouls: "Fouls" };

function parseStat(v) {
  const raw = String(v == null ? "" : v).trim();
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { ok: false, raw, num: 0, dec: 0, suffix: "" };
  const dec = m[1].includes(".") ? m[1].split(".")[1].length : 0;
  return { ok: true, raw, num: parseFloat(m[1]), dec, suffix: m[2] || "" };
}

function Slider({ label, value, min, max, step, fmt, onChange }) {
  return (
    <div className="ctl">
      <label style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span><b style={{ color: "var(--accent)" }}>{fmt ? fmt(value) : value}</b>
      </label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export default function ReplayLabPage() {
  const [cfg, setCfg] = useState(Object.assign({ gameSpeed: 1, eventSpeed: 1, trailLength: 10 }, DEFAULT_CONFIG));
  const set = (k, v) => setCfg((c) => Object.assign({}, c, { [k]: v }));

  const [scenarioKey, setScenarioKey] = useState("thriller");
  const [real, setReal] = useState(null);
  const [homeForm, setHomeForm] = useState("4-3-3");
  const [awayForm, setAwayForm] = useState("4-3-3");
  const [homeColor, setHomeColor] = useState("#4a90d9");
  const [awayColor, setAwayColor] = useState("#e8554e");
  const [possHome, setPossHome] = useState(56);
  const [seed, setSeed] = useState(undefined);
  const [disp, setDisp] = useState({ showNumbers: true, showMarkers: true, showTrail: true, showBallShadow: true, showShots: true });

  const match = real || SCENARIOS[scenarioKey];
  const shots = match.shots || [10, 10];
  const stats = useMemo(() => {
    const base = [{ key: "possession", home: possHome, away: 100 - possHome },
      { key: "shots", home: shots[0], away: shots[1] }];
    if (real && Array.isArray(real.stats)) {
      const others = real.stats.filter((s) => s.key !== "possession" && s.key !== "shots");
      return base.concat(others);
    }
    return base;
  }, [real, possHome, shots]);
  const events = useMemo(() => {
    const base = prepEvents(match.events);
    if (!disp.showShots) return base;
    const mm = maxMinute(base);
    return addShotEvents(base, stats, mm, base.length * 131 + Math.round(mm) * 7);
  }, [match, stats, disp.showShots]);
  const maxMin = useMemo(() => maxMinute(events), [events]);

  // Playback clock — pauses on each event for its scene (see useReplayClock).
  // Game speed scales how fast the match clock advances (1× ≈ a 14s full match).
  const sceneScale = 1 / (cfg.eventSpeed || 1);
  const durationMs = BASE_DURATION_MS / (cfg.gameSpeed || 1);
  const { clock, playing, celebrating, toggle, restart, scrub } = useReplayClock(events, maxMin, durationMs, sceneScale);
  const onScrub = (e) => scrub(Number(e.target.value));

  const { hs, as } = runningScore(events, clock);
  const progress = maxMin > 0 ? Math.min(1, clock / maxMin) : 1;
  const minNum = Math.floor(clock);
  const clockLabel = clock >= maxMin ? "FT" : (minNum > 90 ? "90+" + (minNum - 90) : minNum) + "'";
  const scrubPct = (progress * 100).toFixed(2);

  const pickScenario = (key) => {
    const sc = SCENARIOS[key];
    setReal(null); setScenarioKey(key); setSeed(undefined);
    setPossHome(sc.possHome); setHomeForm("4-3-3"); setAwayForm("4-3-3");
    setHomeColor("#4a90d9"); setAwayColor("#e8554e");
  };

  // ---- real game loader ----
  const [date, setDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10));
  const [games, setGames] = useState([]);
  const [gameIdx, setGameIdx] = useState("");
  const [hint, setHint] = useState("no game loaded");

  const findGames = async () => {
    if (!date) { setHint("pick a date"); return; }
    setHint("loading " + date + "…");
    try {
      const r = await fetch("/api/fixtures?date=" + encodeURIComponent(date) + "&all=1");
      const j = await r.json();
      const fin = (j.fixtures || []).filter((f) => f.status === "FT" && f.fmid).map((f) => {
        const sc = (f.homeScore != null && f.awayScore != null) ? (f.homeScore + "–" + f.awayScore) : "";
        return { fmid: f.fmid, home: f.home, away: f.away, label: f.home + " " + sc + " " + f.away + " · " + (f.competition || "") };
      });
      setGames(fin); setGameIdx(fin.length ? "0" : "");
      setHint(fin.length ? fin.length + " finished game(s) — pick & Load" : "0 finished games this date");
    } catch (e) { setHint("error: " + (e && e.message || e)); }
  };

  const loadGame = async () => {
    const g = games[parseInt(gameIdx, 10)];
    if (!g) { setHint("pick a game"); return; }
    setHint("loading " + g.home + " vs " + g.away + "…");
    try {
      const r = await fetch("/api/matchdetails?id=" + encodeURIComponent(g.fmid));
      const j = await r.json();
      if (!j || !j.ok || !j.details) { setHint("no details for this game"); return; }
      const d = j.details, lu = d.lineups || {};
      const ps = (d.stats || []).find((s) => s.key === "possession");
      const ss = (d.stats || []).find((s) => s.key === "shots");
      setReal({
        home: g.home, away: g.away, stats: d.stats || [],
        shots: [ss ? (num(ss.home) || 1) : 1, ss ? (num(ss.away) || 1) : 1],
        events: (d.events || []).map((e) => ({ side: e.side === "away" ? "away" : "home", min: e.min, kind: e.kind, player: e.player, note: e.note })),
      });
      setHomeForm((lu.home && lu.home.formation) || "4-3-3");
      setAwayForm((lu.away && lu.away.formation) || "4-3-3");
      setHomeColor((lu.home && lu.home.kit && lu.home.kit.shirt) || "#4a90d9");
      setAwayColor((lu.away && lu.away.kit && lu.away.kit.shirt) || "#e8554e");
      setPossHome(ps ? (Math.round(num(ps.home)) || 50) : 50);
      setSeed(undefined);
      const n = (d.events || []).length;
      setHint("loaded ✓ " + n + " event" + (n === 1 ? "" : "s") + (n ? "" : " (no timeline — try another)"));
    } catch (e) { setHint("error: " + (e && e.message || e)); }
  };

  // ---- export ----
  const [exportTxt, setExportTxt] = useState("");
  const [recHint, setRecHint] = useState("");
  const [recording, setRecording] = useState(false);

  const exportVideo = async () => {
    if (recording) return;
    setRecording(true); setRecHint("recording…");
    try {
      const name = await recordReplayVideo({
        events, stats, maxMin, seed, cfg,
        gameSpeed: cfg.gameSpeed, sceneScale, baseDurationMs: BASE_DURATION_MS,
        homeName: match.home, awayName: match.away,
        homeForm, awayForm, homeColor, awayColor, goalLabel: "GOAL!",
        display: { showNumbers: disp.showNumbers, showMarkers: disp.showMarkers, showTrail: disp.showTrail, ballShadow: disp.showBallShadow, trailLength: cfg.trailLength },
        onProgress: (p) => setRecHint("recording… " + Math.round(p * 100) + "%"),
      });
      setRecHint("saved " + name + " ✓");
    } catch (e) { setRecHint(String((e && e.message) || e)); }
    finally { setRecording(false); }
  };
  const doExport = () => {
    const out = {
      REPLAY_DURATION_MS: Math.round(BASE_DURATION_MS / (cfg.gameSpeed || 1)), PASS_MIN: cfg.passMin,
      eventSpeed: cfg.eventSpeed,
      blockFollow: cfg.blockFollow, reactLag: cfg.reactLag,
      jitterAmp: cfg.jitterAmp, jitterSpeed: cfg.jitterSpeed,
      attackPush: cfg.attackPush, defendDrop: cfg.defendDrop,
      lateral: cfg.lateral, ballFollow: cfg.ballFollow,
    };
    const txt = JSON.stringify(out, null, 2);
    setExportTxt(txt);
    if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => {});
  };

  const formOptions = (cur) => {
    const list = FORMATIONS.includes(cur) ? FORMATIONS : FORMATIONS.concat([cur]);
    return list.map((f) => <option key={f} value={f}>{f}</option>);
  };

  return (
    <>
      <div className="sub">Tunes the live <code>MatchPitch</code> component. Adjust, then <b>Export</b> the values into <code>DEFAULT_CONFIG</code> in <code>public/admin/replay-sim.js</code>.</div>

      <div className="card" style={{ maxWidth: 660, margin: "0 auto 14px" }}>
        <div className="replay-board">
          <span className="rb-team home" style={{ color: homeColor }}>{match.home}</span>
          <span className="rb-score" key={hs + "-" + as}>{hs}<i>–</i>{as}</span>
          <span className="rb-team away" style={{ color: awayColor }}>{match.away}</span>
        </div>
        <div className="rb-clock">{clockLabel}</div>
        <MatchPitch home={{ name: match.home, formation: homeForm, color: homeColor }}
          away={{ name: match.away, formation: awayForm, color: awayColor }}
          events={events} stats={stats} config={cfg} clock={clock} seed={seed} celebrate={celebrating}
          sceneScale={sceneScale} ballShadow={disp.showBallShadow} trailLength={cfg.trailLength}
          showNumbers={disp.showNumbers} showMarkers={disp.showMarkers} showTrail={disp.showTrail} />
        <div className="replay-controls">
          <button className="replay-btn" type="button" onClick={toggle}>{playing ? "⏸" : "▶"}</button>
          <input className="replay-scrub" type="range" min="0" max={maxMin} step="0.1" value={clock} onChange={onScrub}
            style={{ background: `linear-gradient(90deg, var(--accent) ${scrubPct}%, var(--line) ${scrubPct}%)` }} />
          <button className="replay-btn" type="button" onClick={restart}>↺</button>
        </div>
        {stats.length ? (
          <div className="replay-stats">
            {stats.map((s) => {
              const h = parseStat(s.home), a = parseStat(s.away);
              const tot = h.num + a.num, frac = tot > 0 ? h.num / tot : 0.5;
              return (
                <div key={s.key}>
                  <div className="rstat-top">
                    <span className="rstat-h">{h.ok ? (h.num * progress).toFixed(h.dec) + h.suffix : h.raw}</span>
                    <span className="rstat-label">{STAT_LABEL[s.key] || s.key}</span>
                    <span className="rstat-a">{a.ok ? (a.num * progress).toFixed(a.dec) + a.suffix : a.raw}</span>
                  </div>
                  <div className="rstat-bar">
                    <span className="rstat-fill h" style={{ width: (frac * progress * 100).toFixed(2) + "%" }} />
                    <span className="rstat-fill a" style={{ width: ((1 - frac) * progress * 100).toFixed(2) + "%" }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📥 Load a real finished game</div>
        <div className="sub" style={{ marginBottom: 8 }}>Pick a date, choose a finished game; its real timeline, stats and formations play here.</div>
        <div className="row">
          <div><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div style={{ flex: "2 1 240px" }}>
            <label>Finished game</label>
            <select value={gameIdx} onChange={(e) => setGameIdx(e.target.value)}>
              {games.length ? games.map((g, i) => <option key={i} value={i}>{g.label}</option>) : <option value="">— find games first —</option>}
            </select>
          </div>
        </div>
        <div className="toolbar">
          <button onClick={findGames}>Find games</button>
          <button className="secondary" onClick={loadGame}>Load selected</button>
          <span className="pill">{hint}</span>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🎬 Animation</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Slider label="Game speed" value={cfg.gameSpeed} min={0.25} max={4} step={0.05} fmt={(v) => v.toFixed(2) + "×"} onChange={(v) => set("gameSpeed", v)} />
          <Slider label="Pass interval" value={cfg.passMin} min={0.6} max={4} step={0.1} fmt={(v) => v.toFixed(1) + "'"} onChange={(v) => set("passMin", v)} />
          <Slider label="Player jitter amount" value={cfg.jitterAmp} min={0} max={3} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => set("jitterAmp", v)} />
          <Slider label="Player jitter speed" value={cfg.jitterSpeed} min={0} max={3} step={0.1} fmt={(v) => v.toFixed(1)} onChange={(v) => set("jitterSpeed", v)} />
          <Slider label="Event scene speed" value={cfg.eventSpeed} min={0.3} max={3} step={0.1} fmt={(v) => v.toFixed(1) + "×"} onChange={(v) => set("eventSpeed", v)} />
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🧲 Formation movement</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
          <Slider label="Team block follow" value={cfg.blockFollow} min={0} max={1} step={0.05} fmt={(v) => v.toFixed(2)} onChange={(v) => set("blockFollow", v)} />
          <Slider label="Attack push up" value={cfg.attackPush} min={0} max={25} step={1} onChange={(v) => set("attackPush", v)} />
          <Slider label="Defend drop back" value={cfg.defendDrop} min={0} max={20} step={1} onChange={(v) => set("defendDrop", v)} />
          <Slider label="Reaction lag (ripple)" value={cfg.reactLag} min={0} max={8} step={0.5} fmt={(v) => v.toFixed(1)} onChange={(v) => set("reactLag", v)} />
          <Slider label="Lateral ball-follow" value={cfg.lateral} min={0} max={0.6} step={0.02} fmt={(v) => v.toFixed(2)} onChange={(v) => set("lateral", v)} />
          <Slider label="Pull toward ball" value={cfg.ballFollow} min={0} max={0.2} step={0.01} fmt={(v) => v.toFixed(2)} onChange={(v) => set("ballFollow", v)} />
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>⚽ Match setup</div>
        <div className="row">
          <div><label>Scenario</label>
            <select value={real ? "" : scenarioKey} onChange={(e) => pickScenario(e.target.value)}>
              {real ? <option value="">★ {match.home} vs {match.away}</option> : null}
              {Object.keys(SCENARIOS).map((k) => <option key={k} value={k}>{SCENARIOS[k].label}</option>)}
            </select>
          </div>
          <div><label>Home formation</label><select value={homeForm} onChange={(e) => setHomeForm(e.target.value)}>{formOptions(homeForm)}</select></div>
          <div><label>Away formation</label><select value={awayForm} onChange={(e) => setAwayForm(e.target.value)}>{formOptions(awayForm)}</select></div>
        </div>
        <Slider label="Home possession" value={possHome} min={15} max={85} step={1} fmt={(v) => v + "%"} onChange={(v) => setPossHome(v)} />
        <div className="row">
          <div><label>Home kit</label><input type="color" value={homeColor} onChange={(e) => setHomeColor(e.target.value)} /></div>
          <div><label>Away kit</label><input type="color" value={awayColor} onChange={(e) => setAwayColor(e.target.value)} /></div>
        </div>
        <div className="toolbar"><button className="secondary" onClick={() => setSeed((Math.random() * 1e9) >>> 0 || 1)}>🎲 Reshuffle play</button></div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 8 }}>🖼️ Display</div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={disp.showNumbers} onChange={(e) => setDisp((d) => ({ ...d, showNumbers: e.target.checked }))} /> Shirt numbers</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={disp.showMarkers} onChange={(e) => setDisp((d) => ({ ...d, showMarkers: e.target.checked }))} /> Event markers</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={disp.showTrail} onChange={(e) => setDisp((d) => ({ ...d, showTrail: e.target.checked }))} /> Ball trail</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={disp.showBallShadow} onChange={(e) => setDisp((d) => ({ ...d, showBallShadow: e.target.checked }))} /> Ball shadow</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, width: "auto", color: "var(--text)" }}>
            <input type="checkbox" style={{ width: "auto" }} checked={disp.showShots} onChange={(e) => setDisp((d) => ({ ...d, showShots: e.target.checked }))} /> Shots</label>
        </div>
        <div style={{ maxWidth: 320, marginTop: 8 }}>
          <Slider label="Ball trail length" value={cfg.trailLength} min={2} max={28} step={1} onChange={(v) => set("trailLength", v)} />
        </div>
        <div className="toolbar">
          <button onClick={doExport}>Export settings</button>
          <button className="secondary" onClick={exportVideo} disabled={recording}>{recording ? "Recording…" : "🎥 Export video"}</button>
          <span className="pill">{recHint || "JSON for DEFAULT_CONFIG"}</span>
        </div>
        {exportTxt ? <pre style={{ marginTop: 10 }}>{exportTxt}</pre> : null}
      </div>
    </>
  );
}
