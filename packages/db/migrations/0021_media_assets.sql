CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"original_key" text,
	"mime" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"focal_x" smallint DEFAULT 50 NOT NULL,
	"focal_y" smallint DEFAULT 50 NOT NULL,
	"alt_ar" text,
	"alt_en" text,
	"blur_data_url" text,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reject_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_sha256_key" UNIQUE("sha256"),
	CONSTRAINT "media_assets_status_check" CHECK ("media_assets"."status" in ('staged', 'processing', 'ready', 'rejected')),
	CONSTRAINT "media_assets_mime_check" CHECK ("media_assets"."mime" is null or "media_assets"."mime" ~ '^(image/jpeg|image/png|image/webp|image/avif)$'),
	CONSTRAINT "media_assets_sha256_check" CHECK ("media_assets"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "media_assets_focal_check" CHECK ("media_assets"."focal_x" between 0 and 100 and "media_assets"."focal_y" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_status_created_idx" ON "media_assets" USING btree ("status","created_at");