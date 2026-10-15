ALTER TABLE "rx_analyses" ADD COLUMN "rating" text;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD COLUMN "rating_note" text;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD COLUMN "share_for_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD COLUMN "rated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "rx_analyses_shared_idx" ON "rx_analyses" USING btree ("rated_at" DESC NULLS LAST) WHERE "rx_analyses"."share_for_review";--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_rating_check" CHECK ("rx_analyses"."rating" is null or "rx_analyses"."rating" in ('good', 'bad'));--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_rating_note_check" CHECK ("rx_analyses"."rating_note" is null or char_length("rx_analyses"."rating_note") <= 300);--> statement-breakpoint
ALTER TABLE "rx_analyses" ADD CONSTRAINT "rx_analyses_share_needs_rating_check" CHECK (not "rx_analyses"."share_for_review" or "rx_analyses"."rating" is not null);