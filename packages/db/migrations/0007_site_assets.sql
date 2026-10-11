CREATE TABLE "site_assets" (
	"key" text PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_assets_key_check" CHECK ("site_assets"."key" in ('logo', 'logo_dark', 'favicon')),
	CONSTRAINT "site_assets_content_type_check" CHECK ("site_assets"."content_type" in ('image/png', 'image/webp', 'image/svg+xml', 'image/x-icon')),
	CONSTRAINT "site_assets_size_check" CHECK (octet_length("site_assets"."data") between 1 and 524288),
	CONSTRAINT "site_assets_sha256_check" CHECK ("site_assets"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "site_assets" ADD CONSTRAINT "site_assets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;