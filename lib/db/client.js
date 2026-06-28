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
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;

export const dbConfigured = !!DATABASE_URL;

// One lazy client per serverless instance; prepare:false for the transaction-
// mode pooler (Supavisor / PgBouncer).
const client = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false }) : null;

export const db = client ? drizzle(client, { schema }) : null;

export { schema };
