CREATE TABLE "growth_mail_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "growth_mail_log_kind_check" CHECK ("growth_mail_log"."kind" in ('day1_guide', 'day3_value', 'day6_offer', 'winback', 'last_call', 'value_recap')),
	CONSTRAINT "growth_mail_log_period_key_check" CHECK (char_length("growth_mail_log"."period_key") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "marketing_opted_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "marketing_opted_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "marketing_opted_out_via" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "marketing_silenced_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD COLUMN "source_analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD COLUMN "analysis_id" uuid;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD COLUMN "credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "growth_mail_log" ADD CONSTRAINT "growth_mail_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_mail_log_user_kind_period_key" ON "growth_mail_log" USING btree ("user_id","kind","period_key");--> statement-breakpoint
CREATE INDEX "growth_mail_log_user_sent_idx" ON "growth_mail_log" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX "growth_mail_log_sent_idx" ON "growth_mail_log" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "taste_grants" ADD CONSTRAINT "taste_grants_source_analysis_id_rx_analyses_id_fk" FOREIGN KEY ("source_analysis_id") REFERENCES "public"."rx_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD CONSTRAINT "taste_grants_analysis_id_rx_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."rx_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "taste_grants_analysis_idx" ON "taste_grants" USING btree ("analysis_id") WHERE "taste_grants"."analysis_id" is not null;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_marketing_opt_out_via_check" CHECK ("notification_prefs"."marketing_opted_out_via" is null or "notification_prefs"."marketing_opted_out_via" in ('unsubscribe_link', 'one_click', 'account', 'admin'));--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_marketing_opt_out_pair_check" CHECK (("notification_prefs"."marketing_opted_out_at" is null) = ("notification_prefs"."marketing_opted_out_via" is null));--> statement-breakpoint
ALTER TABLE "taste_grants" ADD CONSTRAINT "taste_grants_credits_check" CHECK ("taste_grants"."credits" >= 0);
--> statement-breakpoint
-- Each row is one sent lifecycle mail: never rewritten. DELETE stays for the 13-month retention job.
REVOKE UPDATE, TRUNCATE ON TABLE "growth_mail_log" FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "growth_mail_log" TO wasfa_api;
