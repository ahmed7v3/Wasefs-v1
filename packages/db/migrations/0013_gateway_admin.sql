CREATE TABLE "payment_gateway_tests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"gateway_key" text NOT NULL,
	"mode" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"webhook_received_at" timestamp with time zone,
	"webhook_state" text,
	"webhook_amount_minor" integer,
	"webhook_currency" text,
	"status_checked_at" timestamp with time zone,
	"status_state" text,
	"status_amount_minor" integer,
	"status_currency" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_gateway_tests_provider_order_id_key" UNIQUE("provider_order_id"),
	CONSTRAINT "payment_gateway_tests_mode_check" CHECK ("payment_gateway_tests"."mode" in ('test', 'live')),
	CONSTRAINT "payment_gateway_tests_status_check" CHECK ("payment_gateway_tests"."status" in ('pending', 'succeeded', 'failed', 'mismatch')),
	CONSTRAINT "payment_gateway_tests_amount_check" CHECK ("payment_gateway_tests"."amount_minor" > 0),
	CONSTRAINT "payment_gateway_tests_currency_check" CHECK ("payment_gateway_tests"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "merchant_ref" text;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "credentials_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "last_webhook_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "last_webhook_ok" boolean;--> statement-breakpoint
ALTER TABLE "payment_gateways" ADD COLUMN "last_webhook_error" text;--> statement-breakpoint
ALTER TABLE "payment_gateway_tests" ADD CONSTRAINT "payment_gateway_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_gateway_tests_gateway_status_created_idx" ON "payment_gateway_tests" USING btree ("gateway_key","status","created_at");