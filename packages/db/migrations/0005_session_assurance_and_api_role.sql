ALTER TABLE "sessions" ADD COLUMN "reauth_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
-- The role the API (and the WhatsApp bridge) connect as. It owns nothing, so it cannot alter the
-- schema, and it can read and write every table EXCEPT audit_logs, where it can only INSERT and
-- SELECT: a compromised API cannot rewrite or erase the audit trail. Migrations keep running as the
-- owner. NOLOGIN here: the password is set outside the repository (`API_DB_PASSWORD`, applied by
-- `db:migrate`), never in a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wasfa_api') THEN
    CREATE ROLE wasfa_api NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wasfa_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wasfa_api;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM wasfa_api;
--> statement-breakpoint
-- Tables created by later migrations (run by the owner) are readable and writable by default; a
-- migration that adds another append-only table must REVOKE the same way.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wasfa_api;
