"use client";

/*
 * AdminNav — React top bar + slide-in drawer for the admin console, mirroring
 * the static public/admin/admin-nav.js so React admin pages share the look.
 * Styling comes from public/admin/admin.css (imported by the (admin) layout).
 */

import { useState } from "react";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/admin", label: "Connections debug" },
  { href: "/admin/overrides", label: "TV overrides" },
  { href: "/admin/seo", label: "pSEO / sitemap" },
  { href: "/admin/ads", label: "Manage ads" },
  { href: "/admin/ad-test", label: "Ad script tester" },
  { href: "/admin/flags", label: "Feature flags" },
  { href: "/admin/replay", label: "Match animation" },
  { href: "/admin/game-seed", label: "Game: seed squads" },
  { href: "/admin/game-league", label: "Game: leagues" },
];

export default function AdminNav() {
  const [open, setOpen] = useState(false);
  const raw = usePathname() || "/admin";
  const path = raw.replace(/\/+$/, "") || "/admin";
  const current = PAGES.find((p) => p.href === path) || PAGES[0];

  return (
    <div className={open ? "admin-nav-open" : ""}>
      <div className="admin-topbar">
        <button className="admin-burger" type="button" aria-label="Menu"
          aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span></span><span></span><span></span>
        </button>
        <div className="admin-title">Hoje Há <b>Bola</b> · {current.label}</div>
      </div>
      <nav className="admin-drawer" aria-label="Admin">
        <div className="admin-drawer-head">Hoje Há <b>Bola</b> · Admin</div>
        {PAGES.map((p) => (
          <a key={p.href} href={p.href} className={p.href === path ? "active" : undefined}>{p.label}</a>
        ))}
      </nav>
      <div className="admin-backdrop" onClick={() => setOpen(false)} />
    </div>
  );
}
