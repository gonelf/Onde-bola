/*
 * lib/buffer-post — schedule a single update on Buffer (buffer.com) via its
 * classic publish API, plus a small persisted log of what was scheduled. Used by
 * /api/cron-buffer (the daily automation) and /api/buffer (the admin management
 * + log page).
 *
 * The post pairs the square card (/image/<date>/square, which Buffer fetches
 * itself from the URL) with the matching caption (/image/<date>/text).
 *
 * Auth + targets come from the environment, so no secrets live in the repo:
 *   BUFFER_ACCESS_TOKEN   a Buffer access token
 *   BUFFER_PROFILE_IDS    comma-separated Buffer profile ids to post to
 *
 * Every schedule attempt (cron or manual) is appended to a capped KV log so the
 * admin page can show a history without standing up a database.
 */

import { kv } from "@/lib/kv";

const BUFFER_API = "https://api.bufferapp.com/1/updates/create.json";

// Capped, newest-first log of schedule attempts (KV is best-effort: when it
// isn't configured the log simply stays empty and scheduling still works).
const LOG_KEY = "buffer:log";
const LOG_MAX = 50;

export function bufferConfigured() {
  return Boolean(process.env.BUFFER_ACCESS_TOKEN) && profileIds().length > 0;
}

function profileIds() {
  return String(process.env.BUFFER_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Non-secret view of the Buffer config for the admin page — never exposes the
// access token, only whether it's set and which profile ids are targeted.
export function bufferConfig() {
  const ids = profileIds();
  return {
    configured: bufferConfigured(),
    tokenSet: Boolean(process.env.BUFFER_ACCESS_TOKEN),
    profileCount: ids.length,
    profileIds: ids,
  };
}

// Tomorrow (UTC) as YYYY-MM-DD — the default day a scheduled post is about and
// goes out (the schedule itself is in UTC).
export function tomorrowYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function safeJson(s) {
  try { return JSON.parse(s); } catch (e) { return s; }
}

/**
 * Schedule an update on Buffer. Returns { ok, status, body }.
 *   text        the post caption
 *   photo       a public image URL Buffer attaches (and fetches itself)
 *   scheduledAt ISO-8601 / unix timestamp for when Buffer should publish it
 */
export async function scheduleBufferUpdate({ text, photo, scheduledAt }) {
  const token = process.env.BUFFER_ACCESS_TOKEN || "";
  const ids = profileIds();
  if (!token || !ids.length) {
    return { ok: false, status: 0, body: "Buffer not configured (BUFFER_ACCESS_TOKEN / BUFFER_PROFILE_IDS)" };
  }

  const form = new URLSearchParams();
  form.set("text", text || "");
  ids.forEach((id) => form.append("profile_ids[]", id));
  if (photo) {
    form.set("media[photo]", photo);
    form.set("media[thumbnail]", photo);
  }
  // Queue it for the given time rather than posting immediately.
  if (scheduledAt) form.set("scheduled_at", scheduledAt);
  form.set("now", "false");

  const r = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, body };
}

// ---- Schedule log --------------------------------------------------------

export async function readBufferLog() {
  const raw = await kv(["GET", LOG_KEY]);
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

export async function appendBufferLog(entry) {
  const log = await readBufferLog();
  log.unshift(entry);
  const trimmed = log.slice(0, LOG_MAX);
  await kv(["SET", LOG_KEY, JSON.stringify(trimmed)]);
  return trimmed;
}

export async function clearBufferLog() {
  await kv(["DEL", LOG_KEY]);
  return [];
}

// Pull the Buffer update id out of the create response, tolerating the couple of
// shapes the classic API returns ({updates:[{id}]} or a bare {id}).
function bufferUpdateId(buf) {
  if (!buf || typeof buf !== "object") return null;
  if (Array.isArray(buf.updates) && buf.updates[0] && buf.updates[0].id) return buf.updates[0].id;
  return buf.id || null;
}

/**
 * Build and schedule the day's "games of the day" post, then append the outcome
 * to the log. Shared by the cron and the admin endpoint.
 *   origin   request origin, to reach the public image/text endpoints
 *   date     YYYY-MM-DD the post is about (also when it publishes)
 *   trigger  "cron" | "manual" — recorded in the log
 * Returns the log entry (with `ok`).
 */
export async function scheduleDayPost({ origin, date, trigger }) {
  const imageUrl = `${origin}/image/${date}/square`;
  const textUrl = `${origin}/image/${date}/text`;
  // Publish at 09:00 UTC on the day the card is about.
  const scheduledAt = `${date}T09:00:00Z`;
  const at = new Date().toISOString();
  const src = trigger === "cron" ? "cron" : "manual";

  // Pull the caption from the text endpoint (the same words /image shows). Buffer
  // fetches the square image itself, so we only need to hand it the URL.
  let text = "";
  try {
    const r = await fetch(textUrl, { headers: { Accept: "text/plain" } });
    if (r.ok) text = (await r.text()).trim();
  } catch (e) { /* handled below */ }

  if (!text) {
    const entry = { at, trigger: src, date, scheduledAt, imageUrl, textUrl, ok: false, status: 0, message: "could not build post text" };
    await appendBufferLog(entry);
    return entry;
  }

  const res = await scheduleBufferUpdate({ text, photo: imageUrl, scheduledAt });
  const buf = safeJson(res.body);
  const message = buf && typeof buf === "object"
    ? (buf.message || buf.error || (res.ok ? "scheduled" : "failed"))
    : String(buf).slice(0, 300);

  const entry = {
    at,
    trigger: src,
    date,
    scheduledAt,
    imageUrl,
    textUrl,
    ok: res.ok,
    status: res.status,
    bufferId: bufferUpdateId(buf),
    message,
    textPreview: text.slice(0, 280),
  };
  await appendBufferLog(entry);
  return entry;
}
