/*
 * /api/game/friendly — simulate a one-off match between two imported clubs and
 * freeze the result, so it can be watched in the replay viewer. This is the M2
 * proof: game logic (simMatch) → the existing animation, end to end.
 *
 * Auth-gated (requireManager) + flag-gated (`game`). POST { homeClubId,
 * awayClubId, seed? }. Loads each club + players, builds an auto-XI, runs the
 * deterministic simulator, and inserts a match_results row (no fixture — a
 * friendly). Returns { resultId } for /fantasygame/match/<id>.
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { clubs, players as playersTbl, matchResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { autoLineup } from "@/lib/game/lineup";
import { simulateMatch, SIM_VERSION } from "@/lib/game/simMatch";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const json = (b, s) => Response.json(b, { status: s || 200, headers: noStore });

async function loadClub(id) {
  const c = await db.select().from(clubs).where(eq(clubs.id, id)).limit(1);
  if (!c[0]) return null;
  const ps = await db.select().from(playersTbl).where(eq(playersTbl.clubId, id));
  return { club: c[0], players: ps };
}

// Deterministic seed from the two club ids when none supplied.
function seedFrom(a, b) {
  let h = 2166136261;
  for (const ch of String(a) + "|" + String(b)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

export async function POST(request) {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { response } = await requireManager();
  if (response) return response;

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const { homeClubId, awayClubId } = body;
  if (!homeClubId || !awayClubId || homeClubId === awayClubId) {
    return json({ error: "pick two different clubs" }, 400);
  }

  let home, away;
  try {
    home = await loadClub(homeClubId);
    away = await loadClub(awayClubId);
  } catch (e) {
    return json({ error: "load failed: " + String((e && e.message) || e) }, 500);
  }
  if (!home || !away) return json({ error: "club not found" }, 404);
  if (!home.players.length || !away.players.length) return json({ error: "a club has no players — re-seed squads" }, 409);

  const seed = (parseInt(body.seed, 10) || seedFrom(homeClubId, awayClubId)) >>> 0;
  const homeLineup = autoLineup(home.club, home.players);
  const awayLineup = autoLineup(away.club, away.players);

  const sim = simulateMatch({ home: homeLineup, away: awayLineup, seed });

  try {
    const ins = await db.insert(matchResults).values({
      fixtureId: null,
      homeScore: sim.score.home,
      awayScore: sim.score.away,
      eventsJson: sim.events,
      statsJson: sim.stats,
      metaJson: { home: sim.homeLineup, away: sim.awayLineup, seed, kind: "friendly" },
      simVersion: SIM_VERSION,
    }).returning({ id: matchResults.id });
    const resultId = ins[0] && ins[0].id;
    return json({ ok: true, resultId, score: sim.score });
  } catch (e) {
    return json({ error: "save failed: " + String((e && e.message) || e) }, 500);
  }
}
