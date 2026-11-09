CREATE TABLE "telegram_chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"telegram_user_id" bigint,
	"username" text,
	"first_name" text,
	"last_name" text,
	"language_code" text,
	"phone" text,
	"phone_shared_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"locale" text DEFAULT 'ar' NOT NULL,
	"context_reset_at" timestamp with time zone,
	"last_rx_id" uuid,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chats_locale_check" CHECK ("telegram_chats"."locale" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "telegram_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chat_id" bigint NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_messages_role_check" CHECK ("telegram_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
ALTER TABLE "integration_secrets" DROP CONSTRAINT "integration_secrets_key_check";--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_last_rx_id_rx_analyses_id_fk" FOREIGN KEY ("last_rx_id") REFERENCES "public"."rx_analyses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_messages" ADD CONSTRAINT "telegram_messages_chat_id_telegram_chats_chat_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."telegram_chats"("chat_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_chats_user_idx" ON "telegram_chats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "telegram_messages_chat_created_idx" ON "telegram_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_key_check" CHECK ("integration_secrets"."key" in ('elevenlabs', 'telegram'));