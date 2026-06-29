/*
 * Drizzle Kit config — drives `npm run db:generate` (SQL migrations from the
 * schema), `db:push` (apply directly to the database) and `db:studio`.
 * Reads the same DATABASE_URL the app uses (for migrations, point it at the
 * Supabase **direct** connection — port 5432 — not the pooler). Migrations land
 * in lib/db/migrations.
 *
 * drizzle-kit doesn't load .env files itself, so we do a tiny dependency-free
 * load of .env.local then .env here (only filling vars that aren't already set).
 * That means `vercel env pull .env.local` followed by `npm run db:push` just
 * works, with no need to export DATABASE_URL by hand.
 */

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

/** @type {import('drizzle-kit').Config} */
module.exports = {
  schema: "./lib/db/schema.js",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
};

