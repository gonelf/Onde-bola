/*
 * Auth.js (NextAuth v5) config for the manager game.
 *
 * Passwordless sign-in via a Resend magic link (email only), backed by Postgres
 * via the Drizzle adapter and DATABASE sessions. On first sign-in we provision a
 * `managers` row so every user has a game identity from the start.
 *
 * Fail-soft, like the rest of the game layer: the email provider is only enabled
 * when AUTH_RESEND_KEY is present, and the adapter is only attached when
 * DATABASE_URL is set — so importing this never throws and the (flag-gated,
 * dark-deployable) game routes simply can't authenticate until configured.
 * Coexists with the existing /admin Basic Auth — enforced at the route/layout
 * level (see app/(game)/layout.js), NOT in the edge middleware.
 *
 * Env: DATABASE_URL, AUTH_SECRET, AUTH_RESEND_KEY, EMAIL_FROM (the verified
 * Resend sender, e.g. "Onde Bola <no-reply@yourdomain>").
 */

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, dbConfigured } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens, managers } from "@/lib/db/schema";

// Magic-link sign-in needs both a Resend API key and a verified sender address.
const emailFrom = process.env.EMAIL_FROM || process.env.AUTH_EMAIL_FROM;
export const emailEnabled = Boolean(process.env.AUTH_RESEND_KEY && emailFrom);

const providers = [];
if (emailEnabled) {
  providers.push(Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: emailFrom }));
}

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
  pages: { signIn: "/login", verifyRequest: "/login/check-email" },
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
