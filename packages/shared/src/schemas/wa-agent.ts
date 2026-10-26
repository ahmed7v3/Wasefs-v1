import { z } from "zod";

import { E164_PATTERN } from "../identity.js";

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

/** Upper bound of a stored message text. */
export const WA_AGENT_MAX_TEXT = 8_000;

/** Media limits enforced by the bridge: anything over becomes kind `other` without media. */
export const WA_AGENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const WA_AGENT_MAX_AUDIO_BYTES = 3 * 1024 * 1024;
export const WA_AGENT_MAX_AUDIO_SECONDS = 180;
export const WA_AGENT_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
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

export function waAgentPartSchema(maxReplyChars: number = WA_AGENT_HARD_MAX_CHARS) {
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1).max(maxReplyChars) }),
    z.object({
      kind: z.literal("image"),
      mediaKey: outboundMediaKey,
      caption: z.string().max(1_024).optional(),
    }),
    z.object({
      kind: z.literal("document"),
      mediaKey: outboundMediaKey,
      fileName: z.string().min(1).max(120),
    }),
    z.object({ kind: z.literal("voice"), mediaKey: outboundMediaKey }),
  ]);
}
export type WaAgentOutboundPart = z.output<ReturnType<typeof waAgentPartSchema>>;

/** The parts of one agent turn, bounded by the admin caps (`waAgent.caps`). */
export function waAgentOutboundFor(caps: { maxReplyChars: number; maxMessagesPerTurn: number }) {
  return z.array(waAgentPartSchema(caps.maxReplyChars)).min(1).max(caps.maxMessagesPerTurn);
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
