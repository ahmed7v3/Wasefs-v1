import {
  PUBLISHING_CONTENT_TYPES,
  PUBLISHING_KEY_ENVIRONMENTS,
  PUBLISHING_SCOPES,
} from "@wasfa/shared/publishing";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { arrayWithin, idColumn, inList } from "./columns.js";
import { contentPeople } from "./content.js";
import { mediaAssets } from "./media.js";
import { users } from "./users.js";

/*
 * Machine credentials of the Publishing API (docs/PUBLISHING-API.md section 3). `key_id` is public and
 * looked up; only an HMAC of the secret is stored (`secret_hash`), plus the previous hash while a
 * rotation grace period runs (`prev_valid_until`). The full key is never stored or logged.
 */
export const publishingApiKeys = pgTable(
  "publishing_api_keys",
  {
    id: idColumn(),
    keyId: text().notNull().unique("publishing_api_keys_key_id_key"),
    environment: text({ enum: PUBLISHING_KEY_ENVIRONMENTS }).notNull().default("live"),
    secretHash: text().notNull(),
    prevSecretHash: text(),
    prevValidUntil: timestamp({ withTimezone: true }),
    last4: text().notNull(),
    name: text().notNull(),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id),
    scopes: text().array().notNull(),
    canPublish: boolean().notNull().default(false),
    requireSignature: boolean().notNull().default(false),
    /** AES-256-GCM sealed webhook endpoint and signing secret; plaintext is never persisted. */
    webhookUrlEnc: text(),
    webhookSecretEnc: text(),
    allowedTypes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedCategorySlugs: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultAuthorId: uuid().references(() => contentPeople.id, { onDelete: "set null" }),
    defaultFeaturedMediaId: uuid().references(() => mediaAssets.id, { onDelete: "set null" }),
    dailyPublishCap: integer(),
    requestsPerMinute: integer().notNull().default(60),
    ipAllowList: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check(
      "publishing_api_keys_environment_check",
      inList(table.environment, PUBLISHING_KEY_ENVIRONMENTS),
    ),
    check("publishing_api_keys_key_id_check", sql`${table.keyId} ~ '^[A-Za-z0-9]{12}$'`),
    check("publishing_api_keys_scopes_check", arrayWithin(table.scopes, PUBLISHING_SCOPES)),
    check(
      "publishing_api_keys_allowed_types_check",
      arrayWithin(table.allowedTypes, PUBLISHING_CONTENT_TYPES),
    ),
    check(
      "publishing_api_keys_requests_per_minute_check",
      sql`${table.requestsPerMinute} between 1 and 6000`,
    ),
    check(
      "publishing_api_keys_daily_publish_cap_check",
      sql`${table.dailyPublishCap} is null or ${table.dailyPublishCap} between 1 and 10000`,
    ),
    index("publishing_api_keys_owner_idx").on(table.ownerUserId),
  ],
);
type PublishingApiKeyColumns = typeof publishingApiKeys.$inferSelect;
export type PublishingApiKeyRow = Omit<PublishingApiKeyColumns, "webhookUrlEnc" | "webhookSecretEnc"> &
  Partial<Pick<PublishingApiKeyColumns, "webhookUrlEnc" | "webhookSecretEnc">>;
export type NewPublishingApiKeyRow = typeof publishingApiKeys.$inferInsert;

/**
 * One row per Publishing API call (docs section 10): the route is the TEMPLATE (`/articles/:id`),
 * never the raw URL, and no body is stored. Retention 90 days (`purgeOlderThan`).
 */
export const publishingApiRequests = pgTable(
  "publishing_api_requests",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    keyId: uuid().references(() => publishingApiKeys.id, { onDelete: "set null" }),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    method: text().notNull(),
    route: text().notNull(),
    status: smallint().notNull(),
    latencyMs: integer().notNull(),
    errorCode: text(),
    itemId: text(),
    idempotencyKey: text(),
  },
  (table) => [
    index("publishing_api_requests_key_at_idx").on(table.keyId, table.at),
    index("publishing_api_requests_at_idx").on(table.at),
  ],
);
export type PublishingApiRequestRow = typeof publishingApiRequests.$inferSelect;

/** Durable webhook delivery log. Payload and endpoint credentials are snapshots for stable retries. */
export const publishingWebhookDeliveries = pgTable(
  "publishing_webhook_deliveries",
  {
    id: idColumn(),
    keyId: uuid()
      .notNull()
      .references(() => publishingApiKeys.id, { onDelete: "restrict" }),
    event: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    webhookUrlEnc: text().notNull(),
    webhookSecretEnc: text().notNull(),
    status: text({ enum: ["pending", "succeeded", "failed"] as const })
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    responseStatus: smallint(),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index("publishing_webhook_deliveries_key_created_idx").on(table.keyId, table.createdAt),
    index("publishing_webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt),
  ],
);
export type PublishingWebhookDeliveryRow = typeof publishingWebhookDeliveries.$inferSelect;
