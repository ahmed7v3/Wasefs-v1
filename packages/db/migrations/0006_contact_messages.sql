CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email" "citext",
	"phone" text,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"locale" text DEFAULT 'ar' NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_messages_topic_check" CHECK ("contact_messages"."topic" in ('general', 'support', 'billing', 'partnership', 'privacy', 'other')),
	CONSTRAINT "contact_messages_status_check" CHECK ("contact_messages"."status" in ('new', 'read', 'archived')),
	CONSTRAINT "contact_messages_locale_check" CHECK ("contact_messages"."locale" in ('ar', 'en')),
	CONSTRAINT "contact_messages_phone_format_check" CHECK ("contact_messages"."phone" is null or "contact_messages"."phone" ~ '^[+][1-9][0-9]{7,14}$'),
	CONSTRAINT "contact_messages_message_length_check" CHECK (char_length("contact_messages"."message") between 1 and 4000),
	CONSTRAINT "contact_messages_contact_check" CHECK (num_nonnulls("contact_messages"."email", "contact_messages"."phone") >= 1)
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_messages_status_created_idx" ON "contact_messages" USING btree ("status","created_at");