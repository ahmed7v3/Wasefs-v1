CREATE TABLE "publishing_idempotency" (
	"key_id" uuid NOT NULL,
	"idem_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_idempotency_pkey" PRIMARY KEY("key_id","idem_key")
);
--> statement-breakpoint
CREATE TABLE "publishing_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key_id" text NOT NULL,
	"environment" text DEFAULT 'live' NOT NULL,
	"secret_hash" text NOT NULL,
	"prev_secret_hash" text,
	"prev_valid_until" timestamp with time zone,
	"last4" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"can_publish" boolean DEFAULT false NOT NULL,
	"allowed_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_category_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_author_id" uuid,
	"default_featured_media_id" uuid,
	"daily_publish_cap" integer,
	"requests_per_minute" integer DEFAULT 60 NOT NULL,
	"ip_allow_list" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "publishing_api_keys_key_id_key" UNIQUE("key_id"),
	CONSTRAINT "publishing_api_keys_environment_check" CHECK ("publishing_api_keys"."environment" in ('live', 'test')),
	CONSTRAINT "publishing_api_keys_key_id_check" CHECK ("publishing_api_keys"."key_id" ~ '^[A-Za-z0-9]{12}$'),
	CONSTRAINT "publishing_api_keys_scopes_check" CHECK ("publishing_api_keys"."scopes" <@ ARRAY['content:read', 'content:write', 'content:publish', 'media:write', 'taxonomy:write', 'people:read']::text[]),
	CONSTRAINT "publishing_api_keys_allowed_types_check" CHECK ("publishing_api_keys"."allowed_types" <@ ARRAY['article', 'guide', 'glossary']::text[]),
	CONSTRAINT "publishing_api_keys_requests_per_minute_check" CHECK ("publishing_api_keys"."requests_per_minute" between 1 and 6000),
	CONSTRAINT "publishing_api_keys_daily_publish_cap_check" CHECK ("publishing_api_keys"."daily_publish_cap" is null or "publishing_api_keys"."daily_publish_cap" between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "publishing_api_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"status" smallint NOT NULL,
	"latency_ms" integer NOT NULL,
	"error_code" text,
	"item_id" text,
	"idempotency_key" text
);
--> statement-breakpoint
ALTER TABLE "publishing_api_keys" ADD CONSTRAINT "publishing_api_keys_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_api_keys" ADD CONSTRAINT "publishing_api_keys_default_author_id_content_people_id_fk" FOREIGN KEY ("default_author_id") REFERENCES "public"."content_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_api_keys" ADD CONSTRAINT "publishing_api_keys_default_featured_media_id_media_assets_id_fk" FOREIGN KEY ("default_featured_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_api_requests" ADD CONSTRAINT "publishing_api_requests_key_id_publishing_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."publishing_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publishing_idempotency_created_idx" ON "publishing_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "publishing_api_keys_owner_idx" ON "publishing_api_keys" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "publishing_api_requests_key_at_idx" ON "publishing_api_requests" USING btree ("key_id","at");--> statement-breakpoint
CREATE INDEX "publishing_api_requests_at_idx" ON "publishing_api_requests" USING btree ("at");