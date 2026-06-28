CREATE TABLE "ad_units" (
	"id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"script" text,
	"banner" jsonb,
	"label" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"slot" text NOT NULL,
	"every_n" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buffer_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buffer_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"trigger" text,
	"post_date" text,
	"scheduled_at" text,
	"ok" boolean DEFAULT false NOT NULL,
	"status" integer,
	"channel_source" text,
	"results" jsonb,
	"message" text,
	"text_preview" text
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cfg" jsonb,
	"display" jsonb,
	"event_sounds" jsonb,
	"audio" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tv_overrides" (
	"fmid" text PRIMARY KEY NOT NULL,
	"date" text,
	"home" text,
	"away" text,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
