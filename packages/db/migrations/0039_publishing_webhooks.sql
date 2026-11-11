ALTER TABLE "publishing_api_keys" ADD COLUMN "webhook_url_enc" text;
--> statement-breakpoint
ALTER TABLE "publishing_api_keys" ADD COLUMN "webhook_secret_enc" text;
--> statement-breakpoint
CREATE TABLE "publishing_webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "key_id" uuid NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "webhook_url_enc" text NOT NULL,
  "webhook_secret_enc" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "response_status" smallint,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp with time zone,
  CONSTRAINT "publishing_webhook_deliveries_status_check" CHECK ("publishing_webhook_deliveries"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "publishing_webhook_deliveries" ADD CONSTRAINT "publishing_webhook_deliveries_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."publishing_api_keys"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "publishing_webhook_deliveries_key_created_idx" ON "publishing_webhook_deliveries" USING btree ("key_id", "created_at");
--> statement-breakpoint
CREATE INDEX "publishing_webhook_deliveries_due_idx" ON "publishing_webhook_deliveries" USING btree ("status", "next_attempt_at");
