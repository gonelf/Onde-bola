/*
 * Drizzle Kit config — drives `npm run db:generate` (SQL migrations from the
 * schema), `db:push` (apply directly to a Neon branch) and `db:studio`.
 * Reads the same DATABASE_URL the app uses. Migrations land in lib/db/migrations.
 */

/** @type {import('drizzle-kit').Config} */
module.exports = {
  schema: "./lib/db/schema.js",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
};
