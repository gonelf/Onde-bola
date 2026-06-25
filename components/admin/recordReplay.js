"use client";

/*
 * recordReplayVideo — render the match replay to an offscreen <canvas> using the
 * shared deterministic engine (replay-sim.js) and capture it to a WebM/MP4 file
 * via MediaRecorder. Mirrors MatchPitch's look (pitch, players, ball, markers,
 * event scenes) and the useReplayClock playback (pausing the clock on each scene)
 * so the exported video matches the on-screen animation.
 *
 * Returns a Promise that resolves with the download filename when done.
 */

import {
  buildSim, formationArr, teamBase, simState, placePlayers, passBall,
  markerType, pitchPos, runningScore, sceneMs, DEFAULT_CONFIG,
} from "@/public/admin/replay-sim";
import { createReplayAudio } from "@/components/replaySounds";

const W = 960, HEADER = 64, PITCHH = 600, H = HEADER + PITCHH;
const PX = (x) => (x / 100) * W;
const PY = (y) => HEADER + (y / 100) * PITCHH;

function pickMime(withAudio) {
  // Prefer MP4 (H.264) so Safari/iOS and recent Chrome export .mp4; fall back to
  // WebM only where MP4 recording isn't available (older Chrome/Firefox). When
  // sound is wanted, try codec strings that include an audio track first.
  const av = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus",
  ];
  const vonly = [
    "video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=h264", "video/mp4",
    "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm",
  ];
  const cands = withAudio ? av.concat(vonly) : vonly;
  for (const m of cands) { if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m; }
  return "";
}

// Does the chosen mime carry an audio codec (so we should attach an audio track)?
const mimeHasAudio = (m) => /opus|mp4a|aac/i.test(m || "");

function drawPitch(ctx) {
  const g = ctx.createLinearGradient(0, HEADER, W, H);
  g.addColorStop(0, "#1f7a3d"); g.addColorStop(1, "#145c2c");
  ctx.fillStyle = g; ctx.fillRect(0, HEADER, W, PITCHH);
  // mowing stripes
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 8; i += 2) ctx.fillRect((i / 8) * W, HEADER, W / 8, PITCHH);
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2, HEADER); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, HEADER + PITCHH / 2, PITCHH * 0.12, 0, Math.PI * 2); ctx.stroke();
  const boxW = W * 0.13, boxH = PITCHH * 0.56, boxY = HEADER + (PITCHH - boxH) / 2;
  ctx.strokeRect(0, boxY, boxW, boxH); ctx.strokeRect(W - boxW, boxY, boxW, boxH);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  const gH = PITCHH * 0.18, gY = HEADER + (PITCHH - gH) / 2;
  ctx.fillRect(0, gY, 6, gH); ctx.fillRect(W - 6, gY, 6, gH);
}

function drawHeader(ctx, homeName, awayName, hs, as, clockLabel) {
  ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, HEADER);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e6edf6"; ctx.font = "700 22px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right"; ctx.fillText(homeName, W / 2 - 70, HEADER / 2 - 4);
  ctx.textAlign = "left"; ctx.fillText(awayName, W / 2 + 70, HEADER / 2 - 4);
  ctx.textAlign = "center";
  ctx.font = "800 30px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(hs + " – " + as, W / 2, HEADER / 2 - 4);
  ctx.fillStyle = "#38bdf8"; ctx.font = "700 14px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(clockLabel, W / 2, HEADER - 12);
}

function drawScene(ctx, ev, p, goalLabel, frame) {
  const cx = frame && frame.cx != null ? frame.cx : W / 2;
  const cy = frame && frame.cy != null ? frame.cy : HEADER + PITCHH / 2;
  const fw = frame && frame.w != null ? frame.w : W;
  const FS = frame && frame.fs ? frame.fs : 1;
  const type = markerType(ev.kind);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.save();
  if (type === "goal") {
    if (p < 0.62) {
      const x = (-0.25 + (p / 0.62) * 1.5) * fw;
      ctx.globalAlpha = Math.min(1, 1 - Math.abs(p / 0.62 - 0.5) * 1.6 + 0.4);
      ctx.fillStyle = "#fff"; ctx.font = "900 " + (64 * FS) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 12;
      ctx.fillText(String(goalLabel || "GOAL!").toUpperCase(), x, cy);
    } else {
      const s = Math.min(1, (p - 0.62) / 0.25);
      ctx.globalAlpha = s; ctx.fillStyle = "#fff";
      ctx.font = "800 " + (28 * FS * (0.6 + 0.4 * s)) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 8;
      ctx.fillText(ev.player || "", cx, cy);
    }
  } else if (type === "phase") {
    const label = ev.kind === "kickoff" ? "KICK-OFF" : ev.kind === "halftime" ? "HALF-TIME" : "FULL-TIME";
    const s = Math.min(1, p / 0.3);
    ctx.globalAlpha = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;
    ctx.fillStyle = "#fff"; ctx.font = "900 " + (44 * FS * (0.7 + 0.3 * s)) + "px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 10;
    ctx.fillText(label, cx, cy);
  } else if (ev.kind === "sub") {
    const out = p < 0.5;
    ctx.globalAlpha = 1; ctx.font = "900 " + (48 * FS) + "px sans-serif";
    ctx.fillStyle = out ? "#f87171" : "#f4c430";
    ctx.fillText(out ? "▼" : "▲", cx, cy - 22 * FS);
    ctx.fillStyle = "#fff"; ctx.font = "800 " + (24 * FS) + "px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 8;
    ctx.fillText((out ? (ev.note || ev.player) : ev.player) || "", cx, cy + 22 * FS);
  } else { // card
    if (p < 0.34) { ctx.font = (60 * FS) + "px sans-serif"; ctx.fillText("🔔", cx, cy); }
    else if (p < 0.67) {
      ctx.fillStyle = type === "red" ? "#f87171" : "#f1c40f";
      ctx.fillRect(cx - 16 * FS, cy - 26 * FS, 32 * FS, 44 * FS);
      ctx.font = (40 * FS) + "px sans-serif"; ctx.fillText("✋", cx, cy - 50 * FS);
    } else {
      ctx.globalAlpha = 1; ctx.fillStyle = "#fff"; ctx.font = "800 " + (26 * FS) + "px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 8;
      ctx.fillText(ev.player || "", cx, cy);
    }
  }
  ctx.restore();
}

// Branding + live-result band for the IG-story (portrait) layout: the "Hoje Há
// Bola" logo on top, then the scoreline with team names tinted by kit colour,
// then the clock — so a shared reel is instantly identifiable.
function drawHeaderIG(ctx, w, h, homeName, awayName, hs, as, clockLabel, homeColor, awayColor) {
  ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  ctx.textBaseline = "middle";
  // brand (two-tone, centred): ⚽ Hoje Há Bola
  ctx.font = "800 40px -apple-system, Segoe UI, Roboto, sans-serif";
  const p1 = "⚽ Hoje Há ", p2 = "Bola";
  const w1 = ctx.measureText(p1).width, w2 = ctx.measureText(p2).width;
  const bx = cx - (w1 + w2) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = "#e6edf6"; ctx.fillText(p1, bx, 52);
  ctx.fillStyle = "#38bdf8"; ctx.fillText(p2, bx + w1, 52);
  // scoreline + team names
  ctx.textAlign = "center"; ctx.fillStyle = "#fff";
  ctx.font = "800 64px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(hs + " – " + as, cx, 134);
  ctx.font = "700 34px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right"; ctx.fillStyle = homeColor || "#e6edf6"; ctx.fillText(homeName, cx - 140, 134);
  ctx.textAlign = "left"; ctx.fillStyle = awayColor || "#e6edf6"; ctx.fillText(awayName, cx + 140, 134);
  // clock
  ctx.textAlign = "center"; ctx.fillStyle = "#38bdf8";
  ctx.font = "700 26px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(clockLabel, cx, 200);
}

const MARK_COLOR = { goal: "#38d39f", yellow: "#f1c40f", red: "#f87171", sub: "#4a90d9", shot: "#ffb347", other: "#cfd8e3" };

export function recordReplayVideo(opts) {
  const cfg = opts.cfg || DEFAULT_CONFIG;
  const cfgNoLag = Object.assign({}, cfg, { reactLag: 0 });
  const events = opts.events;
  const maxMin = opts.maxMin;
  const sim = buildSim(events, opts.stats, maxMin, opts.seed);
  const bases = { home: teamBase(formationArr(opts.homeForm), true), away: teamBase(formationArr(opts.awayForm), false) };
  const homeColor = opts.homeColor || "#4a90d9", awayColor = opts.awayColor || "#e8554e";
  const durationMs = (opts.baseDurationMs || 14000) / (opts.gameSpeed || 1);
  const sceneScale = opts.sceneScale != null ? opts.sceneScale : 1;
  const d = opts.display || {};
  const trailLength = d.trailLength || 10;
  const gameSpeed = opts.gameSpeed || 1;
  const eventFont = opts.eventFont || 1;

  // IG-story (portrait 9:16) layout + a "broadcast camera" that zooms into the
  // pitch and pans to follow the ball. The camera centre eases toward the ball
  // each frame, so it trails a couple of beats behind the action and glides
  // instead of cutting. Landscape keeps the full pitch with no camera.
  const ig = !!opts.igStory;
  const OW = ig ? 1080 : W;
  const OH = ig ? 1920 : H;
  const HEADER_IG = 240;
  const PR = ig ? { x: 0, y: HEADER_IG, w: OW, h: OH - HEADER_IG } : { x: 0, y: HEADER, w: W, h: PITCHH };
  const camScale = ig ? PR.h / PITCHH : 1;            // world→screen zoom (full pitch height shown)
  const winXpct = ig ? (PR.w * 100) / (camScale * W) : 100; // pitch width (%) visible in the frame
  const camHalf = winXpct / 2;
  const camTau = 380 / (opts.camSpeed || 1);         // easing time constant (higher camSpeed → snappier)
  let camX = 50;                                      // eased camera centre, pitch %

  const sampleField = (c) => simState(sim.wp, c);
  const playersNowAt = (c) => ({
    home: placePlayers(bases.home, true, sampleField, c, cfgNoLag),
    away: placePlayers(bases.away, false, sampleField, c, cfgNoLag),
  });
  const ballAt = (c) => passBall(c, sim.wp, sim.wHome, sim.seed, playersNowAt(c), events, maxMin, cfg);

  const canvas = document.createElement("canvas");
  canvas.width = OW; canvas.height = OH;
  const ctx = canvas.getContext("2d");

  // Output resolution scale — the RELIABLE size lever. MediaRecorder's
  // videoBitsPerSecond is only a hint and is largely ignored for canvas/H.264,
  // so we render full-res then blit into a smaller capture canvas: fewer pixels
  // → smaller file. scale 1 captures the render canvas directly.
  const scale = opts.scale > 0 ? Math.min(1, Math.max(0.35, opts.scale)) : 1;
  const outW = Math.max(2, Math.round(OW * scale / 2) * 2);
  const outH = Math.max(2, Math.round(OH * scale / 2) * 2);
  let capCanvas = canvas, capCtx = ctx;
  if (outW !== OW || outH !== OH) {
    capCanvas = document.createElement("canvas");
    capCanvas.width = outW; capCanvas.height = outH;
    capCtx = capCanvas.getContext("2d");
    capCtx.imageSmoothingEnabled = true; capCtx.imageSmoothingQuality = "high";
  }
  const present = () => { if (capCanvas !== canvas) capCtx.drawImage(canvas, 0, 0, OW, OH, 0, 0, outW, outH); };

  const wantSound = opts.sound !== false;
  const wantMusic = !!opts.music;
  const wantAudio = wantSound || wantMusic;
  const mime = pickMime(wantAudio);
  if (!mime || !capCanvas.captureStream) return Promise.reject(new Error("Video recording isn’t supported in this browser"));

  // Event SFX + background music, muxed into the recording via a
  // MediaStreamDestination (only when the chosen container can carry audio).
  // Best-effort — silent on failure.
  let audio = null;
  if (wantAudio && mimeHasAudio(mime)) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const actx = new AC();
      const destNode = actx.createMediaStreamDestination();
      audio = createReplayAudio({ context: actx, destination: destNode, gain: 0.6, eventSounds: opts.eventSounds });
      if (audio) { audio.resume(); audio._track = destNode.stream.getAudioTracks()[0]; }
    } catch (e) { audio = null; }
  }

  const draw = (clock, celeb, sceneP) => {
    ctx.clearRect(0, 0, OW, OH);
    ctx.save();
    if (ig) {
      // Clip to the pitch region, then map world (pitch) coords through the
      // camera: zoom by camScale and pan so camX sits at the frame centre. All
      // the pitch drawing below stays in world coords and is scaled crisply.
      ctx.beginPath(); ctx.rect(PR.x, PR.y, PR.w, PR.h); ctx.clip();
      ctx.translate(PR.x + PR.w / 2, PR.y + PR.h / 2);
      ctx.scale(camScale, camScale);
      ctx.translate(-(camX / 100) * W, -(HEADER + PITCHH / 2));
    }
    drawPitch(ctx);
    // trail
    if (d.showTrail) {
      for (let k = 1; k <= trailLength; k++) {
        const c = clock - k * 0.7 * gameSpeed; if (c < 0) break;
        const b = ballAt(c);
        ctx.globalAlpha = (1 - k / trailLength) * 0.4; ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(PX(b.x), PY(b.y), 9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // players (lagged)
    const players = {
      home: placePlayers(bases.home, true, sampleField, clock, cfg),
      away: placePlayers(bases.away, false, sampleField, clock, cfg),
    };
    const drawTeam = (arr, color) => arr.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(PX(p.x), PY(p.y), 22, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.stroke();
      if (d.showNumbers) { ctx.fillStyle = "#fff"; ctx.font = "700 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(i + 1), PX(p.x), PY(p.y)); }
    });
    drawTeam(players.home, homeColor); drawTeam(players.away, awayColor);
    // markers
    if (d.showMarkers !== false) {
      events.forEach((ev, i) => {
        if (ev._m > clock + 1e-9) return;
        const type = markerType(ev.kind), dt = clock - ev._m;
        if (type === "phase") return; // no pitch marker for match phases
        if (type !== "goal" && dt > 4) return; // non-goals fade
        const pos = pitchPos(ev, i);
        let alpha = type === "goal" ? (dt >= 1.4 ? 0.4 : 1) : Math.max(0, 1 - dt / 4);
        const pop = dt < 1.4 ? 1 + (1 - dt / 1.4) * 1.3 : (type === "goal" && dt >= 1.4 ? 0.8 : 1);
        const r = (type === "shot" ? 15 : 22) * pop;
        ctx.globalAlpha = alpha; ctx.fillStyle = MARK_COLOR[type] || "#cfd8e3";
        ctx.beginPath(); ctx.arc(PX(pos.x), PY(pos.y), r, 0, Math.PI * 2); ctx.fill();
        if (type === "goal") { ctx.globalAlpha = alpha; ctx.font = r + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("⚽", PX(pos.x), PY(pos.y)); }
      });
      ctx.globalAlpha = 1;
    }
    // ball
    const ball = ballAt(clock);
    ctx.save();
    if (d.ballShadow !== false) { ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3; }
    ctx.font = "34px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("⚽", PX(ball.x), PY(ball.y));
    ctx.restore();   // ball shadow
    ctx.restore();   // camera transform + pitch clip
    // scoreboard
    const { hs, as } = runningScore(events, clock);
    const mn = Math.floor(clock);
    const label = clock >= maxMin ? "FT" : (mn > 90 ? "90+" + (mn - 90) : mn) + "'";
    if (ig) drawHeaderIG(ctx, OW, HEADER_IG, opts.homeName || "Home", opts.awayName || "Away", hs, as, label, homeColor, awayColor);
    else drawHeader(ctx, opts.homeName || "Home", opts.awayName || "Away", hs, as, label);
    // scene (centred on the visible frame; enlarged for the portrait story)
    if (celeb) drawScene(ctx, celeb, sceneP, opts.goalLabel, ig ? { cx: OW / 2, cy: PR.y + PR.h / 2, w: OW, fs: 1.8 * eventFont } : { fs: eventFont });
    // site watermark over the bottom of the pitch
    if (ig) {
      ctx.save();
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.font = "700 26px -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 6;
      ctx.fillText("hojehabola.com", OW / 2, OH - 26);
      ctx.restore();
    }
    present(); // blit the full-res frame into the (possibly smaller) capture canvas
  };

  // Paint one frame at OW×OH BEFORE capturing, so the recorded track locks to the
  // real canvas size (portrait for IG) rather than an unpainted/default size —
  // otherwise some browsers record the story at a landscape resolution.
  draw(0, null, 0);
  const stream = capCanvas.captureStream(30);
  if (audio && audio._track) { try { stream.addTrack(audio._track); } catch (e) { /* noop */ } }
  // Bitrate hint, sized to the output pixels (browsers that honour it benefit;
  // the real size control is the resolution scale above).
  const bitrate = Math.round(outW * outH * 30 * 0.1);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    const done = () => {
      const blob = new Blob(chunks, { type: mime });
      const name = (ig ? "match-replay-story." : "match-replay.") + (mime.indexOf("mp4") >= 0 ? "mp4" : "webm");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      if (audio && audio.ctx && audio.ctx.close) { try { audio.ctx.close(); } catch (e) { /* noop */ } }
      resolve(name);
    };
    rec.onstop = done;
    rec.onerror = (e) => reject(e.error || new Error("recording failed"));

    let clock = 0, holdUntil = 0, celeb = null, celebStart = 0, endAt = 0;
    const celebrated = new Set();
    let last = 0, camTs = 0;
    try { rec.start(); } catch (e) { reject(e); return; }
    if (audio && wantMusic) audio.startMusic();

    const frame = (now) => {
      // Ease the camera toward the ball every frame (including scene holds), so it
      // glides and stays a beat behind the play (~0.4s time constant).
      if (ig) {
        const cdt = camTs ? now - camTs : 0; camTs = now;
        let target = ballAt(clock).x;
        if (target < camHalf) target = camHalf; else if (target > 100 - camHalf) target = 100 - camHalf;
        camX += (target - camX) * (1 - Math.exp(-cdt / camTau));
      }
      if (!last) last = now;
      if (now < holdUntil) {
        draw(clock, celeb, (now - celebStart) / Math.max(1, holdUntil - celebStart));
        last = now; requestAnimationFrame(frame); return;
      }
      if (celeb) { celeb = null; last = now; }
      const dt = now - last; last = now;
      const next = Math.min(maxMin, clock + (dt / durationMs) * maxMin);
      let hit = null;
      for (let i = 0; i < events.length; i++) {
        if (celebrated.has(i)) continue;
        const e = events[i];
        if (sceneMs(e) <= 0) continue;
        if (e._m > clock + 1e-9 && e._m <= next + 1e-9 && (!hit || e._m < hit.e._m)) hit = { e, i };
      }
      if (hit) {
        celebrated.add(hit.i); clock = hit.e._m; celeb = hit.e; celebStart = now;
        if (audio && wantSound) audio.playAt(hit.e.kind, audio.ctx.currentTime);
        holdUntil = now + sceneMs(hit.e) * sceneScale;
        draw(clock, celeb, 0); requestAnimationFrame(frame); return;
      }
      clock = next;
      draw(clock, null, 0);
      if (audio) audio.setProgress(clock / maxMin);
      if (opts.onProgress) opts.onProgress(clock / maxMin);
      if (clock >= maxMin) {
        if (!endAt) { endAt = now + 900; if (audio) audio.stopMusic(); } // short tail; fade music out
        if (now >= endAt) { rec.stop(); return; }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
