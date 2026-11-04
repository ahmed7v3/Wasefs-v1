CREATE TABLE "early_access_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" text NOT NULL,
	"visitor_hash" text,
	"type" text NOT NULL,
	"campaign_link_id" uuid,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"referrer_host" text,
	"country" text,
	"region" text,
	"city" text,
	"timezone" text,
	"device" text,
	"browser" text,
	"os" text,
	"lang" text,
	"variant" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	CONSTRAINT "early_access_events_type_check" CHECK ("early_access_events"."type" in ('view', 'phone_focus', 'phone_submit', 'details_view', 'details_submit', 'share')),
	CONSTRAINT "early_access_events_device_check" CHECK ("early_access_events"."device" is null or "early_access_events"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "early_access_events_variant_check" CHECK ("early_access_events"."variant" is null or "early_access_events"."variant" in ('a', 'b', 'c')),
	CONSTRAINT "early_access_events_utm_check" CHECK (jsonb_typeof("early_access_events"."utm") = 'object')
);
--> statement-breakpoint
CREATE TABLE "early_access_signups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_country" text NOT NULL,
	"name" text,
	"role" text,
	"variant" text,
	"session_id" text,
	"probe_price_minor" integer NOT NULL,
	"probe_currency" text NOT NULL,
	"probe_answer" text,
	"fair_price_minor" integer,
	"fair_price_currency" text,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"ref_code" text NOT NULL,
	"referred_by_id" uuid,
	"country" text,
	"region" text,
	"city" text,
	"timezone" text,
	"lat_approx" numeric(5, 2),
	"lon_approx" numeric(5, 2),
	"device" text,
	"browser" text,
	"os" text,
	"lang" text,
	"referrer_host" text,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campaign_link_id" uuid,
	"first_seen_at" timestamp with time zone,
	"time_to_submit_ms" integer,
	"steps_completed" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"admin_note" text,
	"privacy_ack_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_access_signups_phone_key" UNIQUE("phone_e164"),
	CONSTRAINT "early_access_signups_ref_code_key" UNIQUE("ref_code"),
	CONSTRAINT "early_access_signups_role_check" CHECK ("early_access_signups"."role" is null or "early_access_signups"."role" in ('patient', 'caregiver', 'doctor', 'pharmacist', 'pharmacy_owner', 'clinic_owner', 'medical_student', 'other')),
	CONSTRAINT "early_access_signups_variant_check" CHECK ("early_access_signups"."variant" is null or "early_access_signups"."variant" in ('a', 'b', 'c')),
	CONSTRAINT "early_access_signups_probe_currency_check" CHECK ("early_access_signups"."probe_currency" in ('EGP', 'SAR', 'AED', 'USD')),
	CONSTRAINT "early_access_signups_probe_answer_check" CHECK ("early_access_signups"."probe_answer" is null or "early_access_signups"."probe_answer" in ('yes', 'maybe', 'no')),
	CONSTRAINT "early_access_signups_fair_currency_check" CHECK ("early_access_signups"."fair_price_currency" is null or "early_access_signups"."fair_price_currency" in ('EGP', 'SAR', 'AED', 'USD')),
	CONSTRAINT "early_access_signups_device_check" CHECK ("early_access_signups"."device" is null or "early_access_signups"."device" in ('mobile', 'tablet', 'desktop')),
	CONSTRAINT "early_access_signups_status_check" CHECK ("early_access_signups"."status" in ('new', 'contacted', 'invited', 'converted')),
	CONSTRAINT "early_access_signups_steps_check" CHECK ("early_access_signups"."steps_completed" in (1, 2)),
	CONSTRAINT "early_access_signups_probe_price_check" CHECK ("early_access_signups"."probe_price_minor" > 0),
	CONSTRAINT "early_access_signups_utm_check" CHECK (jsonb_typeof("early_access_signups"."utm") = 'object')
);
--> statement-breakpoint
ALTER TABLE "early_access_events" ADD CONSTRAINT "early_access_events_campaign_link_id_campaign_links_id_fk" FOREIGN KEY ("campaign_link_id") REFERENCES "public"."campaign_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_access_signups" ADD CONSTRAINT "early_access_signups_referred_by_id_early_access_signups_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."early_access_signups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_access_signups" ADD CONSTRAINT "early_access_signups_campaign_link_id_campaign_links_id_fk" FOREIGN KEY ("campaign_link_id") REFERENCES "public"."campaign_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "early_access_events_occurred_idx" ON "early_access_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "early_access_events_type_occurred_idx" ON "early_access_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "early_access_events_country_city_idx" ON "early_access_events" USING btree ("country","city");--> statement-breakpoint
CREATE INDEX "early_access_events_campaign_idx" ON "early_access_events" USING btree ("campaign_link_id");--> statement-breakpoint
CREATE INDEX "early_access_events_session_idx" ON "early_access_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "early_access_signups_created_idx" ON "early_access_signups" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "early_access_signups_country_city_idx" ON "early_access_signups" USING btree ("country","city");--> statement-breakpoint
CREATE INDEX "early_access_signups_role_idx" ON "early_access_signups" USING btree ("role");--> statement-breakpoint
CREATE INDEX "early_access_signups_campaign_idx" ON "early_access_signups" USING btree ("campaign_link_id");--> statement-breakpoint
CREATE INDEX "early_access_signups_referred_by_idx" ON "early_access_signups" USING btree ("referred_by_id");