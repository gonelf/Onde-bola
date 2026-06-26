"use client";

/*
 * GameNav — the manager-game header navigation. A client component so it can
 * highlight the active section via usePathname. On narrow screens the pill row
 * scrolls horizontally (see .game-nav in game.css) instead of stacking into an
 * awkward vertical column, which is the main mobile UX fix.
 */

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/fantasygame", label: "Dashboard" },
  { href: "/fantasygame/squad", label: "Squad" },
  { href: "/fantasygame/transfers", label: "Transfers" },
  { href: "/fantasygame/league", label: "League" },
  { href: "/fantasygame/fixtures", label: "Fixtures" },
  { href: "/fantasygame/challenge", label: "Challenge" },
  { href: "/fantasygame/friendly", label: "Friendly" },
];

export default function GameNav() {
  const pathname = usePathname() || "";

  const isActive = (href) =>
    href === "/fantasygame"
      ? pathname === "/fantasygame"
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="game-nav" aria-label="Manager game">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} className={isActive(l.href) ? "active" : undefined} aria-current={isActive(l.href) ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
