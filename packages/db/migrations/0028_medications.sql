CREATE TABLE "drug_learned" (
	"normalized" text NOT NULL,
	"drug_id" uuid NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "drug_learned_pkey" PRIMARY KEY("normalized","drug_id"),
	CONSTRAINT "drug_learned_status_check" CHECK ("drug_learned"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "drug_learned_votes_check" CHECK ("drug_learned"."votes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drug_learning_votes" (
	"normalized" text NOT NULL,
	"drug_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drug_learning_votes_pkey" PRIMARY KEY("normalized","drug_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "drug_unmatched_names" (
	"normalized" text PRIMARY KEY NOT NULL,
	"sample" text NOT NULL,
	"hits" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"mapped_drug_id" uuid,
	CONSTRAINT "drug_unmatched_names_status_check" CHECK ("drug_unmatched_names"."status" in ('open', 'mapped', 'ignored')),
	CONSTRAINT "drug_unmatched_names_hits_check" CHECK ("drug_unmatched_names"."hits" >= 1)
);
--> statement-breakpoint
ALTER TABLE "drug_import_batches" DROP CONSTRAINT "drug_import_batches_source_check";--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "price_minor" integer;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "old_price_minor" integer;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "currency" text DEFAULT 'EGP' NOT NULL;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "pack_text" text;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "units_count" integer;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "brand_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "price_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drugs" ADD COLUMN "admin_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "drug_learned" ADD CONSTRAINT "drug_learned_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_learned" ADD CONSTRAINT "drug_learned_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_learning_votes" ADD CONSTRAINT "drug_learning_votes_drug_id_drugs_id_fk" FOREIGN KEY ("drug_id") REFERENCES "public"."drugs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_learning_votes" ADD CONSTRAINT "drug_learning_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_unmatched_names" ADD CONSTRAINT "drug_unmatched_names_mapped_drug_id_drugs_id_fk" FOREIGN KEY ("mapped_drug_id") REFERENCES "public"."drugs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drugs_brand_key_idx" ON "drugs" USING btree ("brand_key");--> statement-breakpoint
CREATE INDEX "drugs_barcode_idx" ON "drugs" USING btree ("barcode");--> statement-breakpoint
CREATE INDEX "drugs_category_idx" ON "drugs" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "drugs_source_ref_key" ON "drugs" USING btree ("source","source_ref") WHERE "drugs"."source_ref" is not null;--> statement-breakpoint
ALTER TABLE "drug_import_batches" ADD CONSTRAINT "drug_import_batches_source_check" CHECK ("drug_import_batches"."source" in ('eda', 'sfda', 'dwaprices', 'manual', 'other'));--> statement-breakpoint
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_price_check" CHECK ("drugs"."price_minor" is null or "drugs"."price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_old_price_check" CHECK ("drugs"."old_price_minor" is null or "drugs"."old_price_minor" >= 0);--> statement-breakpoint
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_currency_check" CHECK ("drugs"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "drugs" ADD CONSTRAINT "drugs_units_count_check" CHECK ("drugs"."units_count" is null or "drugs"."units_count" > 0);
