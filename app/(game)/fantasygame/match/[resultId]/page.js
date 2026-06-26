/*
 * /fantasygame/match/[resultId] — watch a frozen simulated match. Loads the
 * match_results row and replays its stored events/stats in the shared animation
 * via <ReplayViewer>. Auth-gated (redirect to /login); the `game` flag is
 * enforced by the (game) layout.
 */

import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { matchResults } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import ReplayViewer from "@/components/game/ReplayViewer";
import "@/assets/replay.css";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }) {
  const session = await auth();
  if (!session || !session.user) redirect("/login");
  if (!db) notFound();

  const { resultId } = await params;
  let row = null;
  try {
    const rows = await db.select().from(matchResults).where(eq(matchResults.id, resultId)).limit(1);
    row = rows[0] || null;
  } catch (e) {
    row = null;
  }
  if (!row) notFound();

  const meta = row.metaJson || {};
  const home = meta.home || { name: "Home", formation: "4-3-3", color: "#4a90d9" };
  const away = meta.away || { name: "Away", formation: "4-3-3", color: "#e8554e" };

  return (
    <>
      <div className="game-card">
        <ReplayViewer home={home} away={away} events={row.eventsJson || []} stats={row.statsJson || []} />
      </div>
      <div className="game-card">
        <div className="game-actions" style={{ justifyContent: "center" }}>
          <a className="game-btn secondary" href="/fantasygame/friendly">↺ Play another</a>
          <a className="game-btn secondary" href="/fantasygame">Dashboard</a>
        </div>
      </div>
    </>
  );
}
