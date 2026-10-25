CREATE TABLE "content_autosaves" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_autosaves_item_user_key" UNIQUE("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "content_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"parent_id" uuid,
	"slug_ar" text NOT NULL,
	"slug_en" text,
	"name_ar" text NOT NULL,
	"name_en" text,
	"description_ar" text DEFAULT '' NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"requires_medical_review" boolean DEFAULT true NOT NULL,
	"default_reviewer_id" uuid,
	"seo_title_ar" text DEFAULT '' NOT NULL,
	"seo_description_ar" text DEFAULT '' NOT NULL,
	"seo_title_en" text DEFAULT '' NOT NULL,
	"seo_description_en" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_categories_slug_ar_key" UNIQUE("slug_ar"),
	CONSTRAINT "content_categories_slug_en_key" UNIQUE("slug_en")
);
--> statement-breakpoint
CREATE TABLE "content_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_entities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"slug" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "content_entities_item_kind_slug_key" UNIQUE("item_id","kind","slug"),
	CONSTRAINT "content_entities_kind_check" CHECK ("content_entities"."kind" in ('drug', 'glossary')),
	CONSTRAINT "content_entities_source_check" CHECK ("content_entities"."source" in ('explicit', 'auto'))
);
--> statement-breakpoint
CREATE TABLE "content_item_tags" (
	"item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "content_item_tags_pkey" PRIMARY KEY("item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" text NOT NULL,
	"locale" text NOT NULL,
	"translation_group_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"category_id" uuid,
	"primary_author_id" uuid,
	"reviewer_id" uuid,
	"featured_media_id" uuid,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'editor' NOT NULL,
	"api_key_id" uuid,
	"external_id" text,
	"current_revision_id" uuid,
	"reviewed_revision_id" uuid,
	"published_revision_id" uuid,
	"submitted_revision_id" uuid,
	"submitted_by" uuid,
	"reviewed_at" timestamp with time zone,
	"next_review_due" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"content_updated_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_redirect_to" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(slug, '') || ' ' || coalesce(search_text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_type_locale_slug_key" UNIQUE("type","locale","slug"),
	CONSTRAINT "content_items_translation_locale_key" UNIQUE("translation_group_id","locale"),
	CONSTRAINT "content_items_slug_check" CHECK ("content_items"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*(?:[/][a-z0-9]+(?:-[a-z0-9]+)*){0,2}$'),
	CONSTRAINT "content_items_slug_segments_check" CHECK ("content_items"."type" = 'page' or position('/' in "content_items"."slug") = 0),
	CONSTRAINT "content_items_type_check" CHECK ("content_items"."type" in ('article', 'guide', 'glossary', 'page')),
	CONSTRAINT "content_items_locale_check" CHECK ("content_items"."locale" in ('ar', 'en')),
	CONSTRAINT "content_items_status_check" CHECK ("content_items"."status" in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')),
	CONSTRAINT "content_items_source_check" CHECK ("content_items"."source" in ('editor', 'api'))
);
--> statement-breakpoint
CREATE TABLE "content_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"href" text NOT NULL,
	"kind" text NOT NULL,
	"host" text,
	"anchor_text" text DEFAULT '' NOT NULL,
	"target_item_id" uuid,
	"rel" text DEFAULT '' NOT NULL,
	CONSTRAINT "content_links_kind_check" CHECK ("content_links"."kind" in ('internal', 'external'))
);
--> statement-breakpoint
CREATE TABLE "content_media_refs" (
	"item_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "content_media_refs_pkey" PRIMARY KEY("item_id","media_id","role"),
	CONSTRAINT "content_media_refs_role_check" CHECK ("content_media_refs"."role" in ('featured', 'body', 'og', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "content_people" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"role" text NOT NULL,
	"credentials_ar" text DEFAULT '' NOT NULL,
	"credentials_en" text DEFAULT '' NOT NULL,
	"licence_number" text,
	"show_licence" boolean DEFAULT false NOT NULL,
	"bio_md_ar" text DEFAULT '' NOT NULL,
	"bio_md_en" text DEFAULT '' NOT NULL,
	"photo_media_id" uuid,
	"same_as" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_people_slug_key" UNIQUE("slug"),
	CONSTRAINT "content_people_role_check" CHECK ("content_people"."role" in ('author', 'reviewer', 'both'))
);
--> statement-breakpoint
CREATE TABLE "content_publish_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"revision_id" uuid,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_publish_log_from_check" CHECK ("content_publish_log"."from_status" in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')),
	CONSTRAINT "content_publish_log_to_check" CHECK ("content_publish_log"."to_status" in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')),
	CONSTRAINT "content_publish_log_actor_check" CHECK ("content_publish_log"."actor_type" in ('user', 'api_key', 'system'))
);
--> statement-breakpoint
CREATE TABLE "content_review_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"comment" text NOT NULL,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_review_comments_kind_check" CHECK ("content_review_comments"."kind" in ('request_changes', 'approve', 'note'))
);
--> statement-breakpoint
CREATE TABLE "content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"item_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	"definition" text DEFAULT '' NOT NULL,
	"body_md" text NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"toc" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"reading_minutes" integer DEFAULT 1 NOT NULL,
	"minhash" "bytea",
	"quality" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_by_api_key_id" uuid,
	"created_by_name" text NOT NULL,
	"diff_stats" jsonb DEFAULT '{"added":0,"removed":0}'::jsonb NOT NULL,
	"parent_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_revisions_item_number_key" UNIQUE("item_id","number"),
	CONSTRAINT "content_revisions_kind_check" CHECK ("content_revisions"."kind" in ('create', 'save', 'submit', 'approve', 'publish', 'restore', 'api'))
);
--> statement-breakpoint
CREATE TABLE "content_tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug_ar" text,
	"slug_en" text,
	"name_ar" text NOT NULL,
	"name_en" text,
	"description_ar" text DEFAULT '' NOT NULL,
	"description_en" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_tags_slug_ar_key" UNIQUE("slug_ar"),
	CONSTRAINT "content_tags_slug_en_key" UNIQUE("slug_en"),
	CONSTRAINT "content_tags_slug_check" CHECK ("content_tags"."slug_ar" is not null or "content_tags"."slug_en" is not null)
);
--> statement-breakpoint
CREATE TABLE "slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"from_path" text NOT NULL,
	"to_path" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slug_redirects_from_path_key" UNIQUE("from_path"),
	CONSTRAINT "slug_redirects_reason_check" CHECK ("slug_redirects"."reason" in ('slug_changed', 'archived', 'manual', 'merged')),
	CONSTRAINT "slug_redirects_paths_check" CHECK ("slug_redirects"."from_path" <> "slug_redirects"."to_path"),
	CONSTRAINT "slug_redirects_leading_slash_check" CHECK ("slug_redirects"."from_path" like '/%' and "slug_redirects"."to_path" like '/%')
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "original_filename" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "seo_filename" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "credit" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "licence" text DEFAULT 'own' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "licence_ref" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_autosaves" ADD CONSTRAINT "content_autosaves_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_autosaves" ADD CONSTRAINT "content_autosaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_categories" ADD CONSTRAINT "content_categories_parent_id_content_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."content_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_categories" ADD CONSTRAINT "content_categories_default_reviewer_id_content_people_id_fk" FOREIGN KEY ("default_reviewer_id") REFERENCES "public"."content_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_corrections" ADD CONSTRAINT "content_corrections_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_corrections" ADD CONSTRAINT "content_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_entities" ADD CONSTRAINT "content_entities_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_tags" ADD CONSTRAINT "content_item_tags_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_item_tags" ADD CONSTRAINT "content_item_tags_tag_id_content_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."content_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_category_id_content_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."content_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_primary_author_id_content_people_id_fk" FOREIGN KEY ("primary_author_id") REFERENCES "public"."content_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_reviewer_id_content_people_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."content_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_featured_media_id_media_assets_id_fk" FOREIGN KEY ("featured_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_links" ADD CONSTRAINT "content_links_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_links" ADD CONSTRAINT "content_links_target_item_id_content_items_id_fk" FOREIGN KEY ("target_item_id") REFERENCES "public"."content_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_media_refs" ADD CONSTRAINT "content_media_refs_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_media_refs" ADD CONSTRAINT "content_media_refs_media_id_media_assets_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "content_people_photo_media_id_media_assets_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_people" ADD CONSTRAINT "content_people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_publish_log" ADD CONSTRAINT "content_publish_log_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_review_comments" ADD CONSTRAINT "content_review_comments_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_review_comments" ADD CONSTRAINT "content_review_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_item_id_content_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slug_redirects" ADD CONSTRAINT "slug_redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_categories_parent_idx" ON "content_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "content_entities_kind_slug_idx" ON "content_entities" USING btree ("kind","slug");--> statement-breakpoint
CREATE INDEX "content_item_tags_tag_idx" ON "content_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_items_api_external_key" ON "content_items" USING btree ("api_key_id","external_id") WHERE "content_items"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "content_items_status_updated_idx" ON "content_items" USING btree ("status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_items_public_list_idx" ON "content_items" USING btree ("type","locale","published_at" DESC NULLS LAST) WHERE "content_items"."published_revision_id" is not null;--> statement-breakpoint
CREATE INDEX "content_items_scheduled_idx" ON "content_items" USING btree ("scheduled_at") WHERE "content_items"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "content_items_category_idx" ON "content_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "content_items_author_idx" ON "content_items" USING btree ("primary_author_id");--> statement-breakpoint
CREATE INDEX "content_items_reviewer_idx" ON "content_items" USING btree ("reviewer_id") WHERE "content_items"."status" = 'in_review';--> statement-breakpoint
CREATE INDEX "content_items_search_tsv_idx" ON "content_items" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "content_items_title_trgm_idx" ON "content_items" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "content_links_item_idx" ON "content_links" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "content_links_target_idx" ON "content_links" USING btree ("target_item_id") WHERE "content_links"."target_item_id" is not null;--> statement-breakpoint
CREATE INDEX "content_links_external_host_idx" ON "content_links" USING btree ("host") WHERE "content_links"."kind" = 'external';--> statement-breakpoint
CREATE INDEX "content_media_refs_media_idx" ON "content_media_refs" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_people_user_id_key" ON "content_people" USING btree ("user_id") WHERE "content_people"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "content_publish_log_item_at_idx" ON "content_publish_log" USING btree ("item_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "content_publish_log_status_at_idx" ON "content_publish_log" USING btree ("to_status","at");--> statement-breakpoint
CREATE INDEX "content_review_comments_item_idx" ON "content_review_comments" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "content_revisions_item_number_idx" ON "content_revisions" USING btree ("item_id","number" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "slug_redirects_to_path_idx" ON "slug_redirects" USING btree ("to_path");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_licence_check" CHECK ("media_assets"."licence" in ('own', 'licensed', 'cc-by', 'public-domain', 'ai-generated'));--> statement-breakpoint
-- The pointers between content_items and content_revisions are circular (and revisions chain to their
-- parent), so Drizzle declares them as plain uuid columns. DEFERRABLE INITIALLY DEFERRED lets one
-- transaction insert an item and its first revision in either order.
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_current_revision_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_reviewed_revision_id_fk" FOREIGN KEY ("reviewed_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_published_revision_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_submitted_revision_id_fk" FOREIGN KEY ("submitted_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "content_revisions" ADD CONSTRAINT "content_revisions_parent_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."content_revisions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
-- Revisions are immutable history (CONTENT-PLATFORM §11.1): no DELETE, and no UPDATE of anything an
-- author wrote. The derived columns (body_html, toc, word_count, reading_minutes, minhash, quality,
-- diff_stats) stay updatable so a renderer upgrade can re-render old revisions.
CREATE FUNCTION "content_revisions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'content_revisions rows are immutable: DELETE is not allowed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."item_id" IS DISTINCT FROM OLD."item_id"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."excerpt" IS DISTINCT FROM OLD."excerpt"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."body_md" IS DISTINCT FROM OLD."body_md"
    OR NEW."note" IS DISTINCT FROM OLD."note"
    -- ON DELETE SET NULL of the author's user row must still work (user deletion), so only a
    -- change to something other than NULL is refused; created_by_name keeps the snapshot.
    OR (NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id" AND NEW."created_by_user_id" IS NOT NULL)
    OR NEW."created_by_api_key_id" IS DISTINCT FROM OLD."created_by_api_key_id"
    OR NEW."created_by_name" IS DISTINCT FROM OLD."created_by_name"
    OR NEW."parent_revision_id" IS DISTINCT FROM OLD."parent_revision_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'content_revisions rows are immutable: authored columns cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_revisions_guard" BEFORE UPDATE OR DELETE ON "content_revisions" FOR EACH ROW EXECUTE FUNCTION "content_revisions_guard"();--> statement-breakpoint
-- Data migration (DATABASE.md seed policy): the seed never touches an existing role, so the content
-- permissions reach the existing admin / marketing roles here. super_admin is a wildcard.
INSERT INTO "role_permissions" ("role_key", "permission")
SELECT "r"."key", "v"."permission"
FROM (VALUES
  ('admin', 'content.read'),
  ('admin', 'content.write'),
  ('admin', 'content.publish'),
  ('admin', 'content.review'),
  ('admin', 'content.manage'),
  ('marketing', 'content.read'),
  ('marketing', 'content.write'),
  ('marketing', 'content.publish')
) AS "v"("role_key", "permission")
JOIN "roles" AS "r" ON "r"."key" = "v"."role_key"
ON CONFLICT DO NOTHING;
