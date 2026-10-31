CREATE TABLE "wa_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"ref_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text NOT NULL,
	"paid_work" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "wa_outbox_idempotency_key_key" UNIQUE("idempotency_key"),
	CONSTRAINT "wa_outbox_kind_check" CHECK ("wa_outbox"."kind" in ('rx_result', 'document', 'payment', 'notice')),
	CONSTRAINT "wa_outbox_state_check" CHECK ("wa_outbox"."state" in ('waiting', 'ready', 'delivering', 'delivered', 'held', 'dead')),
	CONSTRAINT "wa_outbox_payload_check" CHECK (jsonb_typeof("wa_outbox"."payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "wa_tool_effects" (
	"key" text PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"state" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_tool_effects_state_check" CHECK ("wa_tool_effects"."state" in ('pending', 'done'))
);
--> statement-breakpoint
CREATE TABLE "wa_turns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"session_id" uuid,
	"state" text NOT NULL,
	"fence" bigint NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"inbound_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cause_class" text,
	"error_ref" text,
	"trace" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "wa_turns_state_check" CHECK ("wa_turns"."state" in ('queued', 'running', 'replied', 'deferred', 'failed_replied', 'dropped_policy')),
	CONSTRAINT "wa_turns_cause_class_check" CHECK ("wa_turns"."cause_class" is null or "wa_turns"."cause_class" in ('transient', 'after_tools', 'empty_answer', 'spend_cap', 'ai_off', 'permanent', 'policy')),
	CONSTRAINT "wa_turns_trace_check" CHECK (jsonb_typeof("wa_turns"."trace") = 'object')
);
--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD COLUMN "turn_fence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "media_status" text;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "turn_id" uuid;--> statement-breakpoint
ALTER TABLE "wa_outbox" ADD CONSTRAINT "wa_outbox_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_tool_effects" ADD CONSTRAINT "wa_tool_effects_turn_id_wa_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."wa_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_turns" ADD CONSTRAINT "wa_turns_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_outbox_due_idx" ON "wa_outbox" USING btree ("state","next_attempt_at") WHERE "wa_outbox"."state" in ('ready', 'held');--> statement-breakpoint
CREATE INDEX "wa_outbox_kind_ref_idx" ON "wa_outbox" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "wa_tool_effects_turn_idx" ON "wa_tool_effects" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "wa_turns_conversation_started_idx" ON "wa_turns" USING btree ("conversation_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "wa_turns_live_idx" ON "wa_turns" USING btree ("state","started_at") WHERE "wa_turns"."state" in ('queued', 'running', 'deferred');--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_turn_id_wa_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."wa_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_messages_unanswered_idx" ON "wa_messages" USING btree ("conversation_id") WHERE "wa_messages"."direction" = 'in' and "wa_messages"."turn_id" is null;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_media_status_check" CHECK ("wa_messages"."media_status" is null or "wa_messages"."media_status" in ('ok', 'too_large', 'unsupported_type', 'download_failed', 'storage_unavailable', 'expired'));