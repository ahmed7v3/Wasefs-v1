CREATE TABLE "wa_conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"jid" text NOT NULL,
	"phone" text,
	"user_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_until" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_outbound_at" timestamp with time zone,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_conversations_jid_key" UNIQUE("jid"),
	CONSTRAINT "wa_conversations_status_check" CHECK ("wa_conversations"."status" in ('active', 'paused', 'blocked')),
	CONSTRAINT "wa_conversations_phone_format_check" CHECK ("wa_conversations"."phone" is null or "wa_conversations"."phone" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"media_key" text,
	"media_mime" text,
	"media_bytes" integer,
	"media_seconds" integer,
	"wa_message_id" text,
	"status" text NOT NULL,
	"drop_reason" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_messages_wa_message_id_key" UNIQUE("wa_message_id"),
	CONSTRAINT "wa_messages_direction_check" CHECK ("wa_messages"."direction" in ('in', 'out', 'owner')),
	CONSTRAINT "wa_messages_kind_check" CHECK ("wa_messages"."kind" in ('text', 'image', 'audio', 'document', 'other')),
	CONSTRAINT "wa_messages_status_check" CHECK ("wa_messages"."status" in ('received', 'queued', 'sent', 'dropped')),
	CONSTRAINT "wa_messages_text_check" CHECK ("wa_messages"."text" is null or char_length("wa_messages"."text") <= 8000),
	CONSTRAINT "wa_messages_meta_check" CHECK (jsonb_typeof("wa_messages"."meta") = 'object')
);
--> statement-breakpoint
ALTER TABLE "ai_task_routes" DROP CONSTRAINT "ai_task_routes_task_check";--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_task_check";--> statement-breakpoint
ALTER TABLE "plan_entitlements" DROP CONSTRAINT "plan_entitlements_task_check";--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD CONSTRAINT "wa_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_conversations_user_idx" ON "wa_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wa_messages_conversation_created_idx" ON "wa_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_created_idx" ON "wa_messages" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_task_check" CHECK ("ai_task_routes"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent'));--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_task_check" CHECK ("ai_usage"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent'));--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_task_check" CHECK ("plan_entitlements"."task" in ('rx_extract', 'rx_verify', 'chat', 'deep_think', 'title_gen', 'classify', 'summarize', 'web_search', 'wa_agent'));