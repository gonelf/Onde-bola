CREATE TABLE "seo_urls" (
	"url" text PRIMARY KEY NOT NULL,
	"lastmod" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
