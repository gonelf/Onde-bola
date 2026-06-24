/*
 * Auth.js (NextAuth v5) config for the manager game.
 *
 * Accounts + OAuth sign-in (GitHub / Google), backed by Postgres via the
 * Drizzle adapter and DATABASE sessions. On first sign-in we provision a
 * `managers` row so every user has a game identity from the start.
 *
 * Fail-soft, like the rest of the game layer: providers are only enabled when
 * their client id/secret are present, and the adapter is only attached when
 * DATABASE_URL is set — so importing this never throws and the (flag-gated,
 * dark-deployable) game routes simply can't authenticate until configured.
 * Coexists with the existing /admin Basic Auth — enforced at the route/layout
 * level (see app/(game)/layout.js), NOT in the edge middleware.
 *
 * Env: DATABASE_URL, AUTH_SECRET, plus per-provider
 *   AUTH_GITHUB_ID / AUTH_GITHUB_SECRET, AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET.
 */

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, dbConfigured } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens, managers } from "@/lib/db/schema";

const providers = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(GitHub);
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

// Which providers the sign-in page should offer (ids only, no secrets).
export const enabledProviders = providers.map((p) => {
  const cfg = typeof p === "function" ? p({}) : p;
  return { id: cfg.id, name: cfg.name };
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: db
    ? DrizzleAdapter(db, {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      })
    : undefined,
  session: { strategy: "database" },
  providers,
  pages: { signIn: "/login" },
  callbacks: {
    // Expose the user id on the session so game routes can resolve a manager.
    session({ session, user }) {
      if (session.user && user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    // First sign-in provisions the user's manager identity (idempotent).
    async createUser({ user }) {
      if (!db || !user || !user.id) return;
      try {
        await db.insert(managers).values({
          userId: user.id,
          displayName: user.name || String(user.email || "").split("@")[0] || "Manager",
        });
      } catch (e) {
        // Degrade, never throw — a missing manager row is recoverable later.
      }
    },
  },
});
