/*
 * Saved match-replay animation defaults — the owner tunes the animation in the
 * admin lab (app/(admin)/admin/replay) and saves it here as the app-wide default.
 * Both the admin lab (as its starting values) and the public match-replay modal
 * (components/GamesBrowser) read these so a single saved setting drives the whole
 * app. Best-effort, like every KV read: when unset, callers fall back to their
 * hard-coded defaults.
 *
 * Shape: replay:config -> { cfg: { <tunable>: number, … }, display: { … }, updatedAt }
 */

import { kv } from "@/lib/kv";

export const REPLAY_CONFIG_KEY = "replay:config";

// Tunables persisted from the lab's cfg object (numeric only).
export const REPLAY_CONFIG_FIELDS = [
  "gameSpeed", "eventSpeed", "trailLength", "camSpeed", "eventFont",
  "passMin", "blockFollow", "spread", "attackPush", "defendDrop",
  "reactLag", "lateral", "ballFollow", "jitterAmp", "jitterSpeed",
];

// Per-event sound mapping (event-type → preset id). Allowlisted on save.
const SOUND_EVENT_KEYS = ["goal", "yellow", "red", "sub", "shot", "kickoff", "halftime", "fulltime"];
const SOUND_PRESET_IDS = ["none", "roar", "horn", "applause", "whistleShort", "whistleDouble", "whistleLong", "whistleTriple", "chime", "whoosh"];

export async function loadReplayConfig() {
  const raw = await kv(["GET", REPLAY_CONFIG_KEY]);
  if (!raw) return null;
  try { return JSON.parse(raw) || null; } catch (e) { return null; }
}

export async function saveReplayConfig(data) {
  await kv(["SET", REPLAY_CONFIG_KEY, JSON.stringify(data || {})]);
}

// Keep only known numeric tunables + the display booleans, so a saved blob can't
// inject arbitrary keys into the animation config.
export function sanitizeReplayConfig(body) {
  const cfgIn = (body && typeof body.cfg === "object" && body.cfg) || {};
  const cfg = {};
  REPLAY_CONFIG_FIELDS.forEach((k) => {
    const v = cfgIn[k];
    if (typeof v === "number" && isFinite(v)) cfg[k] = v;
  });
  const d = (body && body.display) || {};
  const display = {
    showNumbers: !!d.showNumbers,
    showMarkers: !!d.showMarkers,
    showTrail: !!d.showTrail,
    showBallShadow: !!d.showBallShadow,
  };
  const esIn = (body && body.eventSounds) || {};
  const eventSounds = {};
  SOUND_EVENT_KEYS.forEach((k) => {
    if (SOUND_PRESET_IDS.indexOf(esIn[k]) >= 0) eventSounds[k] = esIn[k];
  });
  const a = (body && body.audio) || {};
  const audio = { sound: !!a.sound, music: !!a.music };
  return { cfg, display, eventSounds, audio };
}
