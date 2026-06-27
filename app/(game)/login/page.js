/*
 * /login — manager-game sign-in. If already signed in, bounce to /fantasygame.
 * Otherwise render a single email field that sends a Resend magic link: the
 * only sign-in method. The Auth.js `signIn("resend", ...)` server action mails
 * a one-time link and redirects to /login/check-email (pages.verifyRequest).
 * Magic-link sign-in only appears when it's configured (AUTH_RESEND_KEY +
 * EMAIL_FROM, see lib/game/auth.js), so before setup this page explains that
 * sign-in isn't available yet rather than 500-ing.
 */

import { redirect } from "next/navigation";
import { auth, signIn, emailEnabled } from "@/lib/game/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await auth();
  if (session && session.user) redirect("/fantasygame");

  return (
    <div className="game-card feature">
      <h1>⚽ Sign in to Manager</h1>
      <p className="game-sub">Claim a club, build your squad in the transfer market, set tactics and challenge other managers across the season.</p>

      {emailEnabled ? (
        <form
          className="game-providers"
          action={async (formData) => {
            "use server";
            const email = String(formData.get("email") || "").trim();
            if (!email) return;
            await signIn("resend", { email, redirectTo: "/fantasygame" });
          }}
        >
          <label className="game-label" htmlFor="email">Email</label>
          <input
            className="game-input"
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <button className="game-btn" type="submit">Send magic link</button>
          <p className="game-note">We’ll email you a one-time link to sign in — no password needed.</p>
        </form>
      ) : (
        <p className="game-note">
          Sign-in isn’t configured yet. Set <code>AUTH_RESEND_KEY</code> and
          <code>EMAIL_FROM</code> (and <code>AUTH_SECRET</code>) to enable magic-link sign-in.
        </p>
      )}
    </div>
  );
}
