CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"advertiser_id" uuid,
	"title" text NOT NULL,
	"image_media_id" uuid,
	"alt" text NOT NULL,
	"target_url" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"weight" integer DEFAULT 100 NOT NULL,
	"targeting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channels" text[] DEFAULT '{web}'::text[] NOT NULL,
	"wa_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_creatives_status_check" CHECK ("ad_creatives"."status" in ('draft', 'approved', 'paused', 'archived')),
	CONSTRAINT "ad_creatives_category_check" CHECK ("ad_creatives"."category" in ('house', 'pharmacy_delivery', 'insurance', 'labs_clinics', 'health_devices', 'wellness_apps', 'education', 'retail', 'other', 'medicine')),
	CONSTRAINT "ad_creatives_channels_check" CHECK ("ad_creatives"."channels" <@ ARRAY['web', 'whatsapp']::text[]),
	CONSTRAINT "ad_creatives_weight_check" CHECK ("ad_creatives"."weight" between 1 and 1000),
	CONSTRAINT "ad_creatives_wa_text_check" CHECK ("ad_creatives"."wa_text" is null or char_length("ad_creatives"."wa_text") <= 700),
	CONSTRAINT "ad_creatives_schedule_check" CHECK ("ad_creatives"."starts_at" is null or "ad_creatives"."ends_at" is null or "ad_creatives"."starts_at" < "ad_creatives"."ends_at"),
	CONSTRAINT "ad_creatives_no_medicine_check" CHECK ("ad_creatives"."status" <> 'approved' or "ad_creatives"."category" <> 'medicine')
);
--> statement-breakpoint
CREATE TABLE "ad_placements" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"page_classes" text[] NOT NULL,
	"devices" text[] DEFAULT '{mobile,tablet,desktop}'::text[] NOT NULL,
	"max_per_page" integer DEFAULT 1 NOT NULL,
	"format" text NOT NULL,
	"size_desktop" text NOT NULL,
	"size_mobile" text NOT NULL,
	"closable" boolean DEFAULT false NOT NULL,
	"dismiss_days" integer DEFAULT 7 NOT NULL,
	"allow_paid" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_placements_page_classes_check" CHECK ("ad_placements"."page_classes" <@ ARRAY['marketing', 'conversion', 'content', 'medical_reference', 'utility_public', 'app_neutral', 'app_sensitive']::text[]),
	CONSTRAINT "ad_placements_devices_check" CHECK ("ad_placements"."devices" <@ ARRAY['mobile', 'tablet', 'desktop']::text[]),
	CONSTRAINT "ad_placements_format_check" CHECK ("ad_placements"."format" in ('banner', 'native', 'bottom_banner')),
	CONSTRAINT "ad_placements_max_per_page_check" CHECK ("ad_placements"."max_per_page" between 0 and 10),
	CONSTRAINT "ad_placements_dismiss_days_check" CHECK ("ad_placements"."dismiss_days" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "ad_stats_daily" (
	"creative_id" uuid NOT NULL,
	"placement_key" text NOT NULL,
	"day" date NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ad_stats_daily_pkey" PRIMARY KEY("creative_id","placement_key","day","channel"),
	CONSTRAINT "ad_stats_daily_channel_check" CHECK ("ad_stats_daily"."channel" in ('web', 'whatsapp')),
	CONSTRAINT "ad_stats_daily_counts_check" CHECK ("ad_stats_daily"."impressions" >= 0 and "ad_stats_daily"."clicks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"contact" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advertisers_category_check" CHECK ("advertisers"."category" in ('house', 'pharmacy_delivery', 'insurance', 'labs_clinics', 'health_devices', 'wellness_apps', 'education', 'retail', 'other', 'medicine'))
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "ads_free" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats_daily" ADD CONSTRAINT "ad_stats_daily_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_stats_daily" ADD CONSTRAINT "ad_stats_daily_placement_key_ad_placements_key_fk" FOREIGN KEY ("placement_key") REFERENCES "public"."ad_placements"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_creatives_status_idx" ON "ad_creatives" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_creatives_advertiser_idx" ON "ad_creatives" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "ad_stats_daily_day_idx" ON "ad_stats_daily" USING btree ("day");--> statement-breakpoint
-- Paid plans are ad-free by default (docs/ADS.md 1.7); the default (free) plan is not.
UPDATE "plans" SET "ads_free" = true WHERE "is_default" = false;--> statement-breakpoint
-- The placement catalog is code-defined; every placement ships disabled and the admin turns them on.
INSERT INTO "ad_placements" ("key", "page_classes", "max_per_page", "format", "size_desktop", "size_mobile", "closable", "dismiss_days", "allow_paid", "sort") VALUES
	('home.after_hero', ARRAY['marketing']::text[], 1, 'banner', '970x250', '320x100', false, 7, true, 10),
	('home.mid', ARRAY['marketing']::text[], 1, 'banner', '970x250', '320x100', false, 7, true, 20),
	('home.before_faq', ARRAY['marketing']::text[], 1, 'banner', '970x250', '320x100', false, 7, true, 30),
	('blog.feed', ARRAY['content']::text[], 2, 'native', 'native', 'native', false, 7, true, 40),
	('article.inline.1', ARRAY['content']::text[], 1, 'banner', '728x90', '320x100', false, 7, true, 50),
	('article.inline.2', ARRAY['content']::text[], 1, 'banner', '728x90', '300x250', false, 7, true, 60),
	('article.sidebar', ARRAY['content']::text[], 1, 'banner', '300x250', '300x250', false, 7, true, 70),
	('article.end', ARRAY['content']::text[], 1, 'native', 'native', 'native', false, 7, true, 80),
	('glossary.end', ARRAY['content']::text[], 1, 'native', 'native', 'native', false, 7, true, 90),
	('drug.sidebar', ARRAY['medical_reference']::text[], 1, 'banner', '300x250', '300x250', false, 7, true, 100),
	('drug.end', ARRAY['medical_reference']::text[], 1, 'native', 'native', 'native', false, 7, true, 110),
	('drugs.hub.mid', ARRAY['medical_reference']::text[], 1, 'banner', '970x250', '320x100', false, 7, true, 120),
	('search.top', ARRAY['utility_public']::text[], 1, 'banner', '728x90', '320x100', false, 7, true, 130),
	('app.dashboard.card', ARRAY['app_neutral']::text[], 1, 'native', 'native', 'native', false, 7, false, 140),
	('app.analyze.start', ARRAY['app_neutral']::text[], 1, 'native', 'native', '320x100', false, 7, false, 150),
	('app.analyze.waiting', ARRAY['app_neutral']::text[], 1, 'native', 'native', 'native', false, 7, false, 160),
	('global.bottom_banner', ARRAY['marketing', 'content', 'utility_public']::text[], 1, 'bottom_banner', '728x90', '320x50', true, 7, true, 5)
ON CONFLICT ("key") DO NOTHING;
