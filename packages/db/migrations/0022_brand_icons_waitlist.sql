CREATE TABLE "app_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"platform" text DEFAULT 'both' NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_waitlist_email_key" UNIQUE("email"),
	CONSTRAINT "app_waitlist_email_lower_check" CHECK ("app_waitlist"."email" = lower("app_waitlist"."email")),
	CONSTRAINT "app_waitlist_platform_check" CHECK ("app_waitlist"."platform" in ('android', 'ios', 'both')),
	CONSTRAINT "app_waitlist_locale_check" CHECK ("app_waitlist"."locale" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "site_asset_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"replaced_by" uuid,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_asset_history_key_check" CHECK ("site_asset_history"."key" in ('logo', 'logo_dark', 'favicon', 'symbol', 'favicon_ico', 'icon_48', 'icon_96', 'icon_192', 'icon_512', 'icon_maskable_512', 'apple_touch_icon', 'og_default', 'logo_en', 'logo_mono', 'email_logo')),
	CONSTRAINT "site_asset_history_content_type_check" CHECK ("site_asset_history"."content_type" in ('image/png', 'image/webp', 'image/svg+xml', 'image/x-icon')),
	CONSTRAINT "site_asset_history_size_check" CHECK (octet_length("site_asset_history"."data") between 1 and 524288),
	CONSTRAINT "site_asset_history_sha256_check" CHECK ("site_asset_history"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "site_assets" DROP CONSTRAINT "site_assets_key_check";--> statement-breakpoint
ALTER TABLE "site_asset_history" ADD CONSTRAINT "site_asset_history_replaced_by_users_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_waitlist_created_idx" ON "app_waitlist" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "site_asset_history_key_replaced_idx" ON "site_asset_history" USING btree ("key","replaced_at");--> statement-breakpoint
ALTER TABLE "site_assets" ADD CONSTRAINT "site_assets_key_check" CHECK ("site_assets"."key" in ('logo', 'logo_dark', 'favicon', 'symbol', 'favicon_ico', 'icon_48', 'icon_96', 'icon_192', 'icon_512', 'icon_maskable_512', 'apple_touch_icon', 'og_default', 'logo_en', 'logo_mono', 'email_logo'));