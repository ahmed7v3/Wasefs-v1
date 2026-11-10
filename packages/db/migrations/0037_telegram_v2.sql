CREATE TABLE "telegram_ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"advertiser" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"daily_impression_cap" integer,
	"total_impression_cap" integer,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_ad_campaigns_status_check" CHECK ("telegram_ad_campaigns"."status" in ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "telegram_ad_campaigns_schedule_check" CHECK ("telegram_ad_campaigns"."starts_at" is null or "telegram_ad_campaigns"."ends_at" is null or "telegram_ad_campaigns"."starts_at" < "telegram_ad_campaigns"."ends_at"),
	CONSTRAINT "telegram_ad_campaigns_caps_check" CHECK (("telegram_ad_campaigns"."daily_impression_cap" is null or "telegram_ad_campaigns"."daily_impression_cap" >= 1) and ("telegram_ad_campaigns"."total_impression_cap" is null or "telegram_ad_campaigns"."total_impression_cap" >= 1))
);
--> statement-breakpoint
CREATE TABLE "telegram_ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"layout" text DEFAULT 'hero' NOT NULL,
	"headline" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_media_id" uuid,
	"buttons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"buttons_per_row" smallint DEFAULT 1 NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"weight" integer DEFAULT 100 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"targeting" jsonb DEFAULT '{"locales":[],"audience":"all","triggers":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_ad_creatives_status_check" CHECK ("telegram_ad_creatives"."status" in ('draft', 'approved', 'paused', 'archived')),
	CONSTRAINT "telegram_ad_creatives_layout_check" CHECK ("telegram_ad_creatives"."layout" in ('hero', 'card', 'compact')),
	CONSTRAINT "telegram_ad_creatives_weight_check" CHECK ("telegram_ad_creatives"."weight" between 1 and 1000),
	CONSTRAINT "telegram_ad_creatives_per_row_check" CHECK ("telegram_ad_creatives"."buttons_per_row" in (1, 2)),
	CONSTRAINT "telegram_ad_creatives_schedule_check" CHECK ("telegram_ad_creatives"."starts_at" is null or "telegram_ad_creatives"."ends_at" is null or "telegram_ad_creatives"."starts_at" < "telegram_ad_creatives"."ends_at"),
	CONSTRAINT "telegram_ad_creatives_no_medicine_check" CHECK ("telegram_ad_creatives"."status" <> 'approved' or "telegram_ad_creatives"."category" <> 'medicine')
);
--> statement-breakpoint
CREATE TABLE "telegram_ad_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"creative_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"trigger" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_ad_events_kind_check" CHECK ("telegram_ad_events"."kind" in ('impression', 'click', 'reaction', 'hide'))
);
--> statement-breakpoint
ALTER TABLE "ai_task_routes" DROP CONSTRAINT "ai_task_routes_task_check";--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_task_check";--> statement-breakpoint
ALTER TABLE "plan_entitlements" DROP CONSTRAINT "plan_entitlements_task_check";--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD COLUMN "ads_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_ad_creatives" ADD CONSTRAINT "telegram_ad_creatives_campaign_id_telegram_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."telegram_ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_ad_creatives" ADD CONSTRAINT "telegram_ad_creatives_image_media_id_media_assets_id_fk" FOREIGN KEY ("image_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_ad_events" ADD CONSTRAINT "telegram_ad_events_creative_id_telegram_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."telegram_ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_ad_creatives_campaign_idx" ON "telegram_ad_creatives" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "telegram_ad_creatives_status_idx" ON "telegram_ad_creatives" USING btree ("status");--> statement-breakpoint
CREATE INDEX "telegram_ad_events_created_idx" ON "telegram_ad_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "telegram_ad_events_creative_created_idx" ON "telegram_ad_events" USING btree ("creative_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_ad_events_campaign_created_idx" ON "telegram_ad_events" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "telegram_ad_events_chat_created_kind_idx" ON "telegram_ad_events" USING btree ("chat_id","created_at","kind");--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_task_check" CHECK ("ai_task_routes"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent', 'telegram_agent'));--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_task_check" CHECK ("ai_usage"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent', 'telegram_agent'));--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_task_check" CHECK ("plan_entitlements"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent', 'telegram_agent'));
--> statement-breakpoint
-- Append to the generated migration that widens the AI_TASKS CHECK constraints with 'telegram_agent'
-- (it must run AFTER those constraints are replaced). Idempotent: safe to run twice.
-- Existing installs: seeds are insert-only, so give the new task the same routes and plan
-- entitlements wa_agent already has (an admin tunes them afterwards under AI > Routes / Plans).

-- ai_task_routes: unique on (task, coalesce(plan_id, nil-uuid), mode) -> ON CONFLICT DO NOTHING without a target.
INSERT INTO ai_task_routes (task, plan_id, mode, models, version)
SELECT 'telegram_agent', plan_id, mode, models, 1
FROM ai_task_routes
WHERE task = 'wa_agent'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- plan_entitlements: primary key (plan_id, task).
INSERT INTO plan_entitlements (plan_id, task, allowed, modes, daily_cap, monthly_cap, max_pages_per_rx, web_search)
SELECT plan_id, 'telegram_agent', allowed, modes, daily_cap, monthly_cap, max_pages_per_rx, web_search
FROM plan_entitlements
WHERE task = 'wa_agent'
ON CONFLICT DO NOTHING;
