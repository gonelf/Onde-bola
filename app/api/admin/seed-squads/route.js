/*
 * /api/admin/seed-squads — import real PT/UK clubs + squads into the game DB.
 *
 * Basic-Auth gated (ADMIN_USER/ADMIN_PASSWORD via isAdmin) and gated inline so
 * we don't have to touch middleware.js. Scope is enforced by ALLOWED_LEAGUES in
 * lib/game/fotmobSquad (PT + UK only) — any other league id is rejected.
 *
 *   GET                       -> { leagues: ALLOWED_LEAGUES }  (for the admin UI)
 *   POST { leagueId, limit? } -> fetch the league's clubs + squads from FotMob,
 *                                derive ratings, and upsert clubs + players under
 *                                a fresh snapshot. Returns a summary.
 *
 * Fail-soft: degrades per-club rather than aborting the whole import; a club
 * with no squad is skipped and reported.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db, dbConfigured } from "@/lib/db/client";
import { snapshots, clubs, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  ALLOWED_LEAGUES, isAllowedLeague, leagueInfo, fetchLeagueSquads,
} from "@/lib/game/fotmobSquad";
import { fetchLeagueSquadsTSDB } from "@/lib/game/sportsdbSquad";
import { deriveSquad } from "@/lib/game/deriveRatings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const json = (body, status) => Response.json(body, { status: status || 200, headers: noStore });

function deny() {
  return json(
    { error: adminCredsConfigured() ? "unauthorized" : "admin credentials not configured" },
    401
  );
}

export async function GET(request) {
  if (!isAdmin(request)) return deny();
  return json({ leagues: ALLOWED_LEAGUES, dbConfigured });
}

export async function POST(request) {
  if (!isAdmin(request)) return deny();
  if (!db) return json({ ok: false, error: "DATABASE_URL not configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const leagueId = body.leagueId;
  if (!isAllowedLeague(leagueId)) {
    return json({ error: "league not allowed (PT/UK only)", allowed: ALLOWED_LEAGUES.map((l) => l.id) }, 400);
  }
  const info = leagueInfo(leagueId);
  const limit = Math.max(1, Math.min(30, parseInt(body.limit, 10) || 24));
  // Default to TheSportsDB (reliable club lists); FotMob is opt-in (real squads,
  // but its endpoints are often blocked from server IPs).
  const source = body.source === "fotmob" ? "fotmob" : "thesportsdb";

  const fetched = source === "fotmob"
    ? await fetchLeagueSquads(leagueId, { limit })
    : await fetchLeagueSquadsTSDB(leagueId, { limit });
  const rawClubs = fetched.clubs || [];
  if (!rawClubs.length) {
    return json({
      ok: false,
      error: source === "fotmob"
        ? "no clubs fetched from FotMob (blocked or off-season) — try source 'thesportsdb'"
        : "no clubs fetched from TheSportsDB (check league name / THESPORTSDB_KEY)",
    }, 502);
  }

  // One snapshot per import.
  let snapshotId;
  try {
    const snap = await db.insert(snapshots).values({
      source,
      seasonLabel: info.name,
      notes: `${info.country} · ${info.name} · ${rawClubs.length} clubs · via ${source}`,
    }).returning();
    snapshotId = snap[0] && snap[0].id;
  } catch (e) {
    return json({ ok: false, error: "snapshot insert failed: " + String((e && e.message) || e) }, 500);
  }

  const summary = [];
  for (const rc of rawClubs) {
    // FotMob clubs carry real 0–10 ratings; TheSportsDB clubs have a per-club
    // strength and null ratings that deriveSquad baselines.
    const derived = deriveSquad(rc, rc.strength || info.strength);
    if (!derived.length) { summary.push({ club: rc.name, skipped: "no players" }); continue; }
    const externalId = rc.fotmobTeamId || rc.externalId || null;
    try {
      // Upsert the club by its external id.
      const existing = externalId
        ? await db.select().from(clubs).where(eq(clubs.fotmobTeamId, externalId)).limit(1)
        : [];
      let clubId;
      if (existing[0]) {
        clubId = existing[0].id;
        await db.update(clubs).set({
          name: rc.name, crestUrl: rc.crest, kitColor: rc.kitColor, snapshotId,
        }).where(eq(clubs.id, clubId));
        await db.delete(players).where(eq(players.clubId, clubId));
      } else {
        const ins = await db.insert(clubs).values({
          fotmobTeamId: externalId, name: rc.name, shortName: shortName(rc.name),
          crestUrl: rc.crest, kitColor: rc.kitColor, isAi: true, snapshotId,
        }).returning();
        clubId = ins[0] && ins[0].id;
      }
      if (!clubId) { summary.push({ club: rc.name, skipped: "club upsert failed" }); continue; }

      await db.insert(players).values(
        derived.map((p) => ({
          clubId, snapshotId,
          fotmobPlayerId: p.fotmobPlayerId, name: p.name, shortName: p.shortName,
          position: p.position, rating: p.rating, age: p.age,
          marketValue: p.marketValue, derived: p.derived,
        }))
      );
      summary.push({ club: rc.name, players: derived.length, derivedRatings: derived.filter((p) => p.derived).length });
    } catch (e) {
      summary.push({ club: rc.name, error: String((e && e.message) || e) });
    }
  }

  const ok = summary.filter((s) => s.players).length;
  return json({ ok: true, league: info, snapshotId, clubsImported: ok, summary });
}

function shortName(name) {
  const n = String(name || "").trim();
  return n.length > 14 ? n.replace(/\s*(FC|CF|SC|AC|United|City)\b.*$/i, "").trim() || n.slice(0, 14) : n;
}
