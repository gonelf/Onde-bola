/*
 * Postgres schema for the manager game (Drizzle ORM, pg-core).
 *
 * Two layers live here:
 *   1. The Auth.js (NextAuth v5) tables — users / accounts / sessions /
 *      verification_tokens — in the exact shape @auth/drizzle-adapter expects.
 *      These back accounts + magic-link sign-in (see lib/game/auth.js).
 *   2. The game tables — managers, clubs, players, snapshots, leagues,
 *      league_membership, fixtures, match_results, lineups, transfers,
 *      finances, challenges. `match_results` stores the FROZEN simulator output
 *      (events_json / stats_json) so a replay is byte-reproducible forever and
 *      feeds straight into <MatchPitch> (see docs/fantasy-manager-game-plan.md).
 *
 * Plain JS, no TS — column types come from drizzle-orm/pg-core. Nothing here
 * touches the database; lib/db/client.js owns the connection and degrades to a
 * stub when DATABASE_URL is unset, so importing this file is always safe.
 */

import {
  pgTable, text, integer, boolean, timestamp, jsonb, primaryKey, bigint,
} from "drizzle-orm/pg-core";

// --- Auth.js core tables (shape required by @auth/drizzle-adapter) ----------

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] }),
  })
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// --- Game tables ------------------------------------------------------------

// A frozen roster set imported from FotMob, so gameplay is stable even as the
// live feed drifts (see lib/game/fotmobSquad.js, added in M2).
export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: text("source").notNull().default("fotmob"),
  seasonLabel: text("season_label"),
  notes: text("notes"),
  takenAt: timestamp("taken_at").defaultNow().notNull(),
});

// A manager is a user's identity inside the game (one-to-one with users).
export const managers = pgTable("managers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  clubId: text("club_id"), // FK assigned once they pick/are given a club (M2+)
  cashBalance: bigint("cash_balance", { mode: "number" }).default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clubs = pgTable("clubs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fotmobTeamId: text("fotmob_team_id"),
  name: text("name").notNull(),
  shortName: text("short_name"),
  crestUrl: text("crest_url"),
  kitColor: text("kit_color").default("#4a90d9"),
  kitTextColor: text("kit_text_color").default("#ffffff"),
  baseFormation: text("base_formation").default("4-3-3"),
  ownerManagerId: text("owner_manager_id"),
  isAi: boolean("is_ai").default(true).notNull(),
  snapshotId: text("snapshot_id").references(() => snapshots.id),
});

export const players = pgTable("players", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clubId: text("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  fotmobPlayerId: text("fotmob_player_id"),
  name: text("name").notNull(),
  shortName: text("short_name"),
  position: text("position"), // GK / DF / MF / FW (+ detailed label kept loose)
  rating: integer("rating").default(60).notNull(), // 40..99 scale
  age: integer("age"),
  marketValue: bigint("market_value", { mode: "number" }).default(0).notNull(),
  derived: boolean("derived").default(false).notNull(), // true = rating inferred, not from feed
  snapshotId: text("snapshot_id").references(() => snapshots.id),
});

export const leagues = pgTable("leagues", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  tier: integer("tier").default(1).notNull(),
  seasonLabel: text("season_label"),
  status: text("status").default("draft").notNull(), // draft | active | finished
  promotionSlots: integer("promotion_slots").default(0).notNull(),
  relegationSlots: integer("relegation_slots").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Standings row per club per league — materialized from match_results so the
// table renders without a full recompute.
export const leagueMembership = pgTable("league_membership", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
  clubId: text("club_id").notNull().references(() => clubs.id, { onDelete: "cascade" }),
  played: integer("played").default(0).notNull(),
  won: integer("won").default(0).notNull(),
  drawn: integer("drawn").default(0).notNull(),
  lost: integer("lost").default(0).notNull(),
  gf: integer("gf").default(0).notNull(),
  ga: integer("ga").default(0).notNull(),
  points: integer("points").default(0).notNull(),
});

export const fixtures = pgTable("fixtures", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
  round: integer("round").default(1).notNull(),
  homeClubId: text("home_club_id").notNull().references(() => clubs.id),
  awayClubId: text("away_club_id").notNull().references(() => clubs.id),
  scheduledAt: timestamp("scheduled_at"),
  status: text("status").default("scheduled").notNull(), // scheduled | simulated
  seed: bigint("seed", { mode: "number" }), // frozen at scheduling time
  resultId: text("result_id"),
});

// The frozen simulator output — the source of truth for a played match and the
// exact payload the replay viewer hands to <MatchPitch>.
export const matchResults = pgTable("match_results", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  fixtureId: text("fixture_id").references(() => fixtures.id, { onDelete: "cascade" }),
  homeScore: integer("home_score").default(0).notNull(),
  awayScore: integer("away_score").default(0).notNull(),
  eventsJson: jsonb("events_json").notNull(), // [{ side, min, kind, player, note }]
  statsJson: jsonb("stats_json").notNull(),   // [{ key, home, away }]
  simVersion: text("sim_version"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// A manager's chosen XI/bench + tactics, optionally per-fixture; falls back to
// the club's base formation + auto-XI when absent.
export const lineups = pgTable("lineups", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  managerId: text("manager_id").references(() => managers.id, { onDelete: "cascade" }),
  clubId: text("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  fixtureId: text("fixture_id").references(() => fixtures.id, { onDelete: "cascade" }),
  formation: text("formation").default("4-3-3").notNull(),
  playersJson: jsonb("players_json"), // { xi:[playerId], bench:[playerId] }
  tacticsJson: jsonb("tactics_json"), // { mentality, pressing, tempo, width }
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transfers = pgTable("transfers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  leagueId: text("league_id").references(() => leagues.id),
  playerId: text("player_id").references(() => players.id),
  fromClubId: text("from_club_id").references(() => clubs.id),
  toClubId: text("to_club_id").references(() => clubs.id),
  fee: bigint("fee", { mode: "number" }).default(0).notNull(),
  type: text("type").default("buy").notNull(), // buy | sell | free
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const finances = pgTable("finances", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  clubId: text("club_id").references(() => clubs.id, { onDelete: "cascade" }),
  seasonLabel: text("season_label"),
  type: text("type").notNull(), // gate | transfer | wages | prize
  amount: bigint("amount", { mode: "number" }).default(0).notNull(),
  fixtureId: text("fixture_id").references(() => fixtures.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Async PvP one-off challenges between two managers (or vs an AI club).
export const challenges = pgTable("challenges", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  challengerManagerId: text("challenger_manager_id").notNull().references(() => managers.id, { onDelete: "cascade" }),
  opponentManagerId: text("opponent_manager_id").references(() => managers.id, { onDelete: "cascade" }),
  status: text("status").default("pending").notNull(), // pending | played | declined
  resultId: text("result_id").references(() => matchResults.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
