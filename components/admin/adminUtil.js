"use client";

// Shared client helpers for the React admin pages.

// Parse a fetch Response as JSON, surfacing the server's real error message
// (and a hint to set the admin credentials on 401), like the old admin pages did.
export async function asJson(r) {
  let j = null;
  try { j = await r.json(); } catch (e) { throw new Error("HTTP " + r.status + " (non-JSON response)"); }
  if (!r.ok) {
    let msg = (j && j.error) || ("HTTP " + r.status);
    if (r.status === 401) msg += " — set ADMIN_USER / ADMIN_PASSWORD, then reload";
    throw new Error(msg);
  }
  return j;
}

export const todayUTC = () => new Date().toISOString().slice(0, 10);

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
}
