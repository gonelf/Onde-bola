/*
 * /play — the manager dashboard (M1: an empty shell behind accounts). Requires
 * a session; redirects to /login otherwise. Resolves the signed-in user's
 * `managers` row (self-heals if missing) and greets them. The club / squad /
 * league / fixtures panels arrive in later milestones (M2+).
 */

import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/game/auth";
import { db } from "@/lib/db/client";
import { managers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
          Your account is set up. Choosing a club, building your squad and joining
          a league land in the next updates.
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button className="game-btn secondary" type="submit">Sign out</button>
        </form>
      </div>

      <div className="game-card">
        <h2>Friendly match</h2>
        <p className="game-sub">Pick any two imported clubs and watch a simulated match in the live pitch animation.</p>
        <a className="game-btn" href="/play/friendly">▶ Play a friendly</a>
      </div>

      <div className="game-card">
        <h2>League</h2>
        <p className="game-sub">Follow the table and fixtures of the active season.</p>
        <a className="game-btn secondary" href="/play/league">Table</a>
        <a className="game-btn secondary" href="/play/fixtures">Fixtures</a>
      </div>

      <div className="game-card">
        <h2>Your club</h2>
        <p className="game-sub">No club yet — club selection opens soon.</p>
      </div>
    </>
  );
}
