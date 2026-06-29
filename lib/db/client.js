/*
 * Postgres connection for the manager game + Auth.js (postgres-js driver +
 * Drizzle). Mirrors lib/kv.js's posture: best-effort and fail-soft. When
 * DATABASE_URL is unset (e.g. the public site, or local dev without the game),
 * `db` is null and `dbConfigured` is false — importing this never throws and the
 * rest of the app is unaffected. Callers that need the DB must null-check `db`
 * (the game routes are gated behind the `game` flag + auth, so they only run
 * once it's configured).
 *
 * Point DATABASE_URL at Supabase's connection pooler (Supavisor, transaction
 * mode — port 6543) for serverless: it multiplexes the short-lived Vercel
 * invocations over a small pool. Transaction-mode pooling doesn't support
 * prepared statements, so `prepare` is disabled. The client connects lazily (on
 * the first query), so importing this module never opens a socket.
 *
 * Hardening: a bad URL or an unreachable pooler must never crash a route or hang
 * a serverless function (a hang → Vercel 502). So the client is built inside a
 * try/catch (a malformed URL degrades to no-DB), and `connect_timeout` bounds a
 * stuck connection to a few seconds, surfacing it as a catchable error that the
 * callers (all wrapped) turn into a graceful KV/empty fallback instead of a 502.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;

export const dbConfigured = !!DATABASE_URL;

// One lazy client per serverless instance. prepare:false for the transaction-
// mode pooler; connect_timeout so a stuck connection fails fast (caught upstream)
// rather than hanging the function. idle_timeout/max keep the pool serverless-
// friendly. Built defensively so a bad URL can't throw at import.
let client = null;
if (DATABASE_URL) {
  try {
    client = postgres(DATABASE_URL, {
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 20,
      max: 1,
    });
  } catch (e) {
    client = null;
  }
}

export const db = client ? drizzle(client, { schema }) : null;

export { schema };
