import { z } from "zod";

import { E164_PATTERN } from "../identity.js";

import { waDocumentKeySchema } from "./wa-document.js";

/*
 * The three Redis streams of the WhatsApp AI agent (docs/WA-AGENT.md; names in `./phone.ts` next to
 * `wa:inbound`). The bridge appends what customers and the owner wrote to `wa:agent:in`, the api
 * appends replies to `wa:agent:out`, and the bridge reports what it did on `wa:agent:sent`. Every
 * consumer parses with these schemas (AGENT 5.2); a malformed entry is dropped, never retried.
 */

export const WA_AGENT_KINDS = ["text", "image", "audio", "document", "other"] as const;
export type WaAgentKind = (typeof WA_AGENT_KINDS)[number];

export const WA_AGENT_DIRECTIONS = ["in", "out", "owner"] as const;
export type WaAgentDirection = (typeof WA_AGENT_DIRECTIONS)[number];

export const WA_AGENT_MESSAGE_STATUSES = ["received", "queued", "sent", "dropped"] as const;
export type WaAgentMessageStatus = (typeof WA_AGENT_MESSAGE_STATUSES)[number];

export const WA_AGENT_CONVERSATION_STATUSES = ["active", "paused", "blocked"] as const;
export type WaAgentConversationStatus = (typeof WA_AGENT_CONVERSATION_STATUSES)[number];

/** Why an inbound media message has (or lacks) a stored file; null for non-media rows. */
export const WA_MEDIA_STATUSES = [
  "ok",
  "too_large",
  "unsupported_type",
  "download_failed",
  "storage_unavailable",
  "expired",
] as const;
export type WaMediaStatus = (typeof WA_MEDIA_STATUSES)[number];

/** What a `wa_outbox` row delivers to the customer. */
export const WA_OUTBOX_KINDS = ["rx_result", "document", "payment", "notice"] as const;
export type WaOutboxKind = (typeof WA_OUTBOX_KINDS)[number];

export const WA_OUTBOX_STATES = [
  "waiting",
  "ready",
  "delivering",
  "delivered",
  "held",
  "dead",
] as const;
export type WaOutboxState = (typeof WA_OUTBOX_STATES)[number];

export const WA_TOOL_EFFECT_STATES = ["pending", "done"] as const;
export type WaToolEffectState = (typeof WA_TOOL_EFFECT_STATES)[number];

/** Upper bound of a stored message text. */
export const WA_AGENT_MAX_TEXT = 8_000;

/** Media limits enforced by the bridge: anything over becomes kind `other` without media. */
export const WA_AGENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WA_AGENT_MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const WA_AGENT_MAX_AUDIO_SECONDS = 180;
export const WA_AGENT_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // The worker's image pipeline decodes these to JPEG (docs/RX-ENGINE.md S0).
  "image/heic",
  "image/heif",
] as const;
export const WA_AGENT_DOCUMENT_MIMES = ["application/pdf"] as const;

/** Where inbound media lives in the uploads bucket: `wa/<yyyy>/<mm>/<uuid>`. */
export const WA_AGENT_MEDIA_PREFIX = "wa/";
export const waAgentMediaKeySchema = z
  .string()
  .max(200)
  .regex(/^wa\/\d{4}\/\d{2}\/[A-Za-z0-9-]{8,64}$/, "not a wa media key");

/** Redis keys shared by the api (writes pause / block) and the bridge (enforces them). */
export const waAgentPauseKey = (jid: string) => `wa:agent:pause:${jid}`;
export const waAgentBlockKey = (jid: string) => `wa:agent:block:${jid}`;
/** Epoch ms of the chat's last inbound message; the bridge's 24 h window. */
export const waAgentLastInKey = (jid: string) => `wa:agent:lastin:${jid}`;
/** A message id the bridge itself sent (so its echo is not mistaken for the owner typing). */
export const waAgentSentIdKey = (id: string) => `wa:sent:${id}`;
export const WA_AGENT_SENT_ID_TTL_SECONDS = 2 * 24 * 60 * 60;

const jidSchema = z.string().min(1).max(128);

/** One entry of `wa:agent:in`. */
export const waAgentInboundSchema = z.object({
  waMessageId: z.string().min(1).max(128),
  jid: jidSchema,
  /** E.164 from the jid, or null when a LID could not be resolved. */
  phone: z.string().regex(E164_PATTERN).nullable(),
  /** `owner` = the account owner typed into the chat from the phone. */
  direction: z.enum(["in", "owner"]),
  kind: z.enum(WA_AGENT_KINDS),
  text: z.string().max(WA_AGENT_MAX_TEXT).optional(),
  media: z
    .object({
      key: waAgentMediaKeySchema,
      mime: z.string().min(1).max(100),
      bytes: z.number().int().min(0),
      seconds: z.number().int().min(0).optional(),
    })
    .optional(),
  /** Why a media message has no stored file; `ok` with media. Absent for text. */
  mediaStatus: z.enum(WA_MEDIA_STATUSES).optional(),
  pushName: z.string().max(100).optional(),
  /** Epoch milliseconds the message was sent. */
  ts: z.number().int().positive(),
});
export type WaAgentInbound = z.output<typeof waAgentInboundSchema>;

/** A key the bridge may read from the uploads bucket to send. */
const outboundMediaKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/)
  .refine((key) => !key.includes(".."), "no path traversal");

export const WA_AGENT_HARD_MAX_PARTS = 10;
export const WA_AGENT_HARD_MAX_CHARS = 4_000;

/**
 * True when `url` is a plain file under the public media origin (`MEDIA_PUBLIC_ORIGIN`): the only
 * kind of address the agent may hand to WhatsApp to fetch. An unset origin allows nothing.
 */
export function isMediaOriginUrl(url: string, origin: string): boolean {
  const base = origin.replace(/\/+$/, "");
  if (base === "" || !url.startsWith(`${base}/`)) return false;
  const rest = url.slice(base.length + 1);
  return rest !== "" && !/[\s?#\\]/.test(rest) && !rest.split("/").includes("..");
}

const hasOneSource = (part: { mediaKey?: string | undefined; url?: string | undefined }) =>
  (part.mediaKey === undefined) !== (part.url === undefined);

/**
 * `mediaOrigin` narrows url parts to the public media library; leave it out where the origin is
 * unknown (the bridge checks the same rule against its own environment).
 */
export function waAgentPartSchema(
  maxReplyChars: number = WA_AGENT_HARD_MAX_CHARS,
  mediaOrigin?: string,
) {
  const url = z
    .url({ protocol: /^https?$/ })
    .max(2_048)
    .refine((value) => mediaOrigin === undefined || isMediaOriginUrl(value, mediaOrigin), {
      message: "not a media library url",
    })
    .optional();
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(maxReplyChars) }),
    // An image or document is either a stored upload (`mediaKey`) or a public media url, never both.
    z
      .object({
        kind: z.literal("image"),
        mediaKey: outboundMediaKey.optional(),
        url,
        caption: z.string().max(1_024).optional(),
      })
      .refine(hasOneSource, { message: "mediaKey or url", path: ["mediaKey"] }),
    z
      .object({
        kind: z.literal("document"),
        mediaKey: outboundMediaKey.optional(),
        url,
        fileName: z.string().min(1).max(120),
      })
      .refine(hasOneSource, { message: "mediaKey or url", path: ["mediaKey"] }),
    z.object({ kind: z.literal("voice"), mediaKey: outboundMediaKey }),
  ]);
}
export type WaAgentOutboundPart = z.output<ReturnType<typeof waAgentPartSchema>>;

/** The parts of one agent turn, bounded by the admin caps (`waAgent.caps`). */
export function waAgentOutboundFor(
  caps: { maxReplyChars: number; maxMessagesPerTurn: number },
  mediaOrigin?: string,
) {
  return z
    .array(waAgentPartSchema(caps.maxReplyChars, mediaOrigin))
    .min(1)
    .max(caps.maxMessagesPerTurn);
}

/** The parts at the hard code limits; the service narrows them to the admin caps. */
export const waAgentOutboundSchema = waAgentOutboundFor({
  maxReplyChars: WA_AGENT_HARD_MAX_CHARS,
  maxMessagesPerTurn: WA_AGENT_HARD_MAX_PARTS,
});

/** One entry of `wa:agent:out`: `messageIds[i]` is the `wa_messages` row of `parts[i]`. */
export const waAgentOutEntrySchema = z
  .object({
    conversationId: z.uuid(),
    messageIds: z.array(z.uuid()).min(1).max(WA_AGENT_HARD_MAX_PARTS),
    jid: jidSchema,
    parts: waAgentOutboundSchema,
  })
  .refine((entry) => entry.messageIds.length === entry.parts.length, {
    message: "messageIds and parts must have the same length",
    path: ["messageIds"],
  });
export type WaAgentOutEntry = z.output<typeof waAgentOutEntrySchema>;

export const WA_AGENT_DROP_REASONS = [
  "disabled",
  "no_recent_inbound",
  "paused",
  "blocked",
  "cap_chat_hour",
  "cap_chat_day",
  "cap_total_day",
  "not_connected",
  "stale",
  "send_failed",
  "media_missing",
  "invalid",
] as const;
export type WaAgentDropReason = (typeof WA_AGENT_DROP_REASONS)[number];

/** One entry of `wa:agent:sent`, one per part. */
export const waAgentSentSchema = z.object({
  messageId: z.uuid(),
  status: z.enum(["sent", "dropped"]),
  reason: z.enum(WA_AGENT_DROP_REASONS).optional(),
  waMessageId: z.string().min(1).max(128).optional(),
});
export type WaAgentSent = z.output<typeof waAgentSentSchema>;

/*
 * `wa:agent:events` (worker to api): what happened off the chat that the agent should tell the
 * customer. Entries carry ids only; the api loads the facts itself, for the user the chat belongs
 * to. The follow-up text is fixed (no model), see `WaAgentEventsConsumer`.
 */

/** The order the agent last opened for a chat (`attach_receipt` targets it); value is the order id. */
export const waAgentOrderKey = (conversationId: string) => `wa:agent:order:${conversationId}`;
export const WA_AGENT_ORDER_TTL_SECONDS = 7 * 24 * 60 * 60;
/** The chat that asked for a prescription reading; value is the conversation id. Read by the worker. */
export const waAgentRxKey = (rxId: string) => `wa:agent:rx:${rxId}`;
export const WA_AGENT_RX_TTL_SECONDS = 24 * 60 * 60;
/** A customer message newer than this lets the agent follow up (the bridge's reply window). */
export const WA_AGENT_FOLLOW_UP_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const waAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("order_paid"), userId: z.uuid(), orderId: z.uuid() }),
  z.object({ type: z.literal("payment_rejected"), userId: z.uuid(), orderId: z.uuid() }),
  z.object({ type: z.literal("payment_resubmit"), userId: z.uuid(), orderId: z.uuid() }),
  // `pdfKey`: the PDF of the result the worker rendered (absent when rendering failed or is off).
  z.object({ type: z.literal("rx_done"), rxId: z.uuid(), pdfKey: waDocumentKeySchema.optional() }),
  z.object({ type: z.literal("rx_failed"), rxId: z.uuid() }),
  // A file the agent asked for (`create_document`) is stored and ready to send, or could not be made.
  z.object({
    type: z.literal("document_ready"),
    conversationId: z.uuid(),
    mediaKey: waDocumentKeySchema,
    fileName: z.string().min(1).max(120),
    kind: z.enum(["document", "image"]),
  }),
  z.object({ type: z.literal("document_failed"), conversationId: z.uuid() }),
]);
export type WaAgentEvent = z.output<typeof waAgentEventSchema>;

/*
 * `wa:agent:dlq`: entries a stream consumer gave up on (5 deliveries, handler kept throwing). A row
 * names the source entry and the error class; it never carries customer text or phones (the
 * inbound stream keeps only `waMessageId` and `kind`). Replay re-adds the source entry.
 */

/** A Redis stream entry id, e.g. `1730000000000-0`. */
export const streamEntryIdSchema = z.string().regex(/^\d{1,16}-\d{1,10}$/);

export const waAgentDlqIdParamSchema = z.object({ id: streamEntryIdSchema });

export const waAgentDlqQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const waAgentDlqEntrySchema = z.object({
  id: streamEntryIdSchema,
  stream: z.string().max(100),
  entryId: z.string().max(40),
  group: z.string().max(100),
  errorClass: z.string().max(100),
  deliveries: z.number().int().min(1),
  at: z.iso.datetime({ offset: true }),
  /** Ids and statuses only; present for the events and sent streams. */
  data: z.string().max(2_000).nullable(),
  waMessageId: z.string().max(128).nullable(),
  kind: z.string().max(40).nullable(),
});
export type WaAgentDlqEntry = z.output<typeof waAgentDlqEntrySchema>;

export const waAgentDlqListSchema = z.object({
  total: z.number().int().min(0),
  entries: z.array(waAgentDlqEntrySchema),
});
export type WaAgentDlqList = z.output<typeof waAgentDlqListSchema>;

/** `gone`: the source entry was trimmed from its stream, so there is nothing to re-add. */
export const waAgentDlqReplaySchema = z.object({ status: z.enum(["replayed", "gone"]) });
export type WaAgentDlqReplay = z.output<typeof waAgentDlqReplaySchema>;
