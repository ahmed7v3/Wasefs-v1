CREATE TABLE "payment_method_account_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"method_id" uuid NOT NULL,
	"old_account_display" text NOT NULL,
	"new_account_display" text NOT NULL,
	"old_account_holder" text,
	"new_account_holder" text,
	"requested_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"canceled_by" uuid,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_account_changes_status_check" CHECK ("payment_method_account_changes"."status" in ('pending', 'applied', 'canceled')),
	CONSTRAINT "payment_method_account_changes_reason_check" CHECK (char_length(btrim("payment_method_account_changes"."reason")) between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "admin_alerts" DROP CONSTRAINT "admin_alerts_kind_check";--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_purpose_check";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "sender_phone_enc" text;--> statement-breakpoint
ALTER TABLE "payment_method_account_changes" ADD CONSTRAINT "payment_method_account_changes_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_account_changes" ADD CONSTRAINT "payment_method_account_changes_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_method_account_changes" ADD CONSTRAINT "payment_method_account_changes_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_method_account_changes_due_idx" ON "payment_method_account_changes" USING btree ("effective_at") WHERE "payment_method_account_changes"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_method_account_changes_one_pending_key" ON "payment_method_account_changes" USING btree ("method_id") WHERE "payment_method_account_changes"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "files_purpose_sha256_idx" ON "files" USING btree ("sha256") WHERE "files"."purpose" = 'payment_proof' and "files"."sha256" is not null;--> statement-breakpoint
ALTER TABLE "admin_alerts" ADD CONSTRAINT "admin_alerts_kind_check" CHECK ("admin_alerts"."kind" in ('payment.review_needed', 'payment.review_overdue', 'payment.amount_mismatch', 'payment.failure_spike', 'withdrawal.requested', 'withdrawal.overdue', 'reward.fraud_flag', 'credits.reconcile_drift', 'points.reconcile_drift', 'refund.requested', 'payment_method.account_change_requested', 'payment_method.account_change_canceled', 'payment_method.account_change_applied'));--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_purpose_check" CHECK ("files"."purpose" in ('rx_page', 'chat_image', 'payment_proof'));
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE "payment_method_account_changes" FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "payment_method_account_changes" TO wasfa_api;
