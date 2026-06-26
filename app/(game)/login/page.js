/*
 * /login — manager-game sign-in. If already signed in, bounce to /fantasygame.
 * Otherwise render a sign-in button per enabled OAuth provider (GitHub/Google),
 * each wired to the Auth.js `signIn` server action. Providers only appear when
 * their credentials are configured (lib/game/auth.js), so before setup this
 * page explains that sign-in isn't available yet rather than 500-ing.
 */

import { redirect } from "next/navigation";
import { auth, signIn, enabledProviders } from "@/lib/game/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session && session.user) redirect("/fantasygame");

  return (
    <div className="game-card feature">
      <h1>⚽ Sign in to Manager</h1>
      <p className="game-sub">Claim a club, build your squad in the transfer market, set tactics and challenge other managers across the season.</p>

      {enabledProviders.length ? (
        <div className="game-providers">
          {enabledProviders.map((p) => (
            <form
              key={p.id}
              action={async () => {
                "use server";
                await signIn(p.id, { redirectTo: "/fantasygame" });
              }}
            >
              <button className="game-btn" type="submit">Continue with {p.name}</button>
            </form>
          ))}
        </div>
      ) : (
        <p className="game-note">
          Sign-in isn’t configured yet. Set <code>AUTH_GOOGLE_ID</code> /
          <code>AUTH_GOOGLE_SECRET</code> (and <code>AUTH_SECRET</code>) to enable Google sign-in.
        </p>
      )}
    </div>
  );
}
