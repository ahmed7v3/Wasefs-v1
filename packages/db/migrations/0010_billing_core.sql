CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "credit_pack_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"pack_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_pack_prices_pack_currency_key" UNIQUE("pack_id","currency"),
	CONSTRAINT "credit_pack_prices_currency_check" CHECK ("credit_pack_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "credit_pack_prices_amount_check" CHECK ("credit_pack_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_packs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"credits" integer NOT NULL,
	"bonus_credits" integer DEFAULT 0 NOT NULL,
	"valid_months" integer DEFAULT 12 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_packs_key_key" UNIQUE("key"),
	CONSTRAINT "credit_packs_key_check" CHECK ("credit_packs"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "credit_packs_credits_check" CHECK ("credit_packs"."credits" > 0),
	CONSTRAINT "credit_packs_bonus_credits_check" CHECK ("credit_packs"."bonus_credits" >= 0),
	CONSTRAINT "credit_packs_valid_months_check" CHECK ("credit_packs"."valid_months" between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text DEFAULT ('WSO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('order_number_seq')::text, 6, '0')) NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"kind" text NOT NULL,
	"plan_id" uuid,
	"pack_id" uuid,
	"months" integer,
	"currency" text NOT NULL,
	"quote" jsonb NOT NULL,
	"quote_hash" text NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"applied" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"payment_kind" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_key" UNIQUE("number"),
	CONSTRAINT "orders_owner_check" CHECK (num_nonnulls("orders"."owner_user_id", "orders"."owner_org_id") = 1),
	CONSTRAINT "orders_kind_check" CHECK ("orders"."kind" in ('subscription', 'upgrade', 'credit_pack')),
	CONSTRAINT "orders_status_check" CHECK ("orders"."status" in ('pending_payment', 'paid', 'partially_refunded', 'refunded', 'expired', 'canceled')),
	CONSTRAINT "orders_payment_kind_check" CHECK ("orders"."payment_kind" is null or "orders"."payment_kind" in ('gateway', 'manual', 'free')),
	CONSTRAINT "orders_currency_check" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_months_check" CHECK ("orders"."months" is null or "orders"."months" between 1 and 24),
	CONSTRAINT "orders_refs_check" CHECK (("orders"."kind" = 'credit_pack' and "orders"."pack_id" is not null)
        or ("orders"."kind" in ('subscription', 'upgrade') and "orders"."plan_id" is not null and "orders"."months" is not null)),
	CONSTRAINT "orders_quote_hash_check" CHECK ("orders"."quote_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."tax_minor" >= 0 and "orders"."fee_minor" >= 0 and "orders"."total_minor" >= 0),
	CONSTRAINT "orders_paid_at_check" CHECK ("orders"."status" in ('pending_payment', 'expired', 'canceled') or "orders"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_topic_check" CHECK ("outbox"."topic" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "outbox_attempts_check" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payment_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signature_ok" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_events_provider_event_id_key" UNIQUE("provider","event_id"),
	CONSTRAINT "payment_events_payload_check" CHECK (jsonb_typeof("payment_events"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "payment_gateways" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'test' NOT NULL,
	"credentials_enc" text,
	"key_hint" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_gateways_key_key" UNIQUE("key"),
	CONSTRAINT "payment_gateways_key_check" CHECK ("payment_gateways"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payment_gateways_provider_check" CHECK ("payment_gateways"."provider" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payment_gateways_mode_check" CHECK ("payment_gateways"."mode" in ('test', 'live'))
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"instructions_ar" text,
	"instructions_en" text,
	"account_display" text,
	"account_holder" text,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"fee_fixed_minor" integer DEFAULT 0 NOT NULL,
	"min_amount_minor" integer,
	"max_amount_minor" integer,
	"currencies" text[] NOT NULL,
	"countries" text[],
	"requires_proof" boolean DEFAULT false NOT NULL,
	"review_sla_minutes" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_key_key" UNIQUE("key"),
	CONSTRAINT "payment_methods_key_check" CHECK ("payment_methods"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payment_methods_kind_check" CHECK ("payment_methods"."kind" in ('gateway', 'manual')),
	CONSTRAINT "payment_methods_provider_check" CHECK ("payment_methods"."provider" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payment_methods_fee_bps_check" CHECK ("payment_methods"."fee_bps" between 0 and 10000),
	CONSTRAINT "payment_methods_fee_fixed_check" CHECK ("payment_methods"."fee_fixed_minor" >= 0),
	CONSTRAINT "payment_methods_amount_range_check" CHECK (("payment_methods"."min_amount_minor" is null or "payment_methods"."min_amount_minor" >= 0)
        and ("payment_methods"."max_amount_minor" is null or "payment_methods"."max_amount_minor" >= 0)
        and ("payment_methods"."min_amount_minor" is null or "payment_methods"."max_amount_minor" is null or "payment_methods"."max_amount_minor" >= "payment_methods"."min_amount_minor")),
	CONSTRAINT "payment_methods_currencies_check" CHECK (cardinality("payment_methods"."currencies") >= 1),
	CONSTRAINT "payment_methods_config_check" CHECK (jsonb_typeof("payment_methods"."config") = 'object'),
	CONSTRAINT "payment_methods_review_sla_check" CHECK ("payment_methods"."review_sla_minutes" is null or "payment_methods"."review_sla_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"method_key" text NOT NULL,
	"gateway" text,
	"status" text DEFAULT 'created' NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"provider_ref" text,
	"sender_phone_masked" text,
	"txn_id" text,
	"proof_file_id" uuid,
	"proof_submissions" integer DEFAULT 0 NOT NULL,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"second_approved_by" uuid,
	"second_approved_at" timestamp with time zone,
	"review_note" text,
	"reject_reason" text,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_reference_key" UNIQUE("reference"),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('created', 'awaiting_customer', 'processing', 'awaiting_review', 'awaiting_second_approval', 'succeeded', 'failed', 'rejected', 'canceled', 'expired', 'partially_refunded', 'refunded')),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_proof_submissions_check" CHECK ("payments"."proof_submissions" between 0 and 3),
	CONSTRAINT "payments_flags_check" CHECK (jsonb_typeof("payments"."flags") = 'array')
);
--> statement-breakpoint
CREATE TABLE "plan_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plan_id" uuid NOT NULL,
	"months" integer NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_prices_plan_months_currency_key" UNIQUE("plan_id","months","currency"),
	CONSTRAINT "plan_prices_months_check" CHECK ("plan_prices"."months" between 1 and 24),
	CONSTRAINT "plan_prices_currency_check" CHECK ("plan_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "plan_prices_amount_check" CHECK ("plan_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_by" uuid,
	"approved_by" uuid,
	"provider_ref" text,
	"transfer_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_status_check" CHECK ("refunds"."status" in ('requested', 'approved', 'succeeded', 'failed', 'rejected')),
	CONSTRAINT "refunds_currency_check" CHECK ("refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "refunds_amount_check" CHECK ("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_reason_check" CHECK (char_length(btrim("refunds"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"country" text,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"mode" text NOT NULL,
	"applies_to" text DEFAULT 'all' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rules_country_check" CHECK ("tax_rules"."country" is null or "tax_rules"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "tax_rules_rate_bps_check" CHECK ("tax_rules"."rate_bps" between 0 and 10000),
	CONSTRAINT "tax_rules_mode_check" CHECK ("tax_rules"."mode" in ('added', 'inclusive')),
	CONSTRAINT "tax_rules_applies_to_check" CHECK ("tax_rules"."applies_to" in ('all', 'subscription', 'credit_pack'))
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	CONSTRAINT "coupon_redemptions_coupon_order_key" UNIQUE("coupon_id","order_id"),
	CONSTRAINT "coupon_redemptions_owner_check" CHECK (num_nonnulls("coupon_redemptions"."owner_user_id", "coupon_redemptions"."owner_org_id") = 1),
	CONSTRAINT "coupon_redemptions_status_check" CHECK ("coupon_redemptions"."status" in ('reserved', 'confirmed', 'released'))
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"badge_ar" text,
	"badge_en" text,
	"value" integer NOT NULL,
	"currency" text,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"months" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"audience" text DEFAULT 'any' NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"new_customers_only" boolean DEFAULT false NOT NULL,
	"min_amount_minor" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"per_owner_limit" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"stacking" text DEFAULT 'exclusive' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_user_id" uuid,
	"target_org_id" uuid,
	"campaign" text,
	"batch" text,
	CONSTRAINT "coupons_code_key" UNIQUE("code"),
	CONSTRAINT "coupons_kind_check" CHECK ("coupons"."kind" in ('percent', 'fixed', 'bonus_credits', 'extra_months', 'trial_extension')),
	CONSTRAINT "coupons_value_check" CHECK ("coupons"."value" >= 0 and ("coupons"."kind" <> 'percent' or "coupons"."value" between 1 and 10000)),
	CONSTRAINT "coupons_currency_check" CHECK (("coupons"."kind" = 'fixed') = ("coupons"."currency" is not null) and ("coupons"."currency" is null or "coupons"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "coupons_audience_check" CHECK ("coupons"."audience" in ('individual', 'organization', 'any')),
	CONSTRAINT "coupons_min_amount_check" CHECK ("coupons"."min_amount_minor" is null or "coupons"."min_amount_minor" >= 0),
	CONSTRAINT "coupons_period_check" CHECK ("coupons"."starts_at" is null or "coupons"."ends_at" is null or "coupons"."ends_at" > "coupons"."starts_at"),
	CONSTRAINT "coupons_max_redemptions_check" CHECK ("coupons"."max_redemptions" is null or "coupons"."max_redemptions" > 0),
	CONSTRAINT "coupons_per_owner_limit_check" CHECK ("coupons"."per_owner_limit" is null or "coupons"."per_owner_limit" > 0),
	CONSTRAINT "coupons_redeemed_count_check" CHECK ("coupons"."redeemed_count" >= 0 and ("coupons"."max_redemptions" is null or "coupons"."redeemed_count" <= "coupons"."max_redemptions")),
	CONSTRAINT "coupons_stacking_check" CHECK ("coupons"."stacking" in ('exclusive', 'stack_with_other')),
	CONSTRAINT "coupons_status_check" CHECK ("coupons"."status" in ('draft', 'scheduled', 'active', 'paused', 'ended')),
	CONSTRAINT "coupons_code_check" CHECK ("coupons"."code" ~ '^[A-Z0-9-]{4,32}$'),
	CONSTRAINT "coupons_target_check" CHECK (num_nonnulls("coupons"."target_user_id", "coupons"."target_org_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"badge_ar" text,
	"badge_en" text,
	"value" integer NOT NULL,
	"currency" text,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"months" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"audience" text DEFAULT 'any' NOT NULL,
	"countries" text[] DEFAULT '{}'::text[] NOT NULL,
	"new_customers_only" boolean DEFAULT false NOT NULL,
	"min_amount_minor" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"per_owner_limit" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"stacking" text DEFAULT 'exclusive' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"show_on_pricing" boolean DEFAULT false NOT NULL,
	"show_countdown" boolean DEFAULT false NOT NULL,
	CONSTRAINT "promotions_kind_check" CHECK ("promotions"."kind" in ('percent', 'fixed', 'bonus_credits', 'extra_months')),
	CONSTRAINT "promotions_value_check" CHECK ("promotions"."value" >= 0 and ("promotions"."kind" <> 'percent' or "promotions"."value" between 1 and 10000)),
	CONSTRAINT "promotions_currency_check" CHECK (("promotions"."kind" = 'fixed') = ("promotions"."currency" is not null) and ("promotions"."currency" is null or "promotions"."currency" ~ '^[A-Z]{3}$')),
	CONSTRAINT "promotions_audience_check" CHECK ("promotions"."audience" in ('individual', 'organization', 'any')),
	CONSTRAINT "promotions_min_amount_check" CHECK ("promotions"."min_amount_minor" is null or "promotions"."min_amount_minor" >= 0),
	CONSTRAINT "promotions_period_check" CHECK ("promotions"."starts_at" is null or "promotions"."ends_at" is null or "promotions"."ends_at" > "promotions"."starts_at"),
	CONSTRAINT "promotions_max_redemptions_check" CHECK ("promotions"."max_redemptions" is null or "promotions"."max_redemptions" > 0),
	CONSTRAINT "promotions_per_owner_limit_check" CHECK ("promotions"."per_owner_limit" is null or "promotions"."per_owner_limit" > 0),
	CONSTRAINT "promotions_redeemed_count_check" CHECK ("promotions"."redeemed_count" >= 0 and ("promotions"."max_redemptions" is null or "promotions"."redeemed_count" <= "promotions"."max_redemptions")),
	CONSTRAINT "promotions_stacking_check" CHECK ("promotions"."stacking" in ('exclusive', 'stack_with_other')),
	CONSTRAINT "promotions_status_check" CHECK ("promotions"."status" in ('draft', 'scheduled', 'active', 'paused', 'ended')),
	CONSTRAINT "promotions_countdown_check" CHECK (not "promotions"."show_countdown" or "promotions"."ends_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "personal_offers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"promotion_id" uuid,
	"coupon_id" uuid,
	"rule_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"shown_count" integer DEFAULT 0 NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_offers_kind_check" CHECK ("personal_offers"."kind" in ('welcome', 'winback', 'renewal', 'taste')),
	CONSTRAINT "personal_offers_template_check" CHECK (num_nonnulls("personal_offers"."promotion_id", "personal_offers"."coupon_id") <= 1),
	CONSTRAINT "personal_offers_shown_count_check" CHECK ("personal_offers"."shown_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_events_type_check" CHECK ("subscription_events"."type" in ('created', 'renewed', 'upgraded', 'downgraded_scheduled', 'grace_started', 'expired', 'canceled', 'admin_changed', 'refund_applied')),
	CONSTRAINT "subscription_events_data_check" CHECK (jsonb_typeof("subscription_events"."data") = 'object')
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"months_paid" integer DEFAULT 0 NOT NULL,
	"last_order_id" uuid,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"grace_until" timestamp with time zone,
	"pending_change" jsonb,
	"price_snapshot" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_owner_check" CHECK (num_nonnulls("subscriptions"."owner_user_id", "subscriptions"."owner_org_id") = 1),
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'grace', 'expired', 'canceled')),
	CONSTRAINT "subscriptions_source_check" CHECK ("subscriptions"."source" in ('paid', 'trial', 'admin_grant', 'deal', 'promo')),
	CONSTRAINT "subscriptions_period_check" CHECK ("subscriptions"."current_period_end" > "subscriptions"."current_period_start"),
	CONSTRAINT "subscriptions_months_paid_check" CHECK ("subscriptions"."months_paid" >= 0)
);
--> statement-breakpoint
CREATE TABLE "taste_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"feature" text NOT NULL,
	"period_key" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "taste_grants_owner_check" CHECK (num_nonnulls("taste_grants"."owner_user_id", "taste_grants"."owner_org_id") = 1),
	CONSTRAINT "taste_grants_feature_check" CHECK ("taste_grants"."feature" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "taste_grants_period_key_check" CHECK (char_length("taste_grants"."period_key") between 1 and 32),
	CONSTRAINT "taste_grants_expires_check" CHECK ("taste_grants"."expires_at" > "taste_grants"."granted_at")
);
--> statement-breakpoint
CREATE TABLE "user_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notifications_kind_check" CHECK ("user_notifications"."kind" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "user_notifications_params_check" CHECK (jsonb_typeof("user_notifications"."params") = 'object')
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_kind_check";--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD COLUMN "subscription_id" uuid;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tagline_ar" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "tagline_en" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "trial_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "pin_recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_members" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "fair_use_note_ar" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "fair_use_note_en" text;--> statement-breakpoint
ALTER TABLE "credit_pack_prices" ADD CONSTRAINT "credit_pack_prices_pack_id_credit_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."credit_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pack_id_credit_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."credit_packs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_file_id_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_second_approved_by_users_id_fk" FOREIGN KEY ("second_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_offers" ADD CONSTRAINT "personal_offers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_offers" ADD CONSTRAINT "personal_offers_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_offers" ADD CONSTRAINT "personal_offers_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_last_order_id_orders_id_fk" FOREIGN KEY ("last_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD CONSTRAINT "taste_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taste_grants" ADD CONSTRAINT "taste_grants_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_owner_user_created_idx" ON "orders" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_owner_org_created_idx" ON "orders" USING btree ("owner_org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_pending_expires_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_idempotency_key_key" ON "outbox" USING btree ("idempotency_key") WHERE "outbox"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("available_at") WHERE "outbox"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "payment_events_payment_received_idx" ON "payment_events" USING btree ("payment_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_provider_ref_key" ON "payments" USING btree ("gateway","provider_ref") WHERE "payments"."provider_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_method_txn_id_key" ON "payments" USING btree ("method_key","txn_id") WHERE "payments"."txn_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_review_queue_idx" ON "payments" USING btree ("created_at") WHERE "payments"."status" in ('awaiting_review', 'awaiting_second_approval');--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_provider_ref_key" ON "refunds" USING btree ("provider_ref") WHERE "refunds"."provider_ref" is not null;--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_owner_user_idx" ON "coupon_redemptions" USING btree ("coupon_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_coupon_owner_org_idx" ON "coupon_redemptions" USING btree ("coupon_id","owner_org_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_order_idx" ON "coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "coupons_batch_idx" ON "coupons" USING btree ("batch") WHERE "coupons"."batch" is not null;--> statement-breakpoint
CREATE INDEX "promotions_status_starts_idx" ON "promotions" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "personal_offers_owner_expires_idx" ON "personal_offers" USING btree ("owner_user_id","expires_at");--> statement-breakpoint
CREATE INDEX "subscription_events_subscription_created_idx" ON "subscription_events" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_owner_user_live_key" ON "subscriptions" USING btree ("owner_user_id") WHERE "subscriptions"."status" in ('trialing', 'active', 'grace');--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_owner_org_live_key" ON "subscriptions" USING btree ("owner_org_id") WHERE "subscriptions"."status" in ('trialing', 'active', 'grace');--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end") WHERE "subscriptions"."status" in ('trialing', 'active', 'grace');--> statement-breakpoint
CREATE UNIQUE INDEX "taste_grants_owner_user_period_key" ON "taste_grants" USING btree ("owner_user_id","feature","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "taste_grants_owner_org_period_key" ON "taste_grants" USING btree ("owner_org_id","feature","period_key");--> statement-breakpoint
CREATE INDEX "user_notifications_user_created_idx" ON "user_notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_notifications_unread_idx" ON "user_notifications" USING btree ("user_id") WHERE "user_notifications"."read_at" is null;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_assignments_subscription_idx" ON "plan_assignments" USING btree ("subscription_id") WHERE "plan_assignments"."subscription_id" is not null;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_kind_check" CHECK ("credit_ledger"."kind" in ('grant', 'admin_adjust', 'usage_reserve', 'usage_settle', 'release', 'refund', 'expiry', 'purchase', 'points_conversion', 'trial_grant', 'reward_bonus'));--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_features_check" CHECK (case when jsonb_typeof("plans"."features") = 'array' then jsonb_array_length("plans"."features") <= 30 else false end);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_trial_days_check" CHECK ("plans"."trial_days" between 0 and 365);--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_max_members_check" CHECK ("plans"."max_members" is null or "plans"."max_members" > 0);--> statement-breakpoint
-- Permission names may now contain an underscore (users.read_health, users.read_chats).
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_check";--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK ("role_permissions"."permission" ~ '^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$');
--> statement-breakpoint
-- Append-only, like credit_ledger (0008) and audit_logs (0005): the default privileges gave wasfa_api
-- UPDATE and DELETE on every new table, so take them back. The API can only record and read rows; a
-- correction is a new row. The owner role (migrations, retention) is unaffected.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE payment_events FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE payment_events TO wasfa_api;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE subscription_events FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE subscription_events TO wasfa_api;
--> statement-breakpoint
-- The default of orders.number calls nextval(), which is checked against the calling role.
GRANT USAGE, SELECT ON SEQUENCE order_number_seq TO wasfa_api;
--> statement-breakpoint
-- Data migration (DATABASE.md seed policy): the seed never touches an existing role, so the new
-- Phase 3 permissions reach the existing finance / support / marketing / admin roles here. A role
-- that does not exist yet (fresh database) gets them from the seed instead. super_admin is a wildcard.
INSERT INTO "role_permissions" ("role_key", "permission")
SELECT "r"."key", "v"."permission"
FROM (VALUES
  ('finance', 'billing.read'),
  ('finance', 'billing.write'),
  ('finance', 'payments.review'),
  ('finance', 'payments.refund'),
  ('finance', 'withdrawals.review'),
  ('finance', 'withdrawals.pay'),
  ('finance', 'finance.export'),
  ('finance', 'alerts.receive'),
  ('support', 'billing.read'),
  ('support', 'users.upgrade'),
  ('marketing', 'promotions.write'),
  ('marketing', 'coupons.write'),
  ('marketing', 'referrals.read'),
  ('marketing', 'referrals.write'),
  ('marketing', 'deals.write'),
  ('admin', 'billing.read'),
  ('admin', 'billing.write'),
  ('admin', 'payments.review'),
  ('admin', 'payments.refund'),
  ('admin', 'promotions.write'),
  ('admin', 'coupons.write'),
  ('admin', 'referrals.read'),
  ('admin', 'referrals.write'),
  ('admin', 'rewards.adjust'),
  ('admin', 'withdrawals.review'),
  ('admin', 'deals.write'),
  ('admin', 'users.upgrade'),
  ('admin', 'finance.export'),
  ('admin', 'alerts.receive')
) AS "v"("role_key", "permission")
JOIN "roles" AS "r" ON "r"."key" = "v"."role_key"
ON CONFLICT DO NOTHING;
