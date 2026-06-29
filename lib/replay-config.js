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
import { db } from "@/lib/db/client";
import { replayConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { isMigrated, markMigrated } from "@/lib/config-migrate";

export const REPLAY_CONFIG_KEY = "replay:config";

// Tunables persisted from the lab's cfg object (numeric only).
export const REPLAY_CONFIG_FIELDS = [
  "gameSpeed", "eventSpeed", "trailLength", "camSpeed", "eventFont",
  "passMin", "blockFollow", "spread", "attackPush", "defendDrop",
  "reactLag", "lateral", "ballFollow", "jitterAmp", "jitterSpeed",
];

// Per-event sound mapping (event-type → preset id). Allowlisted on save.
const SOUND_EVENT_KEYS = ["goal", "save", "miss", "yellow", "red", "sub", "kickoff", "halftime", "fulltime"];
const SOUND_PRESET_IDS = ["none", "roar", "cheer", "boo", "horn", "vuvuzela", "applause", "whistleShort", "whistleDouble", "whistleLong", "whistleTriple", "bell", "buzzer", "chime", "pop", "riser", "ballKick", "whoosh"];

// --- Backed by Postgres (replay_config, single row id=1), falling back to KV ---
// when the DB is unset/unreachable. First DB read backfills the existing KV value
// once; see lib/config-migrate.

async function loadReplayKV() {
  const raw = await kv(["GET", REPLAY_CONFIG_KEY]);
  if (!raw) return null;
  try { return JSON.parse(raw) || null; } catch (e) { return null; }
}

async function readReplayDB() {
  const rows = await db.select().from(replayConfig).where(eq(replayConfig.id, 1)).limit(1);
  const r = rows && rows[0];
  if (!r) return null;
  return { cfg: r.cfg || {}, display: r.display || {}, eventSounds: r.eventSounds || {}, audio: r.audio || {} };
}

async function writeReplayDB(data) {
  const d = data || {};
  const set = { cfg: d.cfg || {}, display: d.display || {}, eventSounds: d.eventSounds || {}, audio: d.audio || {} };
  await db.insert(replayConfig).values({ id: 1, ...set }).onConflictDoUpdate({ target: replayConfig.id, set });
}

export async function loadReplayConfig() {
  if (!db) return loadReplayKV();
  try {
    if (!(await isMigrated(REPLAY_CONFIG_KEY))) {
      const kvData = await loadReplayKV();
      if (kvData) await writeReplayDB(kvData);
      await markMigrated(REPLAY_CONFIG_KEY);
    }
    return await readReplayDB();
  } catch (e) {
    return loadReplayKV();
  }
}

export async function saveReplayConfig(data) {
  if (!db) { await kv(["SET", REPLAY_CONFIG_KEY, JSON.stringify(data || {})]); return; }
  try {
    await writeReplayDB(data);
    await markMigrated(REPLAY_CONFIG_KEY);
  } catch (e) {
    await kv(["SET", REPLAY_CONFIG_KEY, JSON.stringify(data || {})]);
  }
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
