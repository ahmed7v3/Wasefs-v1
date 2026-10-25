import {
  MEDIA_LICENCES,
  MEDIA_MIMES,
  MEDIA_SHA256_PATTERN,
  MEDIA_STATUSES,
  type MediaVariant,
} from "@wasfa/shared/schemas/media";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * The public media library (Phase 4, WP2). One row per distinct original image (`sha256` of the
 * uploaded bytes is unique: re-uploading the same picture reuses the asset). The browser PUTs the
 * original to `original_key` under the `staging/` prefix of the public media bucket; the worker
 * validates it, writes content-addressed variants under `media/<sha256>/` and deletes the staging
 * object, so `original_key` is only meaningful while the asset is `staged` or `processing`.
 * `variants` holds `{format, width, key, bytes}` entries. The mime type contains `/`, which
 * `inList()` refuses, so its CHECK is a pattern built from the same tuple.
 */
export const mediaAssets = pgTable(
  "media_assets",
  {
    id: idColumn(),
    sha256: text().notNull().unique("media_assets_sha256_key"),
    status: text({ enum: MEDIA_STATUSES }).notNull().default("staged"),
    originalKey: text(),
    mime: text({ enum: MEDIA_MIMES }),
    width: integer(),
    height: integer(),
    bytes: integer(),
    // Focal point in percent of the image, used for `object-position` and crops.
    focalX: smallint().notNull().default(50),
    focalY: smallint().notNull().default(50),
    altAr: text(),
    altEn: text(),
    blurDataUrl: text(),
    variants: jsonb()
      .$type<MediaVariant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rejectReason: text(),
    // Content-platform metadata (WP3). All optional except the licence, which defaults to `own`.
    originalFilename: text(),
    seoFilename: text(),
    caption: text(),
    credit: text(),
    licence: text({ enum: MEDIA_LICENCES }).notNull().default("own"),
    licenceRef: text(),
    warnings: jsonb()
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("media_assets_status_check", inList(table.status, MEDIA_STATUSES)),
    check(
      "media_assets_mime_check",
      sql`${table.mime} is null or ${matches(table.mime, `^(${MEDIA_MIMES.join("|")})$`)}`,
    ),
    check("media_assets_licence_check", inList(table.licence, MEDIA_LICENCES)),
    check("media_assets_sha256_check", matches(table.sha256, MEDIA_SHA256_PATTERN.source)),
    check(
      "media_assets_focal_check",
      sql`${table.focalX} between 0 and 100 and ${table.focalY} between 0 and 100`,
    ),
    index("media_assets_status_created_idx").on(table.status, table.createdAt),
  ],
);

export type MediaAssetRecord = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;
