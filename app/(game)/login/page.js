/*
 * /login — manager-game sign-in. If already signed in, bounce to /play.
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
  if (session && session.user) redirect("/play");

  return (
    <div className="game-card">
      <h1>Sign in</h1>
      <p className="game-sub">Manage your club, set tactics and challenge other managers.</p>

      {enabledProviders.length ? (
        <div className="game-providers">
          {enabledProviders.map((p) => (
            <form
              key={p.id}
              action={async () => {
                "use server";
                await signIn(p.id, { redirectTo: "/play" });
              }}
            >
              <button className="game-btn" type="submit">Continue with {p.name}</button>
            </form>
          ))}
        </div>
      ) : (
        <p className="game-note">
          Sign-in isn’t configured yet. Set an OAuth provider’s credentials
          (e.g. <code>AUTH_GITHUB_ID</code> / <code>AUTH_GITHUB_SECRET</code>) to enable it.
        </p>
      )}
    </div>
  );
}
