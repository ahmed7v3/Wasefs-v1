-- Owner-only permanent delete of a content item (CONTENT-PLATFORM §11.1). The revision guard keeps
-- refusing every DELETE except inside purgeItemTx, which sets the transaction-local flag
-- `wasfa.content_purge` = 'on'. The UPDATE rules are unchanged from 0023.
CREATE OR REPLACE FUNCTION "content_revisions_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('wasfa.content_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
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
    OR (NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id" AND NEW."created_by_user_id" IS NOT NULL)
    OR NEW."created_by_api_key_id" IS DISTINCT FROM OLD."created_by_api_key_id"
    OR NEW."created_by_name" IS DISTINCT FROM OLD."created_by_name"
    OR NEW."parent_revision_id" IS DISTINCT FROM OLD."parent_revision_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'content_revisions rows are immutable: authored columns cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
