import {
  FILE_DHASH_PATTERN,
  FILE_MAX_BYTES,
  FILE_MIME_PATTERN,
  FILE_MIMES,
  FILE_MIN_BYTES,
  FILE_PURPOSES,
  FILE_SHA256_PATTERN,
  FILE_STATUSES,
} from "@wasfa/shared/ai";
import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { ownerCheck, ownerColumns } from "./owner.js";
import { users } from "./users.js";

/*
 * Metadata of an uploaded image; the bytes live in R2 (private bucket). The object is deleted after
 * `uploads.retentionDays` and the row is kept with `status = 'deleted'`. `sha256` and `dhash` are
 * null until the upload has been processed. The mime type contains `/`, which `inList()` refuses,
 * so its CHECK is a pattern built from the same tuple.
 */
export const files = pgTable(
  "files",
  {
    id: idColumn(),
    ...ownerColumns(),
    createdBy: uuid().references(() => users.id, { onDelete: "set null" }),
    purpose: text({ enum: FILE_PURPOSES }).notNull(),
    r2Key: text().notNull().unique("files_r2_key_key"),
    mime: text({ enum: FILE_MIMES }).notNull(),
    bytes: integer().notNull(),
    width: integer(),
    height: integer(),
    // Lower-case hex SHA-256 of the processed image: the exact-match cache key.
    sha256: text(),
    // 64-bit perceptual hash as 16 hex characters: near-duplicate hint, same owner only.
    dhash: text(),
    status: text({ enum: FILE_STATUSES }).notNull().default("pending"),
    rejectReason: text(),
    expiresAt: timestamp({ withTimezone: true }),
    ...timestamps(),
  },
  (table) => [
    ownerCheck("files", table),
    check("files_purpose_check", inList(table.purpose, FILE_PURPOSES)),
    check("files_mime_check", matches(table.mime, FILE_MIME_PATTERN.source)),
    check(
      "files_bytes_check",
      sql`${table.bytes} between ${sql.raw(String(FILE_MIN_BYTES))} and ${sql.raw(String(FILE_MAX_BYTES))}`,
    ),
    check("files_status_check", inList(table.status, FILE_STATUSES)),
    check(
      "files_sha256_check",
      sql`${table.sha256} is null or ${matches(table.sha256, FILE_SHA256_PATTERN.source)}`,
    ),
    check(
      "files_dhash_check",
      sql`${table.dhash} is null or ${matches(table.dhash, FILE_DHASH_PATTERN.source)}`,
    ),
    index("files_sha256_idx").on(table.sha256),
    index("files_purpose_sha256_idx")
      .on(table.sha256)
      .where(sql`${table.purpose} = 'payment_proof' and ${table.sha256} is not null`),
    index("files_owner_user_dhash_idx").on(table.ownerUserId, table.dhash),
    index("files_owner_org_dhash_idx").on(table.ownerOrgId, table.dhash),
    // The retention job looks only at objects that still exist.
    index("files_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`${table.status} <> 'deleted'`),
  ],
);

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
