CREATE TABLE "integration_secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value_enc" text NOT NULL,
	"key_hint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "integration_secrets_key_check" CHECK ("integration_secrets"."key" in ('elevenlabs'))
);
--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;