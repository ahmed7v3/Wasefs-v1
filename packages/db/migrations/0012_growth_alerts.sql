CREATE TABLE "admin_alert_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"telegram_enabled" boolean DEFAULT true NOT NULL,
	"whatsapp_enabled" boolean DEFAULT false NOT NULL,
	"telegram_chat_id" text,
	"whatsapp_jid" text,
	"muted_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"ref_type" text,
	"ref_id" text,
	"summary" text NOT NULL,
	"link" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_alerts_kind_check" CHECK ("admin_alerts"."kind" in ('payment.review_needed', 'payment.review_overdue', 'payment.amount_mismatch', 'payment.failure_spike', 'withdrawal.requested', 'withdrawal.overdue', 'reward.fraud_flag', 'credits.reconcile_drift', 'points.reconcile_drift', 'refund.requested')),
	CONSTRAINT "admin_alerts_severity_check" CHECK ("admin_alerts"."severity" in ('info', 'warning', 'critical')),
	CONSTRAINT "admin_alerts_summary_check" CHECK (char_length("admin_alerts"."summary") between 1 and 500),
	CONSTRAINT "admin_alerts_ref_check" CHECK (("admin_alerts"."ref_type" is null) = ("admin_alerts"."ref_id" is null))
);
--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"alert_id" uuid NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_deliveries_alert_admin_channel_key" UNIQUE("alert_id","admin_user_id","channel"),
	CONSTRAINT "alert_deliveries_channel_check" CHECK ("alert_deliveries"."channel" in ('in_app', 'email', 'telegram', 'whatsapp')),
	CONSTRAINT "alert_deliveries_status_check" CHECK ("alert_deliveries"."status" in ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "alert_deliveries_attempts_check" CHECK ("alert_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"target_path" text DEFAULT '/' NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"referral_code_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_links_slug_key" UNIQUE("slug"),
	CONSTRAINT "campaign_links_slug_check" CHECK ("campaign_links"."slug" ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
	CONSTRAINT "campaign_links_target_path_check" CHECK ("campaign_links"."target_path" ~ '^/([^/].*)?$'),
	CONSTRAINT "campaign_links_utm_check" CHECK (jsonb_typeof("campaign_links"."utm") = 'object')
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"flag_key" text NOT NULL,
	"variants" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"min_sample_size" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiments_key_key" UNIQUE("key"),
	CONSTRAINT "experiments_key_check" CHECK ("experiments"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "experiments_flag_key_check" CHECK ("experiments"."flag_key" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "experiments_status_check" CHECK ("experiments"."status" in ('draft', 'running', 'stopped', 'completed')),
	CONSTRAINT "experiments_variants_check" CHECK (case when jsonb_typeof("experiments"."variants") = 'array' then jsonb_array_length("experiments"."variants") between 2 and 10 else false end),
	CONSTRAINT "experiments_min_sample_check" CHECK ("experiments"."min_sample_size" is null or "experiments"."min_sample_size" > 0),
	CONSTRAINT "experiments_period_check" CHECK ("experiments"."started_at" is null or "experiments"."ended_at" is null or "experiments"."ended_at" >= "experiments"."started_at")
);
--> statement-breakpoint
CREATE TABLE "growth_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"session_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variant" text,
	CONSTRAINT "growth_events_name_check" CHECK ("growth_events"."name" in ('pricing_viewed', 'plan_selected', 'checkout_started', 'method_selected', 'payment_submitted', 'payment_succeeded', 'payment_failed', 'proof_submitted', 'prompt_shown', 'prompt_clicked', 'prompt_dismissed', 'taste_started', 'taste_completed', 'offer_shown', 'offer_used', 'referral_link_opened', 'referral_signup', 'referral_paid', 'coupon_applied', 'coupon_failed')),
	CONSTRAINT "growth_events_session_check" CHECK (char_length("growth_events"."session_id") between 8 and 64),
	CONSTRAINT "growth_events_props_check" CHECK (jsonb_typeof("growth_events"."props") = 'object' and octet_length("growth_events"."props"::text) <= 2048)
);
--> statement-breakpoint
CREATE TABLE "growth_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promotion_id" uuid,
	"validity_hours" integer NOT NULL,
	"per_owner_limit" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_rules_key_key" UNIQUE("key"),
	CONSTRAINT "growth_rules_key_check" CHECK ("growth_rules"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "growth_rules_kind_check" CHECK ("growth_rules"."kind" in ('welcome', 'winback', 'renewal', 'taste')),
	CONSTRAINT "growth_rules_condition_check" CHECK (jsonb_typeof("growth_rules"."condition") = 'object'),
	CONSTRAINT "growth_rules_validity_check" CHECK ("growth_rules"."validity_hours" between 1 and 8760),
	CONSTRAINT "growth_rules_per_owner_limit_check" CHECK ("growth_rules"."per_owner_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "phi_access_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phi_access_sessions_reason_check" CHECK ("phi_access_sessions"."reason" in ('support_request', 'dispute', 'fraud_review', 'quality_review')),
	CONSTRAINT "phi_access_sessions_expires_check" CHECK ("phi_access_sessions"."expires_at" > "phi_access_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notes_body_check" CHECK (char_length(btrim("user_notes"."body")) between 1 and 4000)
);
--> statement-breakpoint
ALTER TABLE "admin_alert_prefs" ADD CONSTRAINT "admin_alert_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_alert_id_admin_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."admin_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_events" ADD CONSTRAINT "growth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_rules" ADD CONSTRAINT "growth_rules_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phi_access_sessions" ADD CONSTRAINT "phi_access_sessions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phi_access_sessions" ADD CONSTRAINT "phi_access_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notes" ADD CONSTRAINT "user_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_alerts_created_idx" ON "admin_alerts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_alerts_open_idx" ON "admin_alerts" USING btree ("kind","created_at") WHERE "admin_alerts"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "admin_alerts_ref_idx" ON "admin_alerts" USING btree ("ref_type","ref_id") WHERE "admin_alerts"."ref_type" is not null;--> statement-breakpoint
CREATE INDEX "alert_deliveries_admin_inapp_idx" ON "alert_deliveries" USING btree ("admin_user_id","created_at" DESC NULLS LAST) WHERE "alert_deliveries"."channel" = 'in_app';--> statement-breakpoint
CREATE INDEX "alert_deliveries_pending_idx" ON "alert_deliveries" USING btree ("created_at") WHERE "alert_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "growth_events_name_occurred_idx" ON "growth_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "growth_events_occurred_idx" ON "growth_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "growth_events_user_occurred_idx" ON "growth_events" USING btree ("user_id","occurred_at") WHERE "growth_events"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "phi_access_sessions_admin_user_expires_idx" ON "phi_access_sessions" USING btree ("admin_user_id","user_id","expires_at");--> statement-breakpoint
CREATE INDEX "user_notes_user_created_idx" ON "user_notes" USING btree ("user_id","created_at" DESC NULLS LAST);