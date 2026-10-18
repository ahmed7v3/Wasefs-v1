ALTER TABLE "contact_messages" DROP CONSTRAINT "contact_messages_topic_check";--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_reservations" ADD CONSTRAINT "credit_reservations_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_reservations_member_open_idx" ON "credit_reservations" USING btree ("wallet_id","member_user_id") WHERE "credit_reservations"."status" = 'open' and "credit_reservations"."member_user_id" is not null;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_topic_check" CHECK ("contact_messages"."topic" in ('general', 'support', 'billing', 'partnership', 'privacy', 'other', 'institution_lead'));--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_status_check" CHECK ("organization_members"."status" in ('active', 'pending'));