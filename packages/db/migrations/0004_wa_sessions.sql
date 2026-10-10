CREATE TABLE "wa_sessions" (
	"session" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_sessions_pkey" PRIMARY KEY("session","key")
);
