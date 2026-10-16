CREATE TABLE "deal_targets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"deal_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_user_id" uuid,
	"target_org_id" uuid,
	"referral_code_id" uuid,
	"email_domain" text,
	"member_only" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_targets_kind_check" CHECK ("deal_targets"."target_kind" in ('user', 'organization', 'referral_code', 'email_domain')),
	CONSTRAINT "deal_targets_target_check" CHECK (num_nonnulls("deal_targets"."target_user_id", "deal_targets"."target_org_id", "deal_targets"."referral_code_id", "deal_targets"."email_domain") = 1
        and (
          ("deal_targets"."target_kind" = 'user' and "deal_targets"."target_user_id" is not null)
          or ("deal_targets"."target_kind" = 'organization' and "deal_targets"."target_org_id" is not null)
          or ("deal_targets"."target_kind" = 'referral_code' and "deal_targets"."referral_code_id" is not null)
          or ("deal_targets"."target_kind" = 'email_domain' and "deal_targets"."email_domain" is not null)
        )),
	CONSTRAINT "deal_targets_email_domain_check" CHECK ("deal_targets"."email_domain" is null or "deal_targets"."email_domain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"terms" jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_status_check" CHECK ("deals"."status" in ('draft', 'active', 'paused', 'ended')),
	CONSTRAINT "deals_period_check" CHECK ("deals"."starts_at" is null or "deals"."ends_at" is null or "deals"."ends_at" > "deals"."starts_at"),
	CONSTRAINT "deals_terms_check" CHECK (jsonb_typeof("deals"."terms") = 'object'),
	CONSTRAINT "deals_name_check" CHECK (char_length(btrim("deals"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "organization_join_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"role" text DEFAULT 'org_member' NOT NULL,
	"deal_id" uuid,
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"approval" text DEFAULT 'auto_approve' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_join_links_slug_key" UNIQUE("slug"),
	CONSTRAINT "organization_join_links_slug_check" CHECK ("organization_join_links"."slug" ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
	CONSTRAINT "organization_join_links_role_check" CHECK ("organization_join_links"."role" in ('org_admin', 'org_member')),
	CONSTRAINT "organization_join_links_approval_check" CHECK ("organization_join_links"."approval" in ('auto_approve', 'requires_approval')),
	CONSTRAINT "organization_join_links_uses_check" CHECK ("organization_join_links"."used_count" >= 0 and ("organization_join_links"."max_uses" is null or ("organization_join_links"."max_uses" > 0 and "organization_join_links"."used_count" <= "organization_join_links"."max_uses")))
);
--> statement-breakpoint
CREATE TABLE "organization_member_limits" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"monthly_credit_cap" integer NOT NULL,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_member_limits_pkey" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "organization_member_limits_cap_check" CHECK ("organization_member_limits"."monthly_credit_cap" >= 0)
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"program_id" uuid NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"vanity_edited" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_code_key" UNIQUE("code"),
	CONSTRAINT "referral_codes_code_check" CHECK ("referral_codes"."code" ~ '^[A-Z0-9]{3,20}$'),
	CONSTRAINT "referral_codes_kind_check" CHECK ("referral_codes"."kind" in ('user', 'partner', 'organization', 'campaign')),
	CONSTRAINT "referral_codes_owner_check" CHECK (num_nonnulls("referral_codes"."owner_user_id", "referral_codes"."owner_org_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "referral_programs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_programs_key_key" UNIQUE("key"),
	CONSTRAINT "referral_programs_key_check" CHECK ("referral_programs"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "referral_programs_kind_check" CHECK ("referral_programs"."kind" in ('standard', 'partner', 'organization'))
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"value_enc" text NOT NULL,
	"masked" text NOT NULL,
	"destination_hash" text NOT NULL,
	"usable_after" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_destinations_destination_hash_key" UNIQUE("destination_hash"),
	CONSTRAINT "payout_destinations_destination_hash_check" CHECK ("payout_destinations"."destination_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"field_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"min_amount_minor" integer,
	"max_amount_minor" integer,
	"note_ar" text,
	"note_en" text,
	"countries" text[],
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_methods_key_key" UNIQUE("key"),
	CONSTRAINT "payout_methods_key_check" CHECK ("payout_methods"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "payout_methods_field_schema_check" CHECK (jsonb_typeof("payout_methods"."field_schema") = 'object'),
	CONSTRAINT "payout_methods_fee_check" CHECK ("payout_methods"."fee_minor" >= 0),
	CONSTRAINT "payout_methods_amount_range_check" CHECK (("payout_methods"."min_amount_minor" is null or "payout_methods"."min_amount_minor" >= 0)
        and ("payout_methods"."max_amount_minor" is null or "payout_methods"."max_amount_minor" >= 0)
        and ("payout_methods"."min_amount_minor" is null or "payout_methods"."max_amount_minor" is null or "payout_methods"."max_amount_minor" >= "payout_methods"."min_amount_minor"))
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bucket" text NOT NULL,
	"amount" integer NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"rule_id" uuid,
	"idempotency_key" text NOT NULL,
	"release_at" timestamp with time zone,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_ledger_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "points_ledger_kind_check" CHECK ("points_ledger"."kind" in ('reward_pending', 'reward_release', 'reward_reverse', 'convert_to_credits', 'withdraw_hold', 'withdraw_paid', 'withdraw_release', 'admin_adjust', 'expiry')),
	CONSTRAINT "points_ledger_bucket_check" CHECK ("points_ledger"."bucket" in ('pending', 'cash', 'credit_only')),
	CONSTRAINT "points_ledger_amount_check" CHECK ("points_ledger"."amount" <> 0),
	CONSTRAINT "points_ledger_reference_check" CHECK (("points_ledger"."reference_type" is null) = ("points_ledger"."reference_id" is null)),
	CONSTRAINT "points_ledger_reference_type_check" CHECK ("points_ledger"."reference_type" is null or "points_ledger"."reference_type" in ('referral', 'order', 'withdrawal', 'conversion', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "points_wallets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"cash" integer DEFAULT 0 NOT NULL,
	"credit_only" integer DEFAULT 0 NOT NULL,
	"lifetime_earned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "points_wallets_user_id_key" UNIQUE("user_id"),
	CONSTRAINT "points_wallets_pending_check" CHECK ("points_wallets"."pending" >= 0),
	CONSTRAINT "points_wallets_cash_check" CHECK ("points_wallets"."cash" >= 0),
	CONSTRAINT "points_wallets_credit_only_check" CHECK ("points_wallets"."credit_only" >= 0),
	CONSTRAINT "points_wallets_lifetime_earned_check" CHECK ("points_wallets"."lifetime_earned" >= 0)
);
--> statement-breakpoint
CREATE TABLE "referral_tiers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"program_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"min_paid_referrals" integer NOT NULL,
	"bonus_bps" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_tiers_program_key_key" UNIQUE("program_id","key"),
	CONSTRAINT "referral_tiers_program_min_key" UNIQUE("program_id","min_paid_referrals"),
	CONSTRAINT "referral_tiers_key_check" CHECK ("referral_tiers"."key" ~ '^[a-z][a-z0-9_]{1,39}$'),
	CONSTRAINT "referral_tiers_min_paid_check" CHECK ("referral_tiers"."min_paid_referrals" >= 0),
	CONSTRAINT "referral_tiers_bonus_bps_check" CHECK ("referral_tiers"."bonus_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"referee_user_id" uuid NOT NULL,
	"referrer_user_id" uuid,
	"referrer_org_id" uuid,
	"code_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"source" text DEFAULT 'code' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fraud_score" integer DEFAULT 0 NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referee_user_id_key" UNIQUE("referee_user_id"),
	CONSTRAINT "referrals_source_check" CHECK ("referrals"."source" in ('code', 'link', 'campaign', 'join_link', 'admin')),
	CONSTRAINT "referrals_status_check" CHECK ("referrals"."status" in ('pending', 'qualified', 'rewarded', 'held', 'blocked', 'void')),
	CONSTRAINT "referrals_fraud_score_check" CHECK ("referrals"."fraud_score" between 0 and 100),
	CONSTRAINT "referrals_self_check" CHECK ("referrals"."referrer_user_id" is null or "referrals"."referrer_user_id" <> "referrals"."referee_user_id")
);
--> statement-breakpoint
CREATE TABLE "reward_debts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"remaining" integer NOT NULL,
	"reason" text NOT NULL,
	"referral_id" uuid,
	"waived_by" uuid,
	"waived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_debts_amount_check" CHECK ("reward_debts"."amount" > 0),
	CONSTRAINT "reward_debts_remaining_check" CHECK ("reward_debts"."remaining" >= 0 and "reward_debts"."remaining" <= "reward_debts"."amount")
);
--> statement-breakpoint
CREATE TABLE "reward_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"referral_id" uuid NOT NULL,
	"rule_id" uuid,
	"event" text NOT NULL,
	"beneficiary" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"points" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_decisions_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "reward_decisions_event_check" CHECK ("reward_decisions"."event" in ('referee_verified', 'first_payment', 'renewal', 'credit_pack', 'org_member_joined')),
	CONSTRAINT "reward_decisions_beneficiary_check" CHECK ("reward_decisions"."beneficiary" in ('referrer', 'referee')),
	CONSTRAINT "reward_decisions_outcome_check" CHECK ("reward_decisions"."outcome" in ('granted', 'held_for_review', 'denied')),
	CONSTRAINT "reward_decisions_points_check" CHECK ("reward_decisions"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reward_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"program_id" uuid NOT NULL,
	"event" text NOT NULL,
	"beneficiary" text NOT NULL,
	"reward_kind" text NOT NULL,
	"value" integer NOT NULL,
	"redeemable_as" text NOT NULL,
	"hold_days" integer DEFAULT 0 NOT NULL,
	"max_per_referrer_per_day" integer,
	"max_per_referrer_total" integer,
	"min_order_minor" integer,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"max_renewals" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_rules_event_check" CHECK ("reward_rules"."event" in ('referee_verified', 'first_payment', 'renewal', 'credit_pack', 'org_member_joined')),
	CONSTRAINT "reward_rules_beneficiary_check" CHECK ("reward_rules"."beneficiary" in ('referrer', 'referee')),
	CONSTRAINT "reward_rules_reward_kind_check" CHECK ("reward_rules"."reward_kind" in ('fixed_points', 'percent_of_net_bps', 'fixed_credits')),
	CONSTRAINT "reward_rules_redeemable_as_check" CHECK ("reward_rules"."redeemable_as" in ('cash_or_credits', 'credits_only')),
	CONSTRAINT "reward_rules_value_check" CHECK ("reward_rules"."value" >= 0 and ("reward_rules"."reward_kind" <> 'percent_of_net_bps' or "reward_rules"."value" <= 10000)),
	CONSTRAINT "reward_rules_hold_days_check" CHECK ("reward_rules"."hold_days" between 0 and 365),
	CONSTRAINT "reward_rules_limits_check" CHECK (("reward_rules"."max_per_referrer_per_day" is null or "reward_rules"."max_per_referrer_per_day" > 0)
        and ("reward_rules"."max_per_referrer_total" is null or "reward_rules"."max_per_referrer_total" > 0)
        and ("reward_rules"."min_order_minor" is null or "reward_rules"."min_order_minor" >= 0)
        and ("reward_rules"."max_renewals" is null or "reward_rules"."max_renewals" > 0)),
	CONSTRAINT "reward_rules_period_check" CHECK ("reward_rules"."valid_from" is null or "reward_rules"."valid_to" is null or "reward_rules"."valid_to" > "reward_rules"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"rate_minor_per_point" integer NOT NULL,
	"fee_minor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"second_approved_by" uuid,
	"second_approved_at" timestamp with time zone,
	"paid_by" uuid,
	"paid_at" timestamp with time zone,
	"transfer_reference" text,
	"proof_file_id" uuid,
	"reject_reason" text,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_requests_user_request_key" UNIQUE("user_id","request_id"),
	CONSTRAINT "withdrawal_requests_points_check" CHECK ("withdrawal_requests"."points" > 0),
	CONSTRAINT "withdrawal_requests_amount_check" CHECK ("withdrawal_requests"."amount_minor" >= 0 and "withdrawal_requests"."fee_minor" >= 0 and "withdrawal_requests"."rate_minor_per_point" > 0),
	CONSTRAINT "withdrawal_requests_currency_check" CHECK ("withdrawal_requests"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "withdrawal_requests_status_check" CHECK ("withdrawal_requests"."status" in ('requested', 'approved', 'paid', 'rejected', 'canceled')),
	CONSTRAINT "withdrawal_requests_paid_check" CHECK ("withdrawal_requests"."status" <> 'paid' or ("withdrawal_requests"."transfer_reference" is not null and "withdrawal_requests"."paid_at" is not null)),
	CONSTRAINT "withdrawal_requests_flags_check" CHECK (jsonb_typeof("withdrawal_requests"."flags") = 'array')
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deal_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "joined_via_link_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_personal_fallback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN "referral_code_id" uuid;--> statement-breakpoint
ALTER TABLE "deal_targets" ADD CONSTRAINT "deal_targets_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_targets" ADD CONSTRAINT "deal_targets_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_targets" ADD CONSTRAINT "deal_targets_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_targets" ADD CONSTRAINT "deal_targets_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_join_links" ADD CONSTRAINT "organization_join_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_join_links" ADD CONSTRAINT "organization_join_links_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_join_links" ADD CONSTRAINT "organization_join_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_limits" ADD CONSTRAINT "organization_member_limits_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member_limits" ADD CONSTRAINT "organization_member_limits_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."organization_members"("org_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_program_id_referral_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."referral_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_method_id_payout_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payout_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_wallet_id_points_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."points_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_rule_id_reward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_wallets" ADD CONSTRAINT "points_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_tiers" ADD CONSTRAINT "referral_tiers_program_id_referral_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."referral_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_user_id_users_id_fk" FOREIGN KEY ("referee_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_org_id_organizations_id_fk" FOREIGN KEY ("referrer_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_code_id_referral_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."referral_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_program_id_referral_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."referral_programs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_debts" ADD CONSTRAINT "reward_debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_debts" ADD CONSTRAINT "reward_debts_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_debts" ADD CONSTRAINT "reward_debts_waived_by_users_id_fk" FOREIGN KEY ("waived_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_decisions" ADD CONSTRAINT "reward_decisions_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_decisions" ADD CONSTRAINT "reward_decisions_rule_id_reward_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_program_id_referral_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."referral_programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_second_approved_by_users_id_fk" FOREIGN KEY ("second_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_proof_file_id_files_id_fk" FOREIGN KEY ("proof_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_targets_deal_idx" ON "deal_targets" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_targets_user_idx" ON "deal_targets" USING btree ("target_user_id") WHERE "deal_targets"."target_user_id" is not null;--> statement-breakpoint
CREATE INDEX "deal_targets_org_idx" ON "deal_targets" USING btree ("target_org_id") WHERE "deal_targets"."target_org_id" is not null;--> statement-breakpoint
CREATE INDEX "deal_targets_code_idx" ON "deal_targets" USING btree ("referral_code_id") WHERE "deal_targets"."referral_code_id" is not null;--> statement-breakpoint
CREATE INDEX "deal_targets_domain_idx" ON "deal_targets" USING btree ("email_domain") WHERE "deal_targets"."email_domain" is not null;--> statement-breakpoint
CREATE INDEX "organization_join_links_org_idx" ON "organization_join_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_user_kind_key" ON "referral_codes" USING btree ("owner_user_id") WHERE "referral_codes"."kind" = 'user';--> statement-breakpoint
CREATE INDEX "referral_codes_owner_user_idx" ON "referral_codes" USING btree ("owner_user_id") WHERE "referral_codes"."owner_user_id" is not null;--> statement-breakpoint
CREATE INDEX "payout_destinations_user_idx" ON "payout_destinations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "points_ledger_wallet_created_idx" ON "points_ledger" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "points_ledger_group_idx" ON "points_ledger" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "points_ledger_release_idx" ON "points_ledger" USING btree ("release_at") WHERE "points_ledger"."kind" = 'reward_pending' and "points_ledger"."release_at" is not null;--> statement-breakpoint
CREATE INDEX "referrals_referrer_user_idx" ON "referrals" USING btree ("referrer_user_id") WHERE "referrals"."referrer_user_id" is not null;--> statement-breakpoint
CREATE INDEX "referrals_code_idx" ON "referrals" USING btree ("code_id");--> statement-breakpoint
CREATE INDEX "referrals_held_idx" ON "referrals" USING btree ("created_at") WHERE "referrals"."status" = 'held';--> statement-breakpoint
CREATE INDEX "reward_debts_user_open_idx" ON "reward_debts" USING btree ("user_id") WHERE "reward_debts"."remaining" > 0;--> statement-breakpoint
CREATE INDEX "reward_decisions_referral_created_idx" ON "reward_decisions" USING btree ("referral_id","created_at");--> statement-breakpoint
CREATE INDEX "reward_decisions_held_idx" ON "reward_decisions" USING btree ("created_at") WHERE "reward_decisions"."outcome" = 'held_for_review';--> statement-breakpoint
CREATE INDEX "reward_rules_program_event_idx" ON "reward_rules" USING btree ("program_id","event","beneficiary");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_requests_transfer_reference_key" ON "withdrawal_requests" USING btree ("transfer_reference") WHERE "withdrawal_requests"."transfer_reference" is not null;--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_created_idx" ON "withdrawal_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_user_created_idx" ON "withdrawal_requests" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_join_link_fk" FOREIGN KEY ("joined_via_link_id") REFERENCES "public"."organization_join_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_referral_code_id_referral_codes_id_fk" FOREIGN KEY ("referral_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- points_ledger is append-only, like credit_ledger (0008): wasfa_api can record and read rows, never
-- change or remove them. A correction is a new row. The owner role is unaffected.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE points_ledger FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE points_ledger TO wasfa_api;
