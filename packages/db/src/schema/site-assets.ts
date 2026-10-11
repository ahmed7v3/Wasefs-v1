import {
  BRANDING_ASSET_KEYS,
  BRANDING_ASSET_MAX_BYTES,
  BRANDING_ASSET_TYPES,
} from "@wasfa/shared/schemas/branding";
import { sql } from "drizzle-orm";
import { check, customType, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { inList, timestamps } from "./columns.js";
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
 * Brand images uploaded from the admin panel (logo, dark logo, favicon): at most one row per key,
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
