import { z } from "zod";

import {
  PUBLISHING_CONTENT_TYPES,
  PUBLISHING_DEFAULTS,
  PUBLISHING_KEY_ENVIRONMENTS,
  PUBLISHING_SCOPES,
} from "../publishing.js";

/*
 * Admin contract of the API keys of the Publishing API: `admin/content/api-keys`. Permission
 * `content.api_keys` (new), writes with fresh auth (10 min) and audit. The full key (`secret`) is only
 * ever in the response of create and rotate; every other response carries the masked form.
 */

const isoDate = z.string().datetime();

export const publishingKeyInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  environment: z.enum(PUBLISHING_KEY_ENVIRONMENTS).default("live"),
  scopes: z.array(z.enum(PUBLISHING_SCOPES)).min(1),
  /** false = the key can only create drafts and submit for review. */
  canPublish: z.boolean().default(false),
  requireSignature: z.boolean().default(false),
  /** Optional webhook endpoint. The secret is write-only and never returned. */
  webhookUrl: z.string().url().refine((value) => value.startsWith("https://"), "https_only").nullable().default(null),
  webhookSecret: z.string().trim().min(16).max(256).nullable().default(null),
  /** Empty = every writable type. */
  allowedTypes: z.array(z.enum(PUBLISHING_CONTENT_TYPES)).default([]),
  /** Category slugs the key may use; empty = any. */
  allowedCategorySlugs: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  /** Used when a request names no author. */
  defaultAuthorId: z.string().uuid().nullable().default(null),
  /** Used when a request names no featured image (so an agent can publish without finding one). */
  defaultFeaturedMediaId: z.string().uuid().nullable().default(null),
  /** Publishes per day for this key (also bounded by the global content.maxPublishesPerDay); null = global only. */
  dailyPublishCap: z.number().int().min(1).max(10_000).nullable().default(null),
  requestsPerMinute: z.number().int().min(1).max(6_000).default(PUBLISHING_DEFAULTS.requestsPerMinute),
  /** CIDR or single IPs; empty = any address. */
  ipAllowList: z.array(z.string().trim().min(3).max(64)).max(50).default([]),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(PUBLISHING_DEFAULTS.keyTtlMaxDays)
    .default(PUBLISHING_DEFAULTS.keyTtlDays),
});
export type PublishingKeyInput = z.output<typeof publishingKeyInputSchema>;

/** PATCH: a default-less partial built by the API (never `.partial()` this schema: defaults would be refilled). */
export const publishingKeyUpdatableFields = [
  "name",
  "scopes",
  "canPublish",
  "requireSignature",
  "webhookUrl",
  "webhookSecret",
  "allowedTypes",
  "allowedCategorySlugs",
  "defaultAuthorId",
  "defaultFeaturedMediaId",
  "dailyPublishCap",
  "requestsPerMinute",
  "ipAllowList",
] as const;

export const publishingKeySchema = publishingKeyInputSchema
  .omit({ expiresInDays: true, webhookSecret: true })
  .extend({
    webhookUrl: z.string().url().nullable().optional(),
    webhookSecretConfigured: z.boolean().optional(),
    id: z.string().uuid(),
    /** `wsk_live_<keyId>` : enough to recognise the key, never enough to use it. */
    prefix: z.string(),
    last4: z.string().length(4),
    ownerUserId: z.string().uuid(),
    ownerName: z.string().nullable(),
    createdAt: isoDate,
    expiresAt: isoDate,
    lastUsedAt: isoDate.nullable(),
    revokedAt: isoDate.nullable(),
    /** While set and in the future, the previous secret of a rotation still works. */
    rotationGraceUntil: isoDate.nullable(),
    usage: z.object({
      requestsToday: z.number().int(),
      errorsToday: z.number().int(),
      itemsCreatedToday: z.number().int(),
      publishedToday: z.number().int(),
    }),
  });
export type PublishingKey = z.infer<typeof publishingKeySchema>;
export const publishingKeyListSchema = z.object({ items: z.array(publishingKeySchema) });

/** POST (create) and POST :id/rotate respond with this: the only time the full key is returned. */
export const publishingKeyIssuedSchema = z.object({
  key: publishingKeySchema,
  secret: z.string(),
});
export type PublishingKeyIssued = z.infer<typeof publishingKeyIssuedSchema>;

/** POST :id/rotate */
export const rotatePublishingKeySchema = z.object({
  graceHours: z
    .number()
    .int()
    .min(0)
    .max(PUBLISHING_DEFAULTS.rotateGraceMaxHours)
    .default(PUBLISHING_DEFAULTS.rotateGraceHours),
});

/*
 * Routes (all `admin/content/api-keys`): GET -> list; POST (body publishingKeyInputSchema) -> issued;
 * PATCH :id (partial of publishingKeyUpdatableFields) -> key; POST :id/revoke -> key (immediate);
 * POST :id/rotate (rotatePublishingKeySchema) -> issued; GET :id/requests?limit=50 -> recent requests
 * of this key (method, route, status, latency, errorCode, itemId, at).
 */
export const publishingKeyRequestSchema = z.object({
  at: isoDate,
  method: z.string(),
  route: z.string(),
  status: z.number().int(),
  latencyMs: z.number().int(),
  errorCode: z.string().nullable(),
  itemId: z.string().nullable(),
});
export const publishingKeyRequestListSchema = z.object({
  items: z.array(publishingKeyRequestSchema),
});

export const publishingWebhookDeliverySchema = z.object({
  id: z.string().uuid(),
  event: z.string(),
  status: z.enum(["pending", "succeeded", "failed"]),
  attempts: z.number().int(),
  responseStatus: z.number().int().nullable(),
  error: z.string().nullable(),
  createdAt: isoDate,
  deliveredAt: isoDate.nullable(),
});
export const publishingWebhookDeliveryListSchema = z.object({ items: z.array(publishingWebhookDeliverySchema) });
