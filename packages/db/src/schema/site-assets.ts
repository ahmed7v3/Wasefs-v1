import {
  BRANDING_ASSET_KEYS,
  BRANDING_ASSET_MAX_BYTES,
  BRANDING_ASSET_TYPES,
} from "@wasfa/shared/schemas/branding";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, timestamps } from "./columns.js";
import { users } from "./users.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

// MIME types hold `/`, `+` and `-`, which `inList()` refuses; they come from our own const tuple.
const MIME_LITERAL = /^[a-z]+\/[a-z0-9.+-]+$/;
function mimeList(values: readonly string[]): string {
  return values
    .map((value) => {
      if (!MIME_LITERAL.test(value)) throw new Error(`Unsafe CHECK literal: ${value}`);
      return `'${value}'`;
    })
    .join(", ");
}

/*
 * Brand images uploaded from the admin panel (logos, favicon, the symbol and the icon set): at most one row per key,
 * at most 512 KB, served publicly by `GET /assets/<key>`. Platform data, no owner. The api checks
 * the bytes against the declared type (and SVG against a denylist) before inserting; the CHECKs
 * here only keep the closed sets and the size honest. `updated_by` is "who did it": `SET NULL`.
 */
export const siteAssets = pgTable(
  "site_assets",
  {
    key: text({ enum: BRANDING_ASSET_KEYS }).primaryKey(),
    contentType: text({ enum: BRANDING_ASSET_TYPES }).notNull(),
    data: bytea().notNull(),
    sha256: text().notNull(),
    /** Pixel size read from the file; null when it could not be determined (ICO, SVG without a viewBox). */
    width: integer(),
    height: integer(),
    updatedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (table) => [
    check("site_assets_key_check", inList(table.key, BRANDING_ASSET_KEYS)),
    check(
      "site_assets_content_type_check",
      sql`${table.contentType} in (${sql.raw(mimeList(BRANDING_ASSET_TYPES))})`,
    ),
    check(
      "site_assets_size_check",
      sql`octet_length(${table.data}) between 1 and ${sql.raw(String(BRANDING_ASSET_MAX_BYTES))}`,
    ),
    check("site_assets_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);

export type SiteAsset = typeof siteAssets.$inferSelect;
export type NewSiteAsset = typeof siteAssets.$inferInsert;

/*
 * Earlier versions of a brand image: every write to `site_assets` moves the row it replaces here
 * (same transaction), and the repo keeps the last `BRANDING_HISTORY_KEEP` per key. `revert` takes
 * the newest one back. `replaced_by` is the admin who made the replacement: `SET NULL`.
 */
export const siteAssetHistory = pgTable(
  "site_asset_history",
  {
    id: idColumn(),
    key: text({ enum: BRANDING_ASSET_KEYS }).notNull(),
    contentType: text({ enum: BRANDING_ASSET_TYPES }).notNull(),
    data: bytea().notNull(),
    sha256: text().notNull(),
    width: integer(),
    height: integer(),
    replacedBy: uuid().references(() => users.id, { onDelete: "set null" }),
    replacedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("site_asset_history_key_check", inList(table.key, BRANDING_ASSET_KEYS)),
    check(
      "site_asset_history_content_type_check",
      sql`${table.contentType} in (${sql.raw(mimeList(BRANDING_ASSET_TYPES))})`,
    ),
    check(
      "site_asset_history_size_check",
      sql`octet_length(${table.data}) between 1 and ${sql.raw(String(BRANDING_ASSET_MAX_BYTES))}`,
    ),
    check("site_asset_history_sha256_check", sql`${table.sha256} ~ '^[a-f0-9]{64}$'`),
    index("site_asset_history_key_replaced_idx").on(table.key, table.replacedAt),
  ],
);

export type SiteAssetHistory = typeof siteAssetHistory.$inferSelect;
