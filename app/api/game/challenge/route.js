/*
 * /api/game/challenge — async PvP. A manager challenges any other club (human-
 * managed or AI); the match is simulated instantly from both sides' best XI and
 * frozen, so neither player has to be online. Returns the result id to watch.
 *
 *   GET  -> { myClubId, opponents:[{clubId,name,human}], history:[{...,resultId,score}] }
 *   POST { opponentClubId } -> { ok, resultId, score }
 *
 * Auth + flag gated. Requires the manager to have claimed a club.
 */

import { isEnabled } from "@/lib/flags";
import { requireManager } from "@/lib/game/requireManager";
import { db } from "@/lib/db/client";
import { clubs, players as playersTbl, managers, matchResults, challenges } from "@/lib/db/schema";
import { eq, ne, desc } from "drizzle-orm";
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

// Seed varies per challenge so repeat matchups differ — derived from both ids
// plus the count of prior challenges so it's deterministic per attempt.
function seedFor(a, b, n) {
  let h = 2166136261;
  for (const ch of String(a) + "|" + String(b) + "|" + n) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}

export async function GET() {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  const opponents = await db
    .select({ clubId: clubs.id, name: clubs.name, human: clubs.ownerManagerId })
    .from(clubs).where(ne(clubs.id, manager.clubId)).orderBy(clubs.name);

  const hist = await db
    .select({
      id: challenges.id, createdAt: challenges.createdAt, resultId: challenges.resultId,
      homeScore: matchResults.homeScore, awayScore: matchResults.awayScore, meta: matchResults.metaJson,
    })
    .from(challenges)
    .leftJoin(matchResults, eq(matchResults.id, challenges.resultId))
    .where(eq(challenges.challengerManagerId, manager.id))
    .orderBy(desc(challenges.createdAt)).limit(20);

  return json({
    myClubId: manager.clubId,
    opponents: opponents.map((o) => ({ clubId: o.clubId, name: o.name, human: !!o.human })),
    history: hist,
  });
}

export async function POST(request) {
  if (!(await isEnabled("game"))) return json({ error: "not found" }, 404);
  const { manager, response } = await requireManager();
  if (response) return response;
  if (!manager.clubId) return json({ error: "claim a club first" }, 409);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }
  const opponentClubId = body.opponentClubId;
  if (!opponentClubId || opponentClubId === manager.clubId) return json({ error: "pick an opponent club" }, 400);

  const home = await loadClub(manager.clubId);
  const away = await loadClub(opponentClubId);
  if (!home || !away) return json({ error: "club not found" }, 404);
  if (!home.players.length || !away.players.length) return json({ error: "a club has no players" }, 409);

  // Count prior challenges to vary the seed.
  const prior = await db.select({ id: challenges.id }).from(challenges)
    .where(eq(challenges.challengerManagerId, manager.id));
  const seed = seedFor(manager.clubId, opponentClubId, prior.length);

  const hl = autoLineup(home.club, home.players);
  const al = autoLineup(away.club, away.players);
  const sim = simulateMatch({ home: hl, away: al, seed });

  try {
    const oppManager = away.club.ownerManagerId
      ? (await db.select({ id: managers.id }).from(managers).where(eq(managers.id, away.club.ownerManagerId)).limit(1))[0]
      : null;

    const ins = await db.insert(matchResults).values({
      fixtureId: null, homeScore: sim.score.home, awayScore: sim.score.away,
      eventsJson: sim.events, statsJson: sim.stats,
      metaJson: { home: sim.homeLineup, away: sim.awayLineup, seed, kind: "challenge" },
      simVersion: SIM_VERSION,
    }).returning({ id: matchResults.id });
    const resultId = ins[0] && ins[0].id;

    await db.insert(challenges).values({
      challengerManagerId: manager.id,
      opponentManagerId: oppManager ? oppManager.id : null,
      status: "played", resultId,
    });
    return json({ ok: true, resultId, score: sim.score });
  } catch (e) {
    return json({ error: "challenge failed: " + String((e && e.message) || e) }, 500);
  }
}
