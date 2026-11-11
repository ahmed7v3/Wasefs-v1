ALTER TABLE "media_assets" ADD COLUMN "api_key_id" uuid;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."publishing_api_keys"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "media_assets_api_key_idx" ON "media_assets" USING btree ("api_key_id") WHERE "media_assets"."api_key_id" is not null;
