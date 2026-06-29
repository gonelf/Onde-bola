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
 * The selected channels (buffer_channels) and every schedule attempt (buffer_log,
 * append-only) are persisted in Postgres (see lib/db/schema). Best-effort: when
 * the DB isn't configured, reads return empty and scheduling still runs.
 */

import { db } from "@/lib/db/client";
import { dbConfigured } from "@/lib/db/client";
import { bufferChannels, bufferLog } from "@/lib/db/schema";
import { asc, desc } from "drizzle-orm";
import { brandForOrigin } from "@/lib/brand";

const BUFFER_API = process.env.BUFFER_API_URL || "https://api.buffer.com";

// How many of the newest buffer_log rows the admin page shows.
const LOG_LIMIT = 50;

// Which channels to post to is managed from /admin/buffer (stored in the
// buffer_channels table); the env var is an ops fallback, and failing both we
// auto-default to the account's Facebook / Instagram / X channels.
const DEFAULT_SERVICES = ["facebook", "instagram", "twitter", "x"];

// The API key is the essential credential; channels are resolved at schedule
// time (stored → env → auto-default), so token-set is "configured".
export function bufferConfigured() {
  return Boolean(process.env.BUFFER_ACCESS_TOKEN);
}

// Channel ids set in the environment (ops fallback when nothing is saved).
function envChannelIds() {
  return String(process.env.BUFFER_CHANNEL_IDS || process.env.BUFFER_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// True for a Buffer service we auto-select by default (Facebook, Instagram,
// Twitter/X). Tolerant of how Buffer names the X service ("twitter" or "x").
function isDefaultService(service) {
  const s = String(service || "").toLowerCase();
  return s === "x" || s.includes("twitter") || DEFAULT_SERVICES.includes(s);
}

// The channel ids saved from the admin page (empty when never set), in their
// saved order. Best-effort: returns [] when the DB is unset or unreachable.
export async function getStoredChannelIds() {
  if (!db) return [];
  try {
    const rows = await db
      .select({ channelId: bufferChannels.channelId })
      .from(bufferChannels)
      .orderBy(asc(bufferChannels.position), asc(bufferChannels.channelId));
    return rows.map((r) => r.channelId);
  } catch (e) {
    return [];
  }
}

// Persist the admin's channel selection (de-duplicated, order preserved). An
// explicit empty list is honoured (clears the saved selection, falling back to
// env/auto-default). Replace-all in a transaction so a save is atomic.
export async function saveStoredChannelIds(ids) {
  const clean = Array.from(new Set(
    (Array.isArray(ids) ? ids : []).map((x) => String(x).trim()).filter(Boolean)
  ));
  if (!db) return clean;
  try {
    await db.transaction(async (tx) => {
      await tx.delete(bufferChannels);
      if (clean.length) {
        await tx.insert(bufferChannels).values(clean.map((channelId, i) => ({ channelId, position: i })));
      }
    });
  } catch (e) {
    // Fail-soft: a failed save leaves the previous selection in place.
  }
  return clean;
}

// Resolve which channels a post goes to, with where the list came from:
// saved selection → env var → auto-default (the account's FB/IG/X channels).
// Returns { ids, source }.
export async function resolveChannelIds() {
  const stored = await getStoredChannelIds();
  if (stored.length) return { ids: stored, source: "stored" };
  const env = envChannelIds();
  if (env.length) return { ids: env, source: "env" };
  const { ok, channels } = await listBufferChannels();
  if (ok && channels.length) {
    const ids = channels.filter((c) => isDefaultService(c.service)).map((c) => c.id).filter(Boolean);
    if (ids.length) return { ids, source: "default" };
  }
  return { ids: [], source: "none" };
}

// Non-secret view of the Buffer config for the admin page — never exposes the
// API key, only whether it's set and which channels are configured.
export async function bufferConfig() {
  return {
    configured: bufferConfigured(),
    tokenSet: Boolean(process.env.BUFFER_ACCESS_TOKEN),
    endpoint: BUFFER_API,
    dbConfigured,
    storedChannelIds: await getStoredChannelIds(),
    envChannelIds: envChannelIds(),
    defaultServices: DEFAULT_SERVICES,
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
// card is attached by imageUrl, which Buffer fetches itself.
async function createPostOnce({ token, channelId, text, imageUrl, dueAt }) {
  // `assets` is a REQUIRED field ([AssetInput!]!). Attach the card as an image
  // asset; text-only posts pass an empty list.
  const assets = imageUrl ? `[{ image: { url: ${gqlStr(imageUrl)} } }]` : `[]`;
  const mutation = `mutation {
  createPost(input: {
    channelId: ${gqlStr(channelId)}
    text: ${gqlStr(text)}
    schedulingType: automatic
    mode: customScheduled
    dueAt: ${gqlStr(dueAt)}
    assets: ${assets}
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
  const raw = errs || (res && res.message) ||
    (ok ? "scheduled" : (typeof bodyText === "string" ? bodyText : "failed"));
  // Collapse whitespace so an HTML error page (e.g. a 413) reads on one line.
  const message = String(raw).replace(/\s+/g, " ").trim().slice(0, 160);
  return { ok, status, postId: (post && post.id) || null, message };
}

// Schedule one post on a channel. If it fails *with* an image attached, retry
// once text-only: the image is the usual cause of a non-GraphQL failure (a 413
// when Buffer can't fetch the photo — e.g. the URL is behind preview protection
// — or it's too large). That way the post still goes out, and the log records
// that the image was dropped and why. Returns { channelId, ok, status, postId,
// message, imageDropped }.
async function createScheduledPost({ token, channelId, text, imageUrl, dueAt }) {
  const first = await createPostOnce({ token, channelId, text, imageUrl, dueAt });
  if (first.ok || !imageUrl) return { channelId, imageDropped: false, ...first };

  const retry = await createPostOnce({ token, channelId, text, imageUrl: "", dueAt });
  if (retry.ok) {
    return {
      channelId,
      ...retry,
      imageDropped: true,
      message: `scheduled WITHOUT image — image rejected (${first.message})`,
    };
  }
  // Both failed: surface BOTH errors — the text-only one is the real clue when
  // the image isn't the problem (e.g. Facebook works but this channel doesn't).
  return {
    channelId,
    imageDropped: false,
    ok: false,
    status: first.status,
    postId: null,
    message: `with image: ${first.message} || text-only: ${retry.message}`,
  };
}

// Per-platform caption character limits. Twitter/X is the tight one (280) and is
// what trips Buffer's "Payload Too Large" rejection; the others are generous
// enough that our short digests never hit them, so 0 = "don't trim".
function captionLimitFor(service) {
  const s = String(service || "").toLowerCase();
  if (s === "x" || s.includes("twitter")) return 280;
  if (s.includes("bluesky")) return 300;
  if (s.includes("mastodon")) return 500;
  return 0; // facebook / instagram / threads / linkedin / unknown — full text
}

// Length in code points — a flag emoji is two regional-indicator code points,
// which matches how Twitter weights it. A small margin absorbs the rest.
function codeLen(s) { return Array.from(String(s == null ? "" : s)).length; }
const CAPTION_SAFETY = 8;

function hardTrim(s, cap) {
  const a = Array.from(String(s || ""));
  return a.length <= cap ? s : a.slice(0, Math.max(0, cap - 1)).join("") + "…";
}

// Fit a caption to `limit` chars by dropping game lines (the block between the
// header and footer) from the end — they're ranked, so the least important go
// first — while keeping the header and footer. Caption shape:
// `header\n\n<line>\n<line>…\n\n<footer>`. limit 0 → returned unchanged.
function fitCaption(text, limit) {
  if (!limit) return text;
  const t = String(text || "").replace(/\n+$/, "");
  const cap = Math.max(1, limit - CAPTION_SAFETY);
  if (codeLen(t) <= cap) return text;
  const parts = t.split("\n\n");
  if (parts.length < 3) return hardTrim(t, cap);
  const header = parts[0];
  const footer = parts[parts.length - 1];
  const lines = parts.slice(1, -1).join("\n\n").split("\n").filter(Boolean);
  while (lines.length) {
    const candidate = `${header}\n\n${lines.join("\n")}\n\n${footer}`;
    if (codeLen(candidate) <= cap) return candidate;
    lines.pop();
  }
  const hf = `${header}\n\n${footer}`;
  return codeLen(hf) <= cap ? hf : hardTrim(t, cap);
}

/**
 * Schedule the post on every configured Buffer channel. Returns
 * { ok, status, results:[{channelId, ok, postId, message}] } — `ok` is true only
 * when every channel succeeded. The caption is fitted to each channel's platform
 * limit (e.g. Twitter/X 280) by dropping the lowest-ranked games until it fits.
 *   text        the post caption
 *   photo       a public image URL Buffer attaches (and fetches itself)
 *   scheduledAt ISO-8601 (UTC) timestamp for when Buffer should publish it
 */
export async function scheduleBufferUpdate({ text, photo, scheduledAt }) {
  const token = process.env.BUFFER_ACCESS_TOKEN || "";
  if (!token) {
    return { ok: false, status: 0, results: [], channelSource: "none", message: "Buffer not configured (BUFFER_ACCESS_TOKEN)" };
  }
  const { ids, source } = await resolveChannelIds();
  if (!ids.length) {
    return { ok: false, status: 0, results: [], channelSource: source, message: "No Buffer channels configured — set them in /admin/buffer or BUFFER_CHANNEL_IDS" };
  }
  // Resolve each channel's service so the caption can be fitted per platform
  // (Twitter/X 280). Best-effort: an unknown service just means "don't trim".
  const svcById = {};
  try {
    const disc = await listBufferChannels();
    if (disc && disc.ok) disc.channels.forEach((c) => { if (c && c.id) svcById[c.id] = c.service; });
  } catch (e) { /* no services → full text everywhere */ }

  const results = [];
  for (const channelId of ids) {
    const channelText = fitCaption(text, captionLimitFor(svcById[channelId]));
    try {
      results.push(await createScheduledPost({ token, channelId, text: channelText, imageUrl: photo, dueAt: scheduledAt }));
    } catch (e) {
      results.push({ channelId, ok: false, status: 0, postId: null, message: String((e && e.message) || e) });
    }
  }
  const ok = results.length > 0 && results.every((r) => r.ok);
  return { ok, status: results[0] ? results[0].status : 0, results, channelSource: source };
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

// Introspect the GraphQL schema for an input type, so we can see the real field
// names and shapes (media attaches via `assets`, not the `imageUrl` we guessed).
// renderType turns the wrapper chain into "[AssetInput!]!"; namedType pulls the
// innermost named type so we can recurse into it.
function renderType(t) {
  if (!t) return "?";
  if (t.kind === "NON_NULL") return renderType(t.ofType) + "!";
  if (t.kind === "LIST") return "[" + renderType(t.ofType) + "]";
  return t.name || t.kind || "?";
}
function namedType(t) {
  while (t && t.ofType) t = t.ofType;
  return (t && t.name) || null;
}
const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }";

async function introspectType(token, name) {
  const q = `query { __type(name: ${gqlStr(name)}) { name inputFields { name type { ${TYPE_REF} } } } }`;
  const r = await bufferGraphQL(q, token);
  const errs = gqlErrors(r.json);
  if (errs) return { ok: false, error: errs };
  const type = r.json && r.json.data && r.json.data.__type;
  if (!type || !Array.isArray(type.inputFields)) {
    return { ok: false, error: `no input fields for ${name} (introspection disabled or not an input type)`, raw: typeof r.text === "string" ? r.text.slice(0, 200) : "" };
  }
  const fieldsRaw = type.inputFields.map((f) => ({ name: f.name, type: f.type }));
  return { ok: true, name: type.name, fields: fieldsRaw.map((f) => `${f.name}: ${renderType(f.type)}`), fieldsRaw };
}

// Returns { ok, types:[{name, fields}] } — createPost's input fields plus the
// input types reachable through `assets` (AssetInput → ImageAssetInput, …) and
// `metadata` (PostInputMetaData → the per-platform metadata inputs), so we can
// see what Instagram/Twitter require. Bounded recursion into input/metadata
// types (skips scalars/enums).
export async function introspectCreatePost() {
  const token = process.env.BUFFER_ACCESS_TOKEN || "";
  if (!token) return { ok: false, types: [], error: "BUFFER_ACCESS_TOKEN not set" };

  const seen = {};
  const order = [];
  async function collect(typeName, depth) {
    if (!typeName || seen[typeName] || depth < 0) return;
    const t = await introspectType(token, typeName);
    if (!t.ok) return;
    seen[typeName] = t.fields;
    order.push(typeName);
    for (const f of t.fieldsRaw) {
      const n = namedType(f.type);
      if (n && /(Input|Metadata|MetaData)$/.test(n) && !seen[n] && depth > 0) await collect(n, depth - 1);
    }
  }
  await collect("CreatePostInput", 3);
  if (!order.length) {
    const probe = await introspectType(token, "CreatePostInput");
    return { ok: false, types: [], error: probe.error || "introspection failed", raw: probe.raw };
  }
  return { ok: true, types: order.map((name) => ({ name, fields: seen[name] })) };
}

// ---- Schedule log (buffer_log, append-only) ------------------------------

// Map a buffer_log row back to the entry shape the admin page renders.
function rowToEntry(r) {
  return {
    at: r.at,
    trigger: r.trigger,
    date: r.postDate,
    scheduledAt: r.scheduledAt,
    ok: r.ok,
    status: r.status,
    channelSource: r.channelSource,
    results: r.results,
    message: r.message,
    textPreview: r.textPreview,
  };
}

export async function readBufferLog() {
  if (!db) return [];
  try {
    const rows = await db.select().from(bufferLog).orderBy(desc(bufferLog.at)).limit(LOG_LIMIT);
    return rows.map(rowToEntry);
  } catch (e) {
    return [];
  }
}

export async function appendBufferLog(entry) {
  if (!db) return [];
  try {
    await db.insert(bufferLog).values({
      // id + at use the table defaults (uuid, now()).
      trigger: entry.trigger || null,
      postDate: entry.date || null,
      scheduledAt: entry.scheduledAt || null,
      ok: !!entry.ok,
      status: Number.isFinite(entry.status) ? entry.status : null,
      channelSource: entry.channelSource || null,
      results: entry.results || null,
      message: entry.message || null,
      textPreview: entry.textPreview || null,
    });
  } catch (e) {
    // Fail-soft: a missed log row never blocks the actual scheduling.
  }
  return readBufferLog();
}

export async function clearBufferLog() {
  if (!db) return [];
  try {
    await db.delete(bufferLog);
  } catch (e) {
    // Fail-soft.
  }
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
  // Buffer fetches the image itself, as an *external* client — so it must be a
  // publicly reachable URL, NOT the current (possibly Deployment-Protection-
  // gated preview) origin. Use the brand's public production domain, where
  // /image/<date>/square is already live and open. The caption, by contrast, we
  // fetch ourselves from `origin` (with forwarded auth), so it stays on origin.
  const publicHost = brandForOrigin(origin).domain;
  const imageUrl = `https://${publicHost}/image/${date}/square`;
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
    channelSource: res.channelSource || "",
    results: res.results || [],
    message: summarizeResults(res),
    textPreview: text.slice(0, 280),
  };
  await appendBufferLog(entry);
  return entry;
}
