/*
 * lib/buffer-post — schedule the day's post on Buffer (buffer.com) via its
 * GraphQL API, plus a small persisted log of what was scheduled. Used by
 * /api/cron-buffer (the daily automation) and /api/buffer (the admin management
 * + log page).
 *
 * The post pairs the square card (/image/<date>/square, which Buffer fetches
 * itself from the imageUrl) with the matching caption (/image/<date>/text).
 *
 * Buffer replaced its classic REST publish API (api.bufferapp.com/1/updates)
 * with a GraphQL API at https://api.buffer.com. We schedule an auto-publishing
 * post per channel via the `createPost` mutation (schedulingType: automatic,
 * mode: customScheduled, with a dueAt timestamp), attaching the card by imageUrl.
 *
 * Auth + targets come from the environment, so no secrets live in the repo:
 *   BUFFER_ACCESS_TOKEN   a Buffer personal API key (sent as `Bearer <key>`)
 *   BUFFER_CHANNEL_IDS    comma-separated Buffer channel ids to post to
 *                         (legacy BUFFER_PROFILE_IDS is still read as a fallback)
 *   BUFFER_API_URL        optional override for the GraphQL endpoint
 *
 * Every schedule attempt (cron or manual) is appended to a capped KV log so the
 * admin page can show a history without standing up a database.
 */

import { kv } from "@/lib/kv";

const BUFFER_API = process.env.BUFFER_API_URL || "https://api.buffer.com";

// Capped, newest-first log of schedule attempts (KV is best-effort: when it
// isn't configured the log simply stays empty and scheduling still works).
const LOG_KEY = "buffer:log";
const LOG_MAX = 50;

export function bufferConfigured() {
  return Boolean(process.env.BUFFER_ACCESS_TOKEN) && channelIds().length > 0;
}

function channelIds() {
  return String(process.env.BUFFER_CHANNEL_IDS || process.env.BUFFER_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Non-secret view of the Buffer config for the admin page — never exposes the
// API key, only whether it's set and which channel ids are targeted.
export function bufferConfig() {
  const ids = channelIds();
  return {
    configured: bufferConfigured(),
    tokenSet: Boolean(process.env.BUFFER_ACCESS_TOKEN),
    channelCount: ids.length,
    channelIds: ids,
    endpoint: BUFFER_API,
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

// One GraphQL request to Buffer. Returns { ok, status, json, text }.
async function bufferGraphQL(query, token) {
  const key = token || process.env.BUFFER_ACCESS_TOKEN || "";
  const r = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: safeJson(text), text };
}

// A GraphQL string literal for a value (double-quoted, escaped). JSON string
// syntax is a valid subset of GraphQL's for our content — newlines become \n and
// emoji pass through as UTF-8 — so JSON.stringify produces a safe literal.
function gqlStr(v) {
  return JSON.stringify(String(v == null ? "" : v));
}

// Top-level GraphQL `errors` collapsed to a single message, or "".
function gqlErrors(json) {
  if (json && typeof json === "object" && Array.isArray(json.errors) && json.errors.length) {
    return json.errors.map((e) => (e && e.message) || "error").join("; ");
  }
  return "";
}

// Schedule one auto-publishing post on a channel via the createPost mutation
// (schedulingType: automatic, mode: customScheduled, with a dueAt timestamp). The
// card is attached by imageUrl, which Buffer fetches itself. Returns
// { channelId, ok, status, postId, message }.
async function createScheduledPost({ token, channelId, text, imageUrl, dueAt }) {
  const mutation = `mutation {
  createPost(input: {
    channelId: ${gqlStr(channelId)}
    text: ${gqlStr(text)}
    schedulingType: automatic
    mode: customScheduled
    dueAt: ${gqlStr(dueAt)}${imageUrl ? `
    imageUrl: ${gqlStr(imageUrl)}` : ""}
  }) {
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}`;
  const { ok: httpOk, status, json, text: bodyText } = await bufferGraphQL(mutation, token);
  const errs = gqlErrors(json);
  const res = json && json.data ? json.data.createPost : null;
  const post = res && res.post;
  const ok = httpOk && !errs && !!(post && post.id);
  const message = errs || (res && res.message) ||
    (ok ? "scheduled" : (typeof bodyText === "string" ? bodyText.slice(0, 200) : "failed"));
  return { channelId, ok, status, postId: (post && post.id) || null, message };
}

/**
 * Schedule the post on every configured Buffer channel. Returns
 * { ok, status, results:[{channelId, ok, postId, message}] } — `ok` is true only
 * when every channel succeeded.
 *   text        the post caption
 *   photo       a public image URL Buffer attaches (and fetches itself)
 *   scheduledAt ISO-8601 (UTC) timestamp for when Buffer should publish it
 */
export async function scheduleBufferUpdate({ text, photo, scheduledAt }) {
  const token = process.env.BUFFER_ACCESS_TOKEN || "";
  const ids = channelIds();
  if (!token || !ids.length) {
    return { ok: false, status: 0, results: [], message: "Buffer not configured (BUFFER_ACCESS_TOKEN / BUFFER_CHANNEL_IDS)" };
  }
  const results = [];
  for (const channelId of ids) {
    try {
      results.push(await createScheduledPost({ token, channelId, text, imageUrl: photo, dueAt: scheduledAt }));
    } catch (e) {
      results.push({ channelId, ok: false, status: 0, postId: null, message: String((e && e.message) || e) });
    }
  }
  const ok = results.length > 0 && results.every((r) => r.ok);
  return { ok, status: results[0] ? results[0].status : 0, results };
}

// Discover the account's channels (id, name, service) per organization, so the
// admin page can show which ids to put in BUFFER_CHANNEL_IDS. Best-effort:
// returns { ok, channels, error }.
export async function listBufferChannels() {
  const token = process.env.BUFFER_ACCESS_TOKEN || "";
  if (!token) return { ok: false, channels: [], error: "BUFFER_ACCESS_TOKEN not set" };

  const orgRes = await bufferGraphQL("query { account { organizations { id name } } }", token);
  const orgErr = gqlErrors(orgRes.json);
  if (orgErr || !orgRes.ok) {
    return { ok: false, channels: [], error: orgErr || `HTTP ${orgRes.status}` };
  }
  const account = orgRes.json && orgRes.json.data && orgRes.json.data.account;
  const orgs = (account && account.organizations) || [];

  const channels = [];
  for (const org of orgs) {
    const chRes = await bufferGraphQL(
      `query { channels(input: { organizationId: ${gqlStr(org.id)} }) { id name service } }`,
      token
    );
    const list = (chRes.json && chRes.json.data && chRes.json.data.channels) || [];
    list.forEach((c) => channels.push({
      id: c && c.id, name: (c && c.name) || "", service: (c && c.service) || "",
      organizationId: org.id, organizationName: org.name || "",
    }));
  }
  return { ok: true, channels, error: "" };
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

// One-line summary of the per-channel results for the log: "ch1: ok (postid) ·
// ch2: <error>". Falls back to the call-level message when there were no results.
function summarizeResults(res) {
  if (res && Array.isArray(res.results) && res.results.length) {
    return res.results
      .map((r) => `${r.channelId}: ${r.ok ? "ok" + (r.postId ? ` (${r.postId})` : "") : (r.message || "failed")}`)
      .join(" · ");
  }
  return (res && res.message) || (res && res.ok ? "scheduled" : "failed");
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
  // Publish at 09:00 UTC on the day the card is about (ISO-8601 UTC, as Buffer's
  // dueAt expects).
  const scheduledAt = `${date}T09:00:00.000Z`;
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

  const entry = {
    at,
    trigger: src,
    date,
    scheduledAt,
    imageUrl,
    textUrl,
    ok: res.ok,
    status: res.status,
    results: res.results || [],
    message: summarizeResults(res),
    textPreview: text.slice(0, 280),
  };
  await appendBufferLog(entry);
  return entry;
}
