/*
 * /api/overrides — admin CRUD for manual TV-listing overrides (see lib/overrides).
 *
 * Gated by HTTP Basic Auth (ADMIN_USER / ADMIN_PASSWORD), both at the edge
 * (middleware.js) and here (defence in depth, fail-closed when creds are unset).
 *
 *   GET    ?date=YYYY-MM-DD?  -> { overrides: [ { fmid, date, home, away, rows } ] }
 *   POST   { fmid, date, home, away, rows:[{country,channel}] }  -> upsert one
 *   DELETE ?fmid=<id>         -> remove one
 *
 * Stored permanently in KV under tv:overrides; merged into the listings store by
 * lib/listings-build and into /api/listings reads.
 */

import { kv } from "@/lib/kv";
import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { loadOverrides, saveOverrides } from "@/lib/overrides";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function deny() {
  return Response.json(
    { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
    { status: 401, headers: noStore }
  );
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  const all = await loadOverrides();
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const list = Object.keys(all).map((fmid) => Object.assign({ fmid }, all[fmid]));
  const overrides = date ? list.filter((o) => o.date === date) : list;
  return Response.json({ overrides }, { headers: noStore });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const fmid = String(body.fmid || "").trim();
  if (!/^\d+$/.test(fmid)) {
    return Response.json({ error: "numeric fmid required" }, { status: 400, headers: noStore });
  }
  const rows = (Array.isArray(body.rows) ? body.rows : [])
    .map((r) => ({ country: String(r.country || "").trim(), channel: String(r.channel || "").trim() }))
    .filter((r) => r.country && r.channel);
  if (!rows.length) {
    return Response.json({ error: "rows (country + channel) required" }, { status: 400, headers: noStore });
  }

  const all = await loadOverrides();
  all[fmid] = {
    date: String(body.date || "").trim(),
    home: String(body.home || "").trim(),
    away: String(body.away || "").trim(),
    rows,
    updatedAt: new Date().toISOString(),
  };
  await saveOverrides(all);
  return Response.json({ ok: true, fmid, override: all[fmid] }, { headers: noStore });
}

export async function DELETE(request) {
  if (!isAdmin(request)) return deny();
  const { searchParams } = new URL(request.url);
  const fmid = String(searchParams.get("fmid") || "").trim();
  const all = await loadOverrides();
  if (all[fmid]) { delete all[fmid]; await saveOverrides(all); }
  return Response.json({ ok: true, fmid }, { headers: noStore });
}
