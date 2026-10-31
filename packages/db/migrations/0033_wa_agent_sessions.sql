CREATE TABLE "wa_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"returning" boolean DEFAULT false NOT NULL,
	"summary" text,
	"summarized_count" integer DEFAULT 0 NOT NULL,
	"next_handle" integer DEFAULT 1 NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "wa_agent_sessions_end_reason_check" CHECK ("wa_agent_sessions"."end_reason" is null or "wa_agent_sessions"."end_reason" in ('command', 'idle', 'privacy'))
);
--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD COLUMN "profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "handle" integer;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD COLUMN "set_label" text;--> statement-breakpoint
ALTER TABLE "wa_agent_sessions" ADD CONSTRAINT "wa_agent_sessions_conversation_id_wa_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."wa_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_agent_sessions_conversation_started_idx" ON "wa_agent_sessions" USING btree ("conversation_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD CONSTRAINT "wa_conversations_session_id_wa_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_session_id_wa_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."wa_agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wa_messages_session_created_idx" ON "wa_messages" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_messages_session_handle_key" ON "wa_messages" USING btree ("session_id","handle") WHERE "wa_messages"."handle" is not null;