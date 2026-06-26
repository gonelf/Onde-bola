/*
 * /api/admin/seed-squads — import real PT/UK clubs + squads into the game DB.
 *
 * Basic-Auth gated (ADMIN_USER/ADMIN_PASSWORD via isAdmin) and gated inline so
 * we don't have to touch middleware.js. Scope is enforced by ALLOWED_LEAGUES in
 * lib/game/fotmobSquad (PT + UK only) — any other league id is rejected.
 *
 *   GET                                -> { leagues: ALLOWED_LEAGUES }  (admin UI)
 *   POST { leagueId, source?, limit? }  -> merge the league's clubs + squads
 *        across all sources (FotMob truth + Football-Data + TheSportsDB), derive
 *        ratings, and upsert clubs + players under a fresh snapshot.
 *        source: "auto" (default, merge all) | "fotmob" | "footballdata" | "thesportsdb".
 *
 * Fail-soft: degrades per-source and per-club rather than aborting the import.
 */

import { isAdmin, adminCredsConfigured } from "@/lib/admin-auth";
import { db, dbConfigured } from "@/lib/db/client";
import { snapshots, clubs, players } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ALLOWED_LEAGUES, isAllowedLeague, leagueInfo } from "@/lib/game/fotmobSquad";
import { ingestLeague } from "@/lib/game/ingest";
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
  // "auto" merges every reachable source (FotMob truth + Football-Data +
  // TheSportsDB). A specific source forces just that one.
  const SOURCES = ["auto", "fotmob", "footballdata", "thesportsdb"];
  const source = SOURCES.includes(body.source) ? body.source : "auto";

  const fetched = await ingestLeague(leagueId, { only: source === "auto" ? undefined : source });
  const rawClubs = (fetched.clubs || []).slice(0, limit);
  if (!rawClubs.length) {
    return json({
      ok: false,
      error: "no clubs fetched from any source (FotMob blocked, no FOOTBALL_DATA_TOKEN, TheSportsDB miss?)",
      sources: fetched.sources || {},
    }, 502);
  }

  // One snapshot per import.
  let snapshotId;
  try {
    const s = fetched.sources || {};
    const srcNote = `fm:${s.fotmob || 0} fd:${s.footballdata || 0} sd:${s.thesportsdb || 0}`;
    const snap = await db.insert(snapshots).values({
      source,
      seasonLabel: info.name,
      notes: `${info.country} · ${info.name} · ${rawClubs.length} clubs · ${source} (${srcNote})`,
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
      summary.push({
        club: rc.name, players: derived.length,
        derivedRatings: derived.filter((p) => p.derived).length,
        roster: rc.provenance && rc.provenance.roster, ratings: rc.provenance && rc.provenance.ratings,
      });
    } catch (e) {
      summary.push({ club: rc.name, error: String((e && e.message) || e) });
    }
  }

  const ok = summary.filter((s) => s.players).length;
  return json({
    ok: true, league: info, snapshotId, source, clubsImported: ok,
    realRosters: fetched.realRosters || 0, sources: fetched.sources || {}, summary,
  });
}

function shortName(name) {
  const n = String(name || "").trim();
  return n.length > 14 ? n.replace(/\s*(FC|CF|SC|AC|United|City)\b.*$/i, "").trim() || n.slice(0, 14) : n;
}
