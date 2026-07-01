/*
 * scripts/reel-cron — render the day's "games of the day" reel and schedule it
 * on Buffer (Facebook + Instagram). The video sibling of /api/cron-buffer: the
 * image post is rendered on-demand at the edge, but a video takes minutes, so
 * this runs on a GitHub Actions runner (.github/workflows/reel-cron.yml) which
 * acts as the render backend:
 *
 *   1. fetch the day's feeds from the live site (/api/fixtures, /api/listings,
 *      /api/fmtv) and build display-ready props with the SAME selection
 *      (lib/digest-select) and channel pick (lib/digest-text) as the image card
 *      and caption — crests inlined as data URIs;
 *   2. render remotion/DailyReel to an mp4 (plus a cover still) with Remotion;
 *   3. upload both to Vercel Blob (public URLs Buffer can fetch);
 *   4. call /api/cron-buffer-reel on the site, which builds the caption
 *      in-process and schedules the reel on the account's Facebook + Instagram
 *      channels for 09:00 UTC (logged to buffer_log like the image post).
 *
 * Run with tsx (npx tsx scripts/reel-cron.mjs) — the lib/ modules use
 * extensionless ESM imports that plain `node` won't resolve.
 *
 * Environment:
 *   SITE_URL                e.g. https://hojehabola.com (default; no trailing /)
 *   CRON_SECRET             forwarded as Bearer auth to /api/cron-buffer-reel
 *   BLOB_READ_WRITE_TOKEN   Vercel Blob store token (for the uploads)
 *   BROWSER_EXECUTABLE      optional Chromium path for Remotion (else it
 *                           downloads its own headless shell)
 *
 * Flags (all optional, mostly for local testing):
 *   --date=YYYY-MM-DD  the day the reel is about (default: tomorrow, UTC —
 *                      matching the image cron, which schedules a day ahead)
 *   --n=8              how many games (clamped 1..10)
 *   --out=out/reel     output directory
 *   --props-only       build props.json and stop (no render/upload/schedule)
 *   --skip-upload      render locally but don't upload or schedule
 *   --skip-schedule    upload but don't schedule the Buffer post
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

// The lib/ modules are written as ESM but live in a CJS package (no
// "type": "module"), so static `import` bindings don't resolve under tsx —
// require() goes through tsx's transform hook and works for both.
const require = createRequire(import.meta.url);
const { selectTop, phase } = require("../lib/digest-select.js");
const { ptChannelFor } = require("../lib/digest-text.js");
const { isPaidChannel } = require("../lib/broadcasters.js");
const { brandForOrigin, brandWordmark } = require("../lib/brand.js");

const TZ = "Europe/Lisbon";

// ---- config ---------------------------------------------------------------

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] == null ? true : m[2]] : [a, true];
  })
);

const SITE_URL = String(process.env.SITE_URL || "https://hojehabola.com").replace(/\/+$/, "");

function tomorrowYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function todayYmdLisbon() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const DATE = /^\d{4}-\d{2}-\d{2}$/.test(args.date || "") ? args.date : tomorrowYmd();
const N = Math.max(1, Math.min(10, parseInt(args.n || "8", 10) || 8));
const OUT_DIR = path.resolve(String(args.out || "out/reel"));

// ---- feed fetch + props ----------------------------------------------------

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

// FotMob's image CDN 403s plain/datacenter requests, so present as a browser —
// same trick as the OG renderer.
const IMG_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.fotmob.com/",
};

async function toDataUri(url) {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    const r = await fetch(url, { headers: IMG_HEADERS });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch (e) {
    return "";
  }
}

// Kickoff in Lisbon as HH:MM — same as the story card's rail time.
function fmtKick(iso) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch (e) {
    return "";
  }
}

function fmtDateLabel(ymd, lang) {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pt-PT", {
      timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric",
    }).format(new Date(ymd + "T12:00:00Z"));
  } catch (e) {
    return ymd;
  }
}

const COPY = {
  pt: { today: "Jogos de hoje!", day: "Jogos do dia!", footer: "Vê todos os jogos e onde ver na TV" },
  en: { today: "Today's games!", day: "The day's games!", footer: "See every game and where to watch on TV" },
};

async function buildProps() {
  const [fx, listings, fmtv] = await Promise.all([
    getJson(`${SITE_URL}/api/fixtures?date=${DATE}&all=1`),
    getJson(`${SITE_URL}/api/listings?date=${DATE}`),
    getJson(`${SITE_URL}/api/fmtv?date=${DATE}`),
  ]);
  const top = selectTop(fx && fx.fixtures, N);
  if (!top.length) return null;

  const rich = (listings && listings.matches) || {};
  const games = await Promise.all(
    top.map(async (f) => {
      const [homeBadge, awayBadge] = await Promise.all([
        toDataUri(f.homeBadge), toDataUri(f.awayBadge),
      ]);
      const ph = phase(f);
      const state = ph === 0 ? "live" : ph === 1 ? "scheduled" : "finished";
      const status = String(f.status || "").toUpperCase();
      const time = state === "scheduled"
        ? fmtKick(f.kickoff)
        : state === "live" ? (/^\d+$/.test(status) ? `${status}'` : status) : "";
      const channel = ptChannelFor(f, fmtv, f.fmid != null ? rich[String(f.fmid)] : null);
      return {
        home: f.home, away: f.away, homeBadge, awayBadge,
        competition: f.competition || "",
        state, time,
        homeScore: f.homeScore == null ? "" : String(f.homeScore),
        awayScore: f.awayScore == null ? "" : String(f.awayScore),
        channel, channelPaid: channel ? isPaidChannel(channel) : false,
      };
    })
  );

  const brand = brandForOrigin(SITE_URL);
  const lang = brand.lang || "pt";
  const c = COPY[lang] || COPY.pt;
  const wm = brandWordmark(brand);
  return {
    brand: { head: wm.head, tail: wm.tail, domain: brand.domain },
    title: DATE === todayYmdLisbon() ? c.today : c.day,
    dateLabel: fmtDateLabel(DATE, lang),
    footer: c.footer,
    games,
  };
}

// ---- render ----------------------------------------------------------------

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: "inherit" });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${argv[0]} exited ${code}`))
    );
  });
}

// Keep in sync with remotion/DailyReel.jsx (INTRO_FRAMES / ROW_STAGGER): the
// cover frame is just after the last row has landed, so it shows the full list.
function coverFrame(nGames) {
  return 40 + nGames * 10 + 40;
}

async function render(propsFile, nGames) {
  const browser = process.env.BROWSER_EXECUTABLE
    ? ["--browser-executable", process.env.BROWSER_EXECUTABLE]
    : [];
  const entry = "remotion/index.js";
  const mp4 = path.join(OUT_DIR, `reel-${DATE}.mp4`);
  const jpg = path.join(OUT_DIR, `cover-${DATE}.jpg`);
  await run("npx", [
    "remotion", "render", entry, "DailyReel", mp4,
    `--props=${propsFile}`, "--codec=h264", "--overwrite", ...browser,
  ]);
  await run("npx", [
    "remotion", "still", entry, "DailyReel", jpg,
    `--props=${propsFile}`, `--frame=${coverFrame(nGames)}`, "--overwrite", ...browser,
  ]);
  return { mp4, jpg };
}

// ---- upload + schedule ------------------------------------------------------

async function upload(mp4, jpg) {
  const { put } = await import("@vercel/blob");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  const video = await put(`reels/${DATE}.mp4`, await readFile(mp4), {
    access: "public", contentType: "video/mp4", token,
    addRandomSuffix: false, allowOverwrite: true,
  });
  const cover = await put(`reels/${DATE}-cover.jpg`, await readFile(jpg), {
    access: "public", contentType: "image/jpeg", token,
    addRandomSuffix: false, allowOverwrite: true,
  });
  return { videoUrl: video.url, thumbUrl: cover.url };
}

async function schedule(videoUrl, thumbUrl) {
  const u = new URL(`${SITE_URL}/api/cron-buffer-reel`);
  u.searchParams.set("date", DATE);
  u.searchParams.set("video", videoUrl);
  u.searchParams.set("thumb", thumbUrl);
  const r = await fetch(u, {
    headers: process.env.CRON_SECRET
      ? { Authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {},
  });
  const body = await r.text();
  console.log(`schedule → HTTP ${r.status}\n${body}`);
  if (!r.ok) throw new Error(`cron-buffer-reel failed with HTTP ${r.status}`);
}

// ---- main -------------------------------------------------------------------

async function main() {
  console.log(`reel-cron: date=${DATE} n=${N} site=${SITE_URL}`);
  await mkdir(OUT_DIR, { recursive: true });

  const props = await buildProps();
  if (!props) {
    // No marquee games that day — skip quietly rather than post an empty reel.
    console.log("no games selected for the date — nothing to render, exiting 0");
    return;
  }
  const propsFile = path.join(OUT_DIR, `props-${DATE}.json`);
  await writeFile(propsFile, JSON.stringify(props));
  console.log(`props: ${props.games.length} games → ${propsFile}`);
  if (args["props-only"]) return;

  const { mp4, jpg } = await render(propsFile, props.games.length);
  console.log(`rendered: ${mp4} + ${jpg}`);
  if (args["skip-upload"]) return;

  const { videoUrl, thumbUrl } = await upload(mp4, jpg);
  console.log(`uploaded: ${videoUrl}`);
  if (args["skip-schedule"]) return;

  await schedule(videoUrl, thumbUrl);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
