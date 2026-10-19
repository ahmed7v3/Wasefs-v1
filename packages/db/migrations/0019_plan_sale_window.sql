ALTER TABLE "plans" ADD COLUMN "available_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_available_window_check" CHECK ("plans"."available_from" is null or "plans"."available_until" is null or "plans"."available_from" < "plans"."available_until");