import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Publishing API idempotency (docs/PUBLISHING-API.md §4.1): one row per (key, Idempotency-Key header).
 * `request_hash` is the SHA-256 of the canonical request, so the same header with another body is
 * refused; `status` is the HTTP status of the stored answer (null while the first request is still
 * running) and `response` its JSON body. Nothing else is stored: no headers, no secrets. Rows older
 * than 24 h are purged (`purgeExpiredPublishingIdempotency`). `key_id` has no foreign key: the key
 * table belongs to the key slice, and a revoked key's rows simply age out.
 *
 * An item's `external_id` needs no table of its own: `content_items` already carries
 * `(api_key_id, external_id)` with a partial unique index (`content_items_api_external_key`).
 */
export const publishingIdempotency = pgTable(
  "publishing_idempotency",
  {
    keyId: uuid().notNull(),
    idemKey: text().notNull(),
    requestHash: text().notNull(),
    status: integer(),
    response: jsonb().$type<unknown>(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "publishing_idempotency_pkey", columns: [table.keyId, table.idemKey] }),
    index("publishing_idempotency_created_idx").on(table.createdAt),
  ],
);

export type PublishingIdempotencyRow = typeof publishingIdempotency.$inferSelect;
