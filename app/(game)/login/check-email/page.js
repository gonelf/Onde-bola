/*
 * /login/check-email — Auth.js `pages.verifyRequest` target. Shown right after
 * a magic-link request: tells the user to open the email and click the link.
 * Already-signed-in users skip straight to the game.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/game/auth";

export const dynamic = "force-dynamic";

export default async function CheckEmailPage() {
  const session = await auth();
  if (session && session.user) redirect("/fantasygame");

  return (
    <div className="game-card feature">
      <h1>📬 Check your email</h1>
      <p className="game-sub">We’ve sent you a magic link. Open it on this device to sign in — it expires shortly, so use it soon.</p>
      <p className="game-note">
        Didn’t get it? Check your spam folder, or <Link href="/login">try a different email</Link>.
      </p>
    </div>
  );
}
