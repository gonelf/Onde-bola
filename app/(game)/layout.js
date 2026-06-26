/*
 * (game) layout — the manager-game shell (under /fantasygame and /login). Nested under
 * the minimal root layout, so it does NOT render <html>/<body>; it brings the
 * game stylesheet and a slim header.
 *
 * THE GATE: the whole mode lives behind the `game` feature flag (lib/flags).
 * When it's off (the default), this layout 404s every route under it, so the
 * beta deploys dark and the owner flips it on from /admin/flags without a
 * redeploy. Auth is enforced per-page (the dashboard redirects to /login),
 * not here, so /login itself stays reachable while gated by the flag.
 */

import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/flags";
import GameNav from "@/components/game/GameNav";
import "@/assets/game.css";

export const metadata = {
  title: "Manager · Hoje Há Bola",
  robots: { index: false, follow: false },
};

export default async function GameLayout({ children }) {
  if (!(await isEnabled("game"))) notFound();

  return (
    <div className="game-shell">
      <header className="game-header">
        <a className="brand" href="/fantasygame">
          <span className="ball">⚽</span> <b>Manager</b> <small>beta</small>
        </a>
        <GameNav />
        <a className="game-btn secondary sm site-link" href="/">← Site</a>
      </header>
      <main className="game-main">{children}</main>
    </div>
  );
}
