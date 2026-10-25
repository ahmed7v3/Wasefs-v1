import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  contentAutosaves,
  contentCategories,
  contentCorrections,
  contentEntities,
  contentItems,
  contentItemTags,
  contentLinks,
  contentMediaRefs,
  contentPeople,
  contentPublishLog,
  contentReviewComments,
  contentRevisions,
  contentTags,
  mediaAssets,
  slugRedirects,
} from "../src/schema/index.js";

// Keys are the TypeScript names; drizzle's camelCase casing maps them to columns at query time.
const columnNames = (table: Parameters<typeof getTableColumns>[0]): string[] =>
  Object.keys(getTableColumns(table));

describe("content platform schema", () => {
  it("names the tables", () => {
    expect(
      [
        contentPeople,
        contentCategories,
        contentTags,
        contentItems,
        contentRevisions,
        contentAutosaves,
        contentItemTags,
        contentLinks,
        contentEntities,
        contentMediaRefs,
        contentCorrections,
        slugRedirects,
        contentPublishLog,
        contentReviewComments,
      ].map(getTableName),
    ).toEqual([
      "content_people",
      "content_categories",
      "content_tags",
      "content_items",
      "content_revisions",
      "content_autosaves",
      "content_item_tags",
      "content_links",
      "content_entities",
      "content_media_refs",
      "content_corrections",
      "slug_redirects",
      "content_publish_log",
      "content_review_comments",
    ]);
  });

  it("maps item pointers and search columns to camelCase", () => {
    const names = columnNames(contentItems);
    for (const name of [
      "translationGroupId",
      "currentRevisionId",
      "reviewedRevisionId",
      "publishedRevisionId",
      "submittedRevisionId",
      "firstPublishedAt",
      "contentUpdatedAt",
      "lockVersion",
      "searchText",
      "searchTsv",
      "apiKeyId",
      "externalId",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("keeps revisions append-only: createdAt but no updatedAt", () => {
    const names = columnNames(contentRevisions);
    expect(names).toContain("createdAt");
    expect(names).not.toContain("updatedAt");
    expect(names).toContain("diffStats");
  });

  it("extends media_assets additively", () => {
    const names = columnNames(mediaAssets);
    for (const name of [
      "originalFilename",
      "seoFilename",
      "caption",
      "credit",
      "licence",
      "licenceRef",
      "warnings",
    ]) {
      expect(names).toContain(name);
    }
  });
});
