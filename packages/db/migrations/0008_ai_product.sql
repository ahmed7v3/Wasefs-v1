CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"context_tokens" integer,
	"price_input_usd_micros_per_m" bigint DEFAULT 0 NOT NULL,
	"price_cached_input_usd_micros_per_m" bigint,
	"price_output_usd_micros_per_m" bigint DEFAULT 0 NOT NULL,
	"price_search_usd_micros" bigint DEFAULT 0 NOT NULL,
	"credit_multiplier_bp" integer DEFAULT 10000 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"price_source" text DEFAULT 'manual' NOT NULL,
	"price_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_models_provider_model_key" UNIQUE("provider_id","model_id"),
	CONSTRAINT "ai_models_capabilities_check" CHECK ("ai_models"."capabilities" <@ ARRAY['vision', 'thinking', 'search', 'json', 'bbox']::text[]),
	CONSTRAINT "ai_models_price_input_check" CHECK ("ai_models"."price_input_usd_micros_per_m" >= 0),
	CONSTRAINT "ai_models_price_cached_input_check" CHECK ("ai_models"."price_cached_input_usd_micros_per_m" is null or "ai_models"."price_cached_input_usd_micros_per_m" >= 0),
	CONSTRAINT "ai_models_price_output_check" CHECK ("ai_models"."price_output_usd_micros_per_m" >= 0),
	CONSTRAINT "ai_models_price_search_check" CHECK ("ai_models"."price_search_usd_micros" >= 0),
	CONSTRAINT "ai_models_credit_multiplier_check" CHECK ("ai_models"."credit_multiplier_bp" > 0),
	CONSTRAINT "ai_models_price_source_check" CHECK ("ai_models"."price_source" in ('manual', 'openrouter_sync'))
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text,
	"api_key_enc" text,
	"key_hint" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"data_policy" text NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_providers_key_key" UNIQUE("key"),
	CONSTRAINT "ai_providers_kind_check" CHECK ("ai_providers"."kind" in ('gemini', 'openrouter', 'openai_compatible', 'fake')),
	CONSTRAINT "ai_providers_data_policy_check" CHECK ("ai_providers"."data_policy" in ('paid_no_training', 'zdr', 'free_tier'))
);
--> statement-breakpoint
CREATE TABLE "ai_spend_daily" (
	"day" date NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"thinking_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_spend_daily_pkey" PRIMARY KEY("day","provider_id","model_id"),
	CONSTRAINT "ai_spend_daily_counts_check" CHECK ("ai_spend_daily"."calls" >= 0 and "ai_spend_daily"."input_tokens" >= 0 and "ai_spend_daily"."cached_input_tokens" >= 0 and "ai_spend_daily"."output_tokens" >= 0 and "ai_spend_daily"."thinking_tokens" >= 0 and "ai_spend_daily"."cost_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_task_routes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task" text NOT NULL,
	"plan_id" uuid,
	"mode" text NOT NULL,
	"models" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_task_routes_task_check" CHECK ("ai_task_routes"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search')),
	CONSTRAINT "ai_task_routes_mode_check" CHECK ("ai_task_routes"."mode" in ('fast', 'balanced', 'deep')),
	CONSTRAINT "ai_task_routes_models_check" CHECK (jsonb_typeof("ai_task_routes"."models") = 'array' and jsonb_array_length("ai_task_routes"."models") > 0),
	CONSTRAINT "ai_task_routes_version_check" CHECK ("ai_task_routes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"task" text NOT NULL,
	"route_version" integer,
	"model_id" uuid,
	"provider_id" uuid,
	"model_key" text NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"user_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"thinking_tokens" integer DEFAULT 0 NOT NULL,
	"search_count" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"outcome" text NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_owner_check" CHECK (num_nonnulls("ai_usage"."owner_user_id", "ai_usage"."owner_org_id") <= 1),
	CONSTRAINT "ai_usage_task_check" CHECK ("ai_usage"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search')),
	CONSTRAINT "ai_usage_outcome_check" CHECK ("ai_usage"."outcome" in ('ok', 'error', 'timeout', 'cancelled', 'refused', 'cache_hit')),
	CONSTRAINT "ai_usage_tokens_check" CHECK ("ai_usage"."input_tokens" >= 0 and "ai_usage"."cached_input_tokens" >= 0 and "ai_usage"."output_tokens" >= 0 and "ai_usage"."thinking_tokens" >= 0),
	CONSTRAINT "ai_usage_search_count_check" CHECK ("ai_usage"."search_count" >= 0),
	CONSTRAINT "ai_usage_cost_check" CHECK ("ai_usage"."cost_usd_micros" >= 0),
	CONSTRAINT "ai_usage_credits_check" CHECK ("ai_usage"."credits_charged" >= 0),
	CONSTRAINT "ai_usage_latency_check" CHECK ("ai_usage"."latency_ms" is null or "ai_usage"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"ai_usage_id" uuid,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_messages_role_check" CHECK ("chat_messages"."role" in ('user', 'assistant', 'system')),
	CONSTRAINT "chat_messages_status_check" CHECK ("chat_messages"."status" in ('streaming', 'done', 'stopped', 'error')),
	CONSTRAINT "chat_messages_parts_check" CHECK (jsonb_typeof("chat_messages"."parts") = 'array'),
	CONSTRAINT "chat_messages_credits_check" CHECK ("chat_messages"."credits_charged" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_summaries" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"through_message_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"user_id" uuid,
	"title" text,
	"skill" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chats_owner_check" CHECK (num_nonnulls("chats"."owner_user_id", "chats"."owner_org_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reservation_id" uuid,
	"ai_usage_id" uuid,
	"actor_id" uuid,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "credit_ledger_kind_check" CHECK ("credit_ledger"."kind" in ('grant', 'admin_adjust', 'usage_reserve', 'usage_settle', 'release', 'refund', 'expiry')),
	CONSTRAINT "credit_ledger_amount_check" CHECK ("credit_ledger"."amount" <> 0),
	CONSTRAINT "credit_ledger_balance_after_check" CHECK ("credit_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_reservations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"settled_amount" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_reservations_amount_check" CHECK ("credit_reservations"."amount" > 0),
	CONSTRAINT "credit_reservations_settled_amount_check" CHECK ("credit_reservations"."settled_amount" is null or ("credit_reservations"."settled_amount" >= 0 and "credit_reservations"."settled_amount" <= "credit_reservations"."amount")),
	CONSTRAINT "credit_reservations_status_check" CHECK ("credit_reservations"."status" in ('open', 'settled', 'released', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "credit_wallets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_wallets_owner_user_key" UNIQUE("owner_user_id"),
	CONSTRAINT "credit_wallets_owner_org_key" UNIQUE("owner_org_id"),
	CONSTRAINT "credit_wallets_owner_check" CHECK (num_nonnulls("credit_wallets"."owner_user_id", "credit_wallets"."owner_org_id") = 1),
	CONSTRAINT "credit_wallets_balance_check" CHECK ("credit_wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "active_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text,
	"normalized" text NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "active_ingredients_normalized_key" UNIQUE("normalized")
);
--> statement-breakpoint
CREATE TABLE "drug_aliases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"drug_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized" text NOT NULL,
	"lang" text NOT NULL,
	"source" text,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drug_aliases_drug_normalized_key" UNIQUE("drug_id","normalized"),
	CONSTRAINT "drug_aliases_lang_check" CHECK ("drug_aliases"."lang" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "drug_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_name" text NOT NULL,
	"source" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_inserted" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"committed_by" uuid,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drug_import_batches_source_check" CHECK ("drug_import_batches"."source" in ('eda', 'sfda', 'manual', 'other')),
	CONSTRAINT "drug_import_batches_status_check" CHECK ("drug_import_batches"."status" in ('draft', 'dry_run', 'committed', 'rolled_back', 'failed')),
	CONSTRAINT "drug_import_batches_counts_check" CHECK ("drug_import_batches"."rows_total" >= 0 and "drug_import_batches"."rows_inserted" >= 0 and "drug_import_batches"."rows_updated" >= 0 and "drug_import_batches"."rows_skipped" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drug_ingredients" (
	"drug_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"strength_text" text,
	"strength_value_micro" bigint,
	"strength_unit" text,
	CONSTRAINT "drug_ingredients_pkey" PRIMARY KEY("drug_id","ingredient_id"),
	CONSTRAINT "drug_ingredients_strength_check" CHECK ("drug_ingredients"."strength_value_micro" is null or "drug_ingredients"."strength_value_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drugs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"brand_en" text NOT NULL,
	"brand_ar" text,
	"normalized_en" text NOT NULL,
	"normalized_ar" text,
	"form" text,
	"strength_text" text,
	"strength_value_micro" bigint,
	"strength_unit" text,
	"manufacturer" text,
	"country" text,
	"status" text DEFAULT 'active' NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drugs_status_check" CHECK ("drugs"."status" in ('active', 'withdrawn')),
	CONSTRAINT "drugs_country_check" CHECK ("drugs"."country" is null or "drugs"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "drugs_strength_check" CHECK ("drugs"."strength_value_micro" is null or "drugs"."strength_value_micro" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_eval_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"set_id" uuid NOT NULL,
	"file_ids" uuid[] NOT NULL,
	"kind" text NOT NULL,
	"expected" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_items_kind_check" CHECK ("ai_eval_items"."kind" in ('printed', 'handwritten'))
);
--> statement-breakpoint
CREATE TABLE "ai_eval_results" (
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"output" jsonb,
	"scores" jsonb,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	CONSTRAINT "ai_eval_results_pkey" PRIMARY KEY("run_id","item_id"),
	CONSTRAINT "ai_eval_results_cost_check" CHECK ("ai_eval_results"."cost_usd_micros" >= 0),
	CONSTRAINT "ai_eval_results_latency_check" CHECK ("ai_eval_results"."latency_ms" is null or "ai_eval_results"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"set_id" uuid NOT NULL,
	"route_snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"metrics" jsonb,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_runs_status_check" CHECK ("ai_eval_runs"."status" in ('queued', 'running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "ai_eval_runs_cost_check" CHECK ("ai_eval_runs"."cost_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_eval_sets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_sets_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"created_by" uuid,
	"purpose" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"sha256" text,
	"dhash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_r2_key_key" UNIQUE("r2_key"),
	CONSTRAINT "files_owner_check" CHECK (num_nonnulls("files"."owner_user_id", "files"."owner_org_id") = 1),
	CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('rx_page', 'chat_image')),
	CONSTRAINT "files_mime_check" CHECK ("files"."mime" ~ '^image[/](jpeg|png|webp)$'),
	CONSTRAINT "files_bytes_check" CHECK ("files"."bytes" between 1 and 15728640),
	CONSTRAINT "files_status_check" CHECK ("files"."status" in ('pending', 'uploaded', 'processed', 'rejected', 'deleted')),
	CONSTRAINT "files_sha256_check" CHECK ("files"."sha256" is null or "files"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "files_dhash_check" CHECK ("files"."dhash" is null or "files"."dhash" ~ '^[a-f0-9]{16}$')
);
--> statement-breakpoint
CREATE TABLE "plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"plan_id" uuid NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"assigned_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_assignments_owner_check" CHECK (num_nonnulls("plan_assignments"."owner_user_id", "plan_assignments"."owner_org_id") = 1),
	CONSTRAINT "plan_assignments_period_check" CHECK ("plan_assignments"."ends_at" is null or "plan_assignments"."ends_at" > "plan_assignments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_id" uuid NOT NULL,
	"task" text NOT NULL,
	"allowed" boolean DEFAULT true NOT NULL,
	"modes" text[] NOT NULL,
	"daily_cap" integer,
	"monthly_cap" integer,
	"max_pages_per_rx" integer DEFAULT 1 NOT NULL,
	"web_search" boolean DEFAULT false NOT NULL,
	CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY("plan_id","task"),
	CONSTRAINT "plan_entitlements_task_check" CHECK ("plan_entitlements"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search')),
	CONSTRAINT "plan_entitlements_modes_check" CHECK ("plan_entitlements"."modes" <@ ARRAY['fast', 'balanced', 'deep']::text[]),
	CONSTRAINT "plan_entitlements_daily_cap_check" CHECK ("plan_entitlements"."daily_cap" is null or "plan_entitlements"."daily_cap" >= 0),
	CONSTRAINT "plan_entitlements_monthly_cap_check" CHECK ("plan_entitlements"."monthly_cap" is null or "plan_entitlements"."monthly_cap" >= 0),
	CONSTRAINT "plan_entitlements_max_pages_check" CHECK ("plan_entitlements"."max_pages_per_rx" between 1 and 4)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"audience" text DEFAULT 'any' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"monthly_credits" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"badge_ar" text,
	"badge_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_key_key" UNIQUE("key"),
	CONSTRAINT "plans_key_check" CHECK ("plans"."key" ~ '^[a-z][a-z0-9_]*$'),
	CONSTRAINT "plans_audience_check" CHECK ("plans"."audience" in ('individual', 'organization', 'any')),
	CONSTRAINT "plans_visibility_check" CHECK ("plans"."visibility" in ('public', 'hidden')),
	CONSTRAINT "plans_monthly_credits_check" CHECK ("plans"."monthly_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rx_analyses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_user_id" uuid,
	"owner_org_id" uuid,
	"created_by" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"reservation_id" uuid,
	"skill_version" text NOT NULL,
	"route_version" integer,
	"input_sha256" text,
	"cache_of" uuid,
	"result" jsonb,
	"patient_initials" text,
	"prescriber_initials" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rx_analyses_owner_check" CHECK (num_nonnulls("rx_analyses"."owner_user_id", "rx_analyses"."owner_org_id") = 1),
	CONSTRAINT "rx_analyses_status_check" CHECK ("rx_analyses"."status" in ('queued', 'processing', 'verifying', 'done', 'failed', 'refunded')),
	CONSTRAINT "rx_analyses_mode_check" CHECK ("rx_analyses"."mode" in ('fast', 'balanced', 'deep')),
	CONSTRAINT "rx_analyses_credits_check" CHECK ("rx_analyses"."credits_charged" >= 0),
	CONSTRAINT "rx_analyses_patient_initials_check" CHECK ("rx_analyses"."patient_initials" is null or char_length("rx_analyses"."patient_initials") <= 8),
	CONSTRAINT "rx_analyses_prescriber_initials_check" CHECK ("rx_analyses"."prescriber_initials" is null or char_length("rx_analyses"."prescriber_initials") <= 8)
);
--> statement-breakpoint
CREATE TABLE "rx_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"item_index" integer NOT NULL,
	"field" text NOT NULL,
	"before" text,
	"after" text,
	"user_id" uuid,
	"consent_for_eval" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rx_corrections_item_index_check" CHECK ("rx_corrections"."item_index" >= 0),
	CONSTRAINT "rx_corrections_field_check" CHECK ("rx_corrections"."field" in ('drug', 'ingredient', 'strength', 'form', 'dose', 'frequency', 'duration', 'route'))
);
--> statement-breakpoint
CREATE TABLE "rx_pages" (
	"analysis_id" uuid NOT NULL,
	"page_no" integer NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "rx_pages_pkey" PRIMARY KEY("analysis_id","page_no"),
	CONSTRAINT "rx_pages_page_no_check" CHECK ("rx_pages"."page_no" between 1 and 4)
);
--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_spend_daily" ADD CONSTRAINT "ai_spend_daily_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_spend_daily" ADD CONSTRAINT "ai_spend_daily_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ai_usage_id_ai_usage_id_fk" FOREIGN KEY ("ai_usage_id") REFERENCES "public"."ai_usage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_summaries" ADD CONSTRAINT "chat_summaries_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_summaries" ADD CONSTRAINT "chat_summaries_through_message_id_chat_messages_id_fk" FOREIGN KEY ("through_message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_reservation_id_credit_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."credit_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_ai_usage_id_ai_usage_id_fk" FOREIGN KEY ("ai_usage_id") REFERENCES "public"."ai_usage"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_ingredients" ADD CONSTRAINT "active_ingredients_import_batch_id_drug_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."drug_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_aliases" ADD CONSTRAINT "drug_aliases_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_aliases" ADD CONSTRAINT "drug_aliases_import_batch_id_drug_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."drug_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_import_batches" ADD CONSTRAINT "drug_import_batches_committed_by_users_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_ingredients" ADD CONSTRAINT "drug_ingredients_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_ingredients" ADD CONSTRAINT "drug_ingredients_ingredient_id_active_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."active_ingredients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_import_batch_id_drug_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."drug_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_items" ADD CONSTRAINT "ai_eval_items_set_id_ai_eval_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."ai_eval_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_results" ADD CONSTRAINT "ai_eval_results_run_id_ai_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_results" ADD CONSTRAINT "ai_eval_results_item_id_ai_eval_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."ai_eval_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_set_id_ai_eval_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."ai_eval_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_owner_org_id_organizations_id_fk" FOREIGN KEY ("owner_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_reservation_id_credit_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."credit_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_cache_of_rx_analyses_id_fk" FOREIGN KEY ("cache_of") REFERENCES "public"."rx_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_corrections" ADD CONSTRAINT "rx_corrections_analysis_id_rx_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."rx_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_corrections" ADD CONSTRAINT "rx_corrections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_pages" ADD CONSTRAINT "rx_pages_analysis_id_rx_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."rx_analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rx_pages" ADD CONSTRAINT "rx_pages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_task_routes_key" ON "ai_task_routes" USING btree ("task",coalesce("plan_id", '00000000-0000-0000-0000-000000000000'::uuid),"mode");--> statement-breakpoint
CREATE INDEX "ai_usage_created_at_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_owner_user_created_idx" ON "ai_usage" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_owner_org_created_idx" ON "ai_usage" USING btree ("owner_org_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_created_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "chats_user_updated_idx" ON "chats" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_ledger_wallet_created_idx" ON "credit_ledger" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_reservations_open_expires_idx" ON "credit_reservations" USING btree ("expires_at") WHERE "credit_reservations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "active_ingredients_normalized_trgm_idx" ON "active_ingredients" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "drug_aliases_normalized_trgm_idx" ON "drug_aliases" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "drugs_normalized_en_trgm_idx" ON "drugs" USING gin ("normalized_en" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "drugs_normalized_ar_trgm_idx" ON "drugs" USING gin ("normalized_ar" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "files_sha256_idx" ON "files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "files_owner_user_dhash_idx" ON "files" USING btree ("owner_user_id","dhash");--> statement-breakpoint
CREATE INDEX "files_owner_org_dhash_idx" ON "files" USING btree ("owner_org_id","dhash");--> statement-breakpoint
CREATE INDEX "files_expires_at_idx" ON "files" USING btree ("expires_at") WHERE "files"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "plan_assignments_owner_user_starts_idx" ON "plan_assignments" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "plan_assignments_owner_org_starts_idx" ON "plan_assignments" USING btree ("owner_org_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_default_idx" ON "plans" USING btree ("is_default") WHERE "plans"."is_default";--> statement-breakpoint
CREATE INDEX "rx_analyses_owner_user_created_idx" ON "rx_analyses" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rx_analyses_owner_org_created_idx" ON "rx_analyses" USING btree ("owner_org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "rx_analyses_cache_idx" ON "rx_analyses" USING btree ("input_sha256","skill_version","route_version") WHERE "rx_analyses"."status" = 'done';
--> statement-breakpoint
-- credit_ledger is append-only, like audit_logs (0005): the default privileges above gave wasfa_api
-- UPDATE and DELETE on every new table, so take them back. The API can only record and read
-- entries; a correction is a new row. The owner role (migrations, retention) is unaffected.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE credit_ledger FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE credit_ledger TO wasfa_api;
