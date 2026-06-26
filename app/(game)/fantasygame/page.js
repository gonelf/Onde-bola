/*
 * /fantasygame — the manager dashboard (M1: an empty shell behind accounts). Requires
 * a session; redirects to /login otherwise. Resolves the signed-in user's
 * `managers` row (self-heals if missing) and greets them. The club / squad /
 * league / fixtures panels arrive in later milestones (M2+).
 */

import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { managers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import ClubPanel from "@/components/game/ClubPanel";

export const dynamic = "force-dynamic";

export default async function PlayPage() {
  const session = await auth();
  if (!session || !session.user) redirect("/login");

  let manager = null;
  if (db && session.user.id) {
    try {
      const rows = await db
        .select()
        .from(managers)
        .where(eq(managers.userId, session.user.id))
        .limit(1);
      manager = rows[0] || null;
    } catch (e) {
      manager = null;
    }
  }

  const name = (manager && manager.displayName) || session.user.name || "Manager";

  return (
    <>
      <div className="game-card">
        <h1>Welcome, {name}</h1>
        <p className="game-sub">
          Claim a club below, build your squad in the transfer market, train your
          players and climb the league.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="game-btn secondary sm" type="submit">Sign out</button>
        </form>
      </div>

      <ClubPanel />

      <div className="game-card feature">
        <h2>⚽ Friendly match</h2>
        <p className="game-sub">Pick any two imported clubs and watch a simulated match in the live pitch animation.</p>
        <div className="game-actions">
          <a className="game-btn" href="/fantasygame/friendly">▶ Play a friendly</a>
          <a className="game-btn secondary" href="/fantasygame/challenge">⚔ Challenge a club</a>
        </div>
      </div>

      <div className="game-card">
        <h2>League</h2>
        <p className="game-sub">Follow the table and fixtures of the active season.</p>
        <div className="game-actions">
          <a className="game-btn secondary" href="/fantasygame/league">Table</a>
          <a className="game-btn secondary" href="/fantasygame/fixtures">Fixtures</a>
        </div>
      </div>
    </>
  );
}
