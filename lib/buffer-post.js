/*
 * lib/buffer-post — schedule a single update on Buffer (buffer.com) via its
 * classic publish API. Used by /api/cron-buffer to queue the day's "games of the
 * day" post: the square card (/image/<date>/square) with the matching text
 * caption (/image/<date>/text).
 *
 * Auth + targets come from the environment, so no secrets live in the repo:
 *   BUFFER_ACCESS_TOKEN   a Buffer access token
 *   BUFFER_PROFILE_IDS    comma-separated Buffer profile ids to post to
 *
 * Buffer fetches the image itself from the public `photo` URL, so we hand it the
 * /image/<date>/square endpoint rather than uploading bytes.
 */

const BUFFER_API = "https://api.bufferapp.com/1/updates/create.json";

export function bufferConfigured() {
  return Boolean(process.env.BUFFER_ACCESS_TOKEN) && profileIds().length > 0;
}

function profileIds() {
  return String(process.env.BUFFER_PROFILE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
