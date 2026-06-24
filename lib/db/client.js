/*
 * Postgres connection for the manager game (Neon serverless HTTP driver +
 * Drizzle). Mirrors lib/kv.js's posture: best-effort and fail-soft. When
 * DATABASE_URL is unset (e.g. the public site, or local dev without the game),
 * `db` is null and `dbConfigured` is false — importing this never throws and the
 * rest of the app is unaffected. Callers that need the DB must null-check `db`
 * (the game routes are gated behind the `game` flag + auth, so they only run
 * once it's configured).
 *
 * Neon's HTTP driver is used deliberately: it issues one HTTP request per query
 * with no long-lived socket, which suits Vercel's ephemeral serverless
 * invocations (no connection-pool exhaustion).
 */

import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";

const DATABASE_URL = process.env.DATABASE_URL;

export const dbConfigured = !!DATABASE_URL;

export const db = DATABASE_URL
  ? drizzle(neon(DATABASE_URL), { schema })
  : null;

export { schema };
