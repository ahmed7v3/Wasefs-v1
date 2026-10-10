CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_step" text DEFAULT 'account_type' NOT NULL,
	"completed_steps" text[] DEFAULT '{}' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_progress_current_step_check" CHECK ("onboarding_progress"."current_step" in ('account_type', 'phone', 'name', 'organization', 'profession_intent', 'plan_picker', 'social_follow', 'done')),
	CONSTRAINT "onboarding_progress_completed_steps_check" CHECK ("onboarding_progress"."completed_steps" <@ ARRAY['account_type', 'phone', 'name', 'organization', 'profession_intent', 'plan_picker', 'social_follow', 'done']::text[]),
	CONSTRAINT "onboarding_progress_data_check" CHECK (jsonb_typeof("onboarding_progress"."data") = 'object'),
	CONSTRAINT "onboarding_progress_done_sync_check" CHECK (("onboarding_progress"."completed_at" is not null) = ("onboarding_progress"."current_step" = 'done'))
);
--> statement-breakpoint
CREATE TABLE "organization_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" "citext",
	"phone" text,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'org_member' NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invites_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "organization_invites_role_check" CHECK ("organization_invites"."role" in ('org_admin', 'org_member')),
	CONSTRAINT "organization_invites_one_target_check" CHECK (num_nonnulls("organization_invites"."email", "organization_invites"."phone") = 1),
	CONSTRAINT "organization_invites_phone_format_check" CHECK ("organization_invites"."phone" is null or "organization_invites"."phone" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'org_member' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_pkey" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" in ('org_admin', 'org_member'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"country" text NOT NULL,
	"city" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_type_check" CHECK ("organizations"."type" in ('pharmacy', 'clinic', 'hospital', 'other')),
	CONSTRAINT "organizations_country_check" CHECK ("organizations"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "organizations_name_check" CHECK (char_length(btrim("organizations"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_key" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_pkey" PRIMARY KEY("role_key","permission"),
	CONSTRAINT "role_permissions_permission_check" CHECK ("role_permissions"."permission" ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_check" CHECK ("roles"."key" ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_pkey" PRIMARY KEY("user_id","role_key")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"profession" text,
	"usage_intent" text[] DEFAULT '{}' NOT NULL,
	"country" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_profession_check" CHECK ("user_profiles"."profession" is null or "user_profiles"."profession" in ('pharmacist', 'doctor', 'nurse', 'student', 'patient', 'other')),
	CONSTRAINT "user_profiles_country_check" CHECK ("user_profiles"."country" is null or "user_profiles"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"phone" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"account_type" text DEFAULT 'individual' NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_reason" text,
	"deleted_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_account_type_check" CHECK ("users"."account_type" in ('individual', 'organization')),
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('ar', 'en')),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'suspended', 'deleted')),
	CONSTRAINT "users_phone_format_check" CHECK ("users"."phone" is null or "users"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "users_phone_verified_sync_check" CHECK ("users"."phone_verified" = ("users"."phone_verified_at" is not null)),
	CONSTRAINT "users_phone_verified_needs_phone_check" CHECK ("users"."phone_verified_at" is null or "users"."phone" is not null),
	CONSTRAINT "users_deleted_sync_check" CHECK (("users"."status" = 'deleted') = ("users"."deleted_at" is not null)),
	CONSTRAINT "users_anonymized_needs_deleted_check" CHECK ("users"."anonymized_at" is null or "users"."status" = 'deleted')
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_key" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "organization_invites_org_id_idx" ON "organization_invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_key_idx" ON "user_roles" USING btree ("role_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_verified_key" ON "users" USING btree ("phone") WHERE "users"."phone_verified_at" is not null;--> statement-breakpoint
CREATE INDEX "users_phone_idx" ON "users" USING btree ("phone") WHERE "users"."phone" is not null;--> statement-breakpoint
CREATE INDEX "users_pending_anonymization_idx" ON "users" USING btree ("deleted_at") WHERE "users"."deleted_at" is not null and "users"."anonymized_at" is null;