CREATE TABLE "notification_prefs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"whatsapp_opted_out_at" timestamp with time zone,
	"whatsapp_opted_out_via" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_prefs_opt_out_via_check" CHECK ("notification_prefs"."whatsapp_opted_out_via" is null or "notification_prefs"."whatsapp_opted_out_via" in ('whatsapp', 'account')),
	CONSTRAINT "notification_prefs_opt_out_pair_check" CHECK (("notification_prefs"."whatsapp_opted_out_at" is null) = ("notification_prefs"."whatsapp_opted_out_via" is null))
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON TABLE "notification_prefs" FROM wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "notification_prefs" TO wasfa_api;
