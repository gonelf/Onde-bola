"use client";

// Webcam hand-gesture navigation for the games browser.
//
// Opt-in only: the camera is OFF until the user taps the gesture button, and
// turning it off (or unmounting) stops every media track — nothing is recorded
// or sent anywhere, all processing happens in the browser. We lean on
// MediaPipe's prebuilt GestureRecognizer (loaded from a CDN at runtime, so it
// never enters the app bundle) which already classifies the canned poses we map
// to navigation, plus a little wrist-velocity tracking for left/right swipes.
//
// Gesture map (mirrored "selfie" view, so moving your hand right moves it right
// on screen):
//   • Open palm swipe right → next day      • Open palm swipe left → previous day
//   • ✌️ Victory            → jump to today  • ✊ Closed fist        → back / close
//
// The component is given plain callbacks by GamesBrowser so it stays decoupled
// from the navigation internals.

import { useCallback, useEffect, useRef, useState } from "react";

// Pinned CDN build so the ESM module, wasm runtime and task model stay in lockstep.
const VISION_VERSION = "0.10.18";
const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}`;
const WASM_URL = `${VISION_URL}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

// Tuning.
const SWIPE_DISTANCE = 0.20; // fraction of frame width the wrist must travel
const SWIPE_WINDOW_MS = 280; // ...within this window to count as a swipe
const COOLDOWN_MS = 900; // min gap between two triggered actions

// Load the tasks-vision ESM module via an injected module script. Doing it this
// way (rather than a bundler-visible dynamic import) keeps the dependency out of
// the build entirely and works the same under webpack and Turbopack. Cached on
// window so a re-enable doesn't refetch.
function loadVision() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.__hhbVision) return Promise.resolve(window.__hhbVision);
  if (window.__hhbVisionPromise) return window.__hhbVisionPromise;
  window.__hhbVisionPromise = new Promise((resolve, reject) => {
    const ready = () => resolve(window.__hhbVision);
    window.addEventListener("hhb-vision-ready", ready, { once: true });
    const s = document.createElement("script");
    s.type = "module";
    s.textContent =
      `import * as v from "${VISION_URL}";` +
      `window.__hhbVision = v;` +
      `window.dispatchEvent(new Event("hhb-vision-ready"));`;
    s.onerror = () => reject(new Error("Failed to load gesture model"));
    document.head.appendChild(s);
  });
  return window.__hhbVisionPromise;
}

const CameraIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2" />
    <path d="M9 8V6a3 3 0 0 1 6 0" opacity="0" />
    <path d="M12 11a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
    {off ? <line x1="3" y1="3" x2="21" y2="21" /> : null}
  </svg>
);

export default function HandGestures({ t, onPrev, onNext, onToday, onBack }) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(""); // label of last triggered action
  const [hand, setHand] = useState(""); // current detected gesture name (for the hint)

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognizerRef = useRef(null);
  const rafRef = useRef(0);
  const flashTimer = useRef(0);

  // Detector working state, kept in refs so the rAF loop never restarts.
  const lastTs = useRef(0);
  const cooldownUntil = useRef(0);
  const armed = useRef(true); // re-armed when the hand leaves / relaxes
  const samples = useRef([]); // recent { t, x } wrist positions for swipe detection

  // Latest callbacks, so the loop closure stays stable across parent re-renders.
  const cbRef = useRef({});
  cbRef.current = { onPrev, onNext, onToday, onBack };

  const fire = useCallback((label, fn) => {
    cooldownUntil.current = performance.now() + COOLDOWN_MS;
    armed.current = false;
    samples.current = [];
    if (typeof fn === "function") fn();
    setFlash(label);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 1100);
  }, []);

  // Inspect one frame's recognition result and trigger at most one action.
  const handleResult = useCallback((res, now) => {
    const cats = res.gestures && res.gestures[0];
    const marks = res.landmarks && res.landmarks[0];
    const name = (cats && cats[0] && cats[0].categoryName) || "None";

    if (!marks || name === "None") {
      // No hand (or an unrecognised pose): drop tracking and re-arm.
      samples.current = [];
      armed.current = true;
      if (hand) setHand("");
      return;
    }
    if (name !== hand) setHand(name);

    if (now < cooldownUntil.current) return;

    const cb = cbRef.current;

    // Discrete poses fire once per "show" (hand must relax/leave to re-arm).
    if (name === "Victory") {
      if (armed.current) fire(t("gestToday"), cb.onToday);
      return;
    }
    if (name === "Closed_Fist") {
      if (armed.current) fire(t("gestBack"), cb.onBack);
      return;
    }

    // Open palm → track the wrist (landmark 0) for a horizontal swipe. The video
    // is mirrored for display, so mirror x too (1 - x) to match what the user sees.
    if (name === "Open_Palm" || name === "Pointing_Up") {
      const x = 1 - marks[0].x;
      const buf = samples.current;
      buf.push({ t: now, x });
      while (buf.length && now - buf[0].t > SWIPE_WINDOW_MS) buf.shift();
      if (buf.length >= 2) {
        const dx = x - buf[0].x;
        if (dx >= SWIPE_DISTANCE) fire(t("gestNext"), cb.onNext);
        else if (dx <= -SWIPE_DISTANCE) fire(t("gestPrev"), cb.onPrev);
      }
      return;
    }

    // Any other recognised pose just re-arms the discrete triggers.
    samples.current = [];
    armed.current = true;
  }, [fire, hand, t]);

  // The rAF loop is started once per enable; route frame handling through a ref
  // so it always calls the latest handleResult (which changes as `hand`/`t` do).
  const handlerRef = useRef(handleResult);
  handlerRef.current = handleResult;

  // Start: permission → camera → model → detection loop.
  const start = useCallback(async () => {
    setPhase("loading");
    setError("");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 }, audio: false,
      });
    } catch (e) {
      // Keep `enabled` true so the panel stays open and shows why it failed;
      // the button's inactive look comes from phase === "error".
      setPhase("error");
      setError(t("gestNoCam"));
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    try { await video.play(); } catch (e) {}

    let recognizer = recognizerRef.current;
    if (!recognizer) {
      try {
        const vision = await loadVision();
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        const make = (delegate) => vision.GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "VIDEO", numHands: 1,
        });
        recognizer = await make("GPU").catch(() => make("CPU"));
        recognizerRef.current = recognizer;
      } catch (e) {
        setPhase("error");
        setError(t("gestNoModel"));
        return;
      }
    }

    setPhase("ready");
    armed.current = true;
    samples.current = [];
    lastTs.current = 0;

    const loop = () => {
      const v = videoRef.current;
      const r = recognizerRef.current;
      if (!v || !r || !streamRef.current) return;
      if (v.readyState >= 2) {
        let now = performance.now();
        if (now <= lastTs.current) now = lastTs.current + 1; // must be strictly increasing
        lastTs.current = now;
        try {
          handlerRef.current(r.recognizeForVideo(v, now), now);
        } catch (e) { /* transient decode error — skip frame */ }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [t]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setHand("");
    setFlash("");
  }, []);

  useEffect(() => {
    if (enabled) start();
    else { stop(); if (phase !== "error") setPhase("idle"); }
    return () => { if (enabled) stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Final cleanup: release the recognizer and any live camera on unmount.
  useEffect(() => () => {
    stop();
    if (recognizerRef.current && recognizerRef.current.close) {
      try { recognizerRef.current.close(); } catch (e) {}
    }
    clearTimeout(flashTimer.current);
  }, [stop]);

  const active = enabled && phase !== "error";

  return (
    <div className="gesture-nav">
      <button type="button" className={"gesture-btn" + (active ? " on" : "")}
        aria-pressed={enabled} title={t("gestToggle")} aria-label={t("gestToggle")}
        onClick={() => setEnabled((v) => !v)}>
        <CameraIcon off={!active} />
        <span className="gesture-btn-label">{t("gestLabel")}</span>
      </button>

      <div className={"gesture-panel" + (enabled ? " open" : "")} aria-hidden={!enabled}>
        <div className="gesture-cam">
          <video ref={videoRef} muted playsInline className="gesture-video" />
          {phase === "loading" ? <span className="gesture-state">{t("gestLoading")}</span> : null}
          {phase === "error" ? <span className="gesture-state err">{error}</span> : null}
          {flash ? <span className="gesture-flash" key={flash}>{flash}</span> : null}
        </div>
        <ul className="gesture-legend">
          <li><span className="g-emoji">🖐️</span>{t("gestHintSwipe")}</li>
          <li><span className="g-emoji">✌️</span>{t("gestToday")}</li>
          <li><span className="g-emoji">✊</span>{t("gestBack")}</li>
        </ul>
        <p className="gesture-priv">{t("gestPrivacy")}</p>
      </div>
    </div>
  );
}
