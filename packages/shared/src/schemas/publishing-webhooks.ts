import { z } from "zod";

export const PUBLISHING_WEBHOOK_EVENTS = [
  "content.created",
  "content.review_requested",
  "content.changes_requested",
  "content.approved",
  "content.published",
  "content.unpublished",
  "content.archived",
  "media.ready",
  "media.failed",
  "key.expiring",
] as const;

export const publishingWebhookEventSchema = z.object({
  keyId: z.uuid().nullable().optional(),
  itemId: z.uuid().nullable().default(null),
  mediaId: z.uuid().nullable().default(null),
  event: z.enum(PUBLISHING_WEBHOOK_EVENTS),
  comment: z.string().max(2_000).nullable().default(null),
});
export type PublishingWebhookEvent = z.output<typeof publishingWebhookEventSchema>;

export const publishingWebhookDeliveryPayloadSchema = z.object({ deliveryId: z.uuid() });
