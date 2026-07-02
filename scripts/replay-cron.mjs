/*
 * scripts/replay-cron — record yesterday's top finished game as the animated
 * match replay and schedule it on Buffer (Facebook + Instagram). Third sibling
 * of the daily image post and the games-of-the-day reel (scripts/reel-cron.mjs).
 *
 * The animation and its video export already exist in the admin lab
 * (/admin/replay + components/admin/recordReplay.js — canvas + MediaRecorder,
 * IG-story 9:16 layout with branded header and follow camera). Rather than
 * reimplement that renderer, this script drives the page's ?autorecord mode in
 * headless Chromium (Playwright) on the GitHub Actions runner
 * (.github/workflows/replay-cron.yml):
 *
 *   1. pick yesterday's top finished game from /api/fixtures (same digest
 *      ranking as the cards — lib/digest-select);
 *   2. load /admin/replay?autorecord=story&date=…&fmid=… (Basic-Auth from the
 *      environment) and capture the video download it triggers;
 *   3. convert to H.264 MP4 with ffmpeg when Chromium recorded WebM (its
 *      open-source build has no H.264 encoder), and grab a cover frame;
 *   4. upload both to Vercel Blob and call /api/cron-buffer-replay, which
 *      builds the one-game caption and schedules the post for 10:00 UTC the
 *      morning after the match.
 *
 * Run with tsx (npx tsx scripts/replay-cron.mjs).
 *
 * Environment:
 *   SITE_URL                e.g. https://hojehabola.com (default; no trailing /)
 *   ADMIN_USER / ADMIN_PASSWORD  Basic-Auth for /admin/replay (when gated)
 *   CRON_SECRET             forwarded as Bearer auth to /api/cron-buffer-replay
 *   BLOB_READ_WRITE_TOKEN   Vercel Blob store token (public store)
 *   BROWSER_EXECUTABLE      optional Chromium path (else Playwright's own)
 *   FFMPEG_PATH             optional ffmpeg binary (default: `npx remotion
 *                           ffmpeg`, the full build Remotion already ships —
 *                           no system ffmpeg needed)
 *
 * Flags (all optional, mostly for local testing):
 *   --date=YYYY-MM-DD  the day the match was played (default: yesterday, Lisbon)
 *   --fmid=<id>        record this specific game instead of the top-ranked one
 *   --scenario=<key>   record a built-in lab scenario (no feeds; implies
 *                      --skip-schedule since there's no real game to caption)
 *   --out=out/replay   output directory
 *   --skip-upload      record locally but don't upload or schedule
 *   --skip-schedule    upload but don't schedule the Buffer post
 */

import { mkdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

// See scripts/reel-cron.mjs for why the lib/ imports go through require().
const require = createRequire(import.meta.url);
const { selectTop } = require("../lib/digest-select.js");

const TZ = "Europe/Lisbon";

// ---- config ---------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] == null ? true : m[2]] : [a, true];
  })
);

const SITE_URL = String(process.env.SITE_URL || "https://hojehabola.com").replace(/\/+$/, "");

function yesterdayYmdLisbon() {
  const d = new Date(Date.now() - 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/.test(args.date || "") ? args.date : yesterdayYmdLisbon();
const OUT_DIR = path.resolve(String(args.out || "out/replay"));
const SCENARIO = typeof args.scenario === "string" ? args.scenario : "";
// Remotion (already a dependency, for the daily reel) ships a full ffmpeg —
// libx264 + aac — behind `npx remotion ffmpeg`, so nothing on the PATH is
// assumed. FFMPEG_PATH overrides with a plain binary.
const FFMPEG_CMD = process.env.FFMPEG_PATH
  ? [process.env.FFMPEG_PATH]
  : ["npx", "remotion", "ffmpeg"];

// ---- helpers ----------------------------------------------------------------

async function getJson(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

// Yesterday's finished games, ranked like every digest surface; [0] is the pick.
async function pickGame() {
  if (args.fmid) return { fmid: String(args.fmid) };
  const fx = await getJson(`${SITE_URL}/api/fixtures?date=${DATE}&all=1`);
  const finished = ((fx && fx.fixtures) || []).filter((f) => f.status === "FT" && f.fmid);
  const top = selectTop(finished, 1);
  if (!top.length) return null;
  const g = top[0];
  console.log(`top finished game: ${g.home} ${g.homeScore}-${g.awayScore} ${g.away} (${g.competition || "?"})`);
  return { fmid: String(g.fmid) };
}

// ---- record (headless Chromium driving /admin/replay?autorecord) -----------

async function record(fmid) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE || undefined,
    // The recorder muxes WebAudio SFX/music into the capture; without this the
    // AudioContext would start suspended (no user gesture in headless).
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({
      httpCredentials: process.env.ADMIN_USER
        ? { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD || "" }
        : undefined,
    });
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error") console.log("page error:", m.text()); });

    const q = SCENARIO
      ? `autorecord=story&scenario=${encodeURIComponent(SCENARIO)}`
      : `autorecord=story&date=${DATE}&fmid=${encodeURIComponent(fmid)}`;
    await page.goto(`${SITE_URL}/admin/replay?${q}`, { waitUntil: "domcontentloaded", timeout: 60000 });

    // The recording runs in real time (a minute or so with event scenes); the
    // page reports failures on window.__autoRecord, the success signal is the
    // download the recorder triggers when it stops.
    const failed = page
      .waitForFunction(() => window.__autoRecord && window.__autoRecord.status === "error", null, { timeout: 6 * 60000 })
      .then(async (h) => { throw new Error("auto-record failed: " + (await h.evaluate((v) => v.error))); });
    const download = await Promise.race([
      page.waitForEvent("download", { timeout: 6 * 60000 }),
      failed,
    ]);

    const name = download.suggestedFilename() || "match-replay-story.webm";
    const raw = path.join(OUT_DIR, name);
    await download.saveAs(raw);
    console.log(`recorded: ${raw}`);
    return raw;
  } finally {
    await browser.close();
  }
}

// ---- convert + thumbnail -----------------------------------------------------

// Instagram/Facebook want H.264 MP4; headless Chromium records WebM (VP8/VP9).
// Re-encode when needed and always pull a cover frame a few seconds in.
async function toMp4AndCover(raw) {
  const mp4 = path.join(OUT_DIR, `replay-${DATE}.mp4`);
  const jpg = path.join(OUT_DIR, `cover-${DATE}.jpg`);
  const ffmpeg = (argv) => run(FFMPEG_CMD[0], FFMPEG_CMD.slice(1).concat(argv));
  if (raw.endsWith(".mp4")) {
    await ffmpeg(["-y", "-i", raw, "-c", "copy", "-movflags", "+faststart", mp4]);
  } else {
    await ffmpeg([
      "-y", "-i", raw,
      "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      mp4,
    ]);
  }
  await ffmpeg(["-y", "-ss", "3", "-i", mp4, "-frames:v", "1", "-update", "1", "-q:v", "3", jpg]);
  return { mp4, jpg };
}

// ---- upload + schedule --------------------------------------------------------

async function upload(mp4, jpg) {
  const { put } = await import("@vercel/blob");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const opts = (contentType) => ({
    access: "public", contentType, token,
    addRandomSuffix: false, allowOverwrite: true,
  });
  try {
    const video = await put(`replays/${DATE}.mp4`, await readFile(mp4), opts("video/mp4"));
    const cover = await put(`replays/${DATE}-cover.jpg`, await readFile(jpg), opts("image/jpeg"));
    return { videoUrl: video.url, thumbUrl: cover.url };
  } catch (e) {
    if (/private store|private access/i.test(String((e && e.message) || e))) {
      throw new Error(
        "The Vercel Blob store is PRIVATE, but Buffer needs a public URL to fetch the video. " +
        "Use a Blob store with public access and set BLOB_READ_WRITE_TOKEN to its token."
      );
    }
    throw e;
  }
}

async function schedule(fmid, videoUrl, thumbUrl) {
  const u = new URL(`${SITE_URL}/api/cron-buffer-replay`);
  u.searchParams.set("date", DATE);
  u.searchParams.set("fmid", fmid);
  u.searchParams.set("video", videoUrl);
  u.searchParams.set("thumb", thumbUrl);
  const r = await fetch(u, {
    headers: process.env.CRON_SECRET
      ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {},
  });
  const body = await r.text();
  console.log(`schedule → HTTP ${r.status}\n${body}`);
  if (!r.ok) throw new Error(`cron-buffer-replay failed with HTTP ${r.status}`);
}

// ---- main ---------------------------------------------------------------------

async function main() {
  console.log(`replay-cron: date=${DATE} site=${SITE_URL}${SCENARIO ? ` scenario=${SCENARIO}` : ""}`);
  await mkdir(OUT_DIR, { recursive: true });

  let fmid = "";
  if (!SCENARIO) {
    const game = await pickGame();
    if (!game) {
      // No finished marquee game yesterday — skip quietly, like the reel does.
      console.log("no finished games selected for the date — nothing to record, exiting 0");
      return;
    }
    fmid = game.fmid;
  }

  const raw = await record(fmid);
  const { mp4, jpg } = await toMp4AndCover(raw);
  console.log(`converted: ${mp4} + ${jpg}`);
  if (args["skip-upload"]) return;

  const { videoUrl, thumbUrl } = await upload(mp4, jpg);
  console.log(`uploaded: ${videoUrl}`);
  if (args["skip-schedule"] || SCENARIO) return;

  await schedule(fmid, videoUrl, thumbUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
