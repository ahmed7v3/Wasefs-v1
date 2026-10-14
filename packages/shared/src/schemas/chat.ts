import { z } from "zod";

import { AI_MODES, CHAT_MESSAGE_STATUSES } from "../ai.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * The `/ai` assistant contract (Phase 2, Task 2.11): chats, messages and the SSE events of
 * `POST /ai/chats/:id/messages`. The web app parses every event with these schemas, so a deploy
 * skew degrades to "ignore the unknown event" instead of a crash.
 */

const isoDate = z.iso.datetime({ offset: true });

/**
 * Skills a chat can be started with (folders of `skills/` whose `tasks` include `chat`). The
 * prescription skill is not here on purpose: a structured reading always goes through `/analyze`.
 */
export const CHAT_SKILLS = [
  "drug-info",
  "lab-test-interpretation",
  "drug-interaction-check",
  "imaging-educational",
  "dose-calculator",
] as const;
export type ChatSkill = (typeof CHAT_SKILLS)[number];

export function isChatSkill(value: unknown): value is ChatSkill {
  return typeof value === "string" && (CHAT_SKILLS as readonly string[]).includes(value);
}

export const CHAT_MESSAGE_MAX_CHARS = 8_000;
export const CHAT_MAX_IMAGES = 4;
export const CHAT_TITLE_MAX_CHARS = 60;
/** Messages per page of `GET /ai/chats/:id/messages`. */
export const CHAT_MESSAGES_PAGE = 50;
/** The server sends a heartbeat this often so a proxy or Cloudflare never sees an idle stream. */
export const CHAT_HEARTBEAT_MS = 15_000;
/** Sources kept per answer. */
export const CHAT_MAX_SOURCES = 10;

export const createChatSchema = z.object({
  skill: z.enum(CHAT_SKILLS).optional(),
  /** What the composer was set to. Chats do not store it (the mode travels with each message). */
  mode: z.enum(AI_MODES).optional(),
});
export type CreateChatInput = z.output<typeof createChatSchema>;

export const updateChatSchema = z
  .object({
    title: z.string().trim().min(1).max(CHAT_TITLE_MAX_CHARS).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.archived !== undefined, {
    message: "nothing to change",
  });
export type UpdateChatInput = z.output<typeof updateChatSchema>;

export const chatListQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  /** `true` lists archived chats only; anything else lists the active ones. */
  archived: z.enum(["true", "false"]).optional(),
});
export type ChatListQuery = z.output<typeof chatListQuerySchema>;

export const chatMessagesQuerySchema = z.object({
  cursor: cursorQuerySchema.shape.cursor,
  limit: z.coerce.number().int().min(1).max(100).default(CHAT_MESSAGES_PAGE),
});
export type ChatMessagesQuery = z.output<typeof chatMessagesQuerySchema>;

export const sendMessageSchema = z
  .object({
    /** Required unless `regenerate` is set (then the stored question is answered again). */
    content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_CHARS).optional(),
    fileIds: z.array(z.uuid()).max(CHAT_MAX_IMAGES).default([]),
    mode: z.enum(AI_MODES),
    search: z.boolean().default(false),
    /** The assistant message to answer again; it must be the last message of the chat. */
    regenerate: z.uuid().optional(),
  })
  .refine((value) => value.regenerate !== undefined || value.content !== undefined, {
    message: "content is required",
    path: ["content"],
  });
export type SendMessageInput = z.output<typeof sendMessageSchema>;

export const chatSummarySchema = z.object({
  id: z.uuid(),
  title: z.string().nullable(),
  skill: z.enum(CHAT_SKILLS).nullable(),
  archived: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ChatSummaryView = z.output<typeof chatSummarySchema>;

export const chatCreatedSchema = z.object({ id: z.uuid() });

export const chatListSchema = z.object({
  items: z.array(chatSummarySchema),
  nextCursor: z.string().nullable(),
});

/** A web source (search grounding). Only http(s) links are ever stored or sent. */
export const chatSourceSchema = z.object({
  url: z.url().refine((value) => /^https?:[/][/]/i.test(value), "http(s) only"),
  title: z.string().max(300),
  domain: z.string().max(253),
});
export type ChatSource = z.output<typeof chatSourceSchema>;

/** Extras of a message kept in `chat_messages.parts`: attached images, sources, how long it thought. */
export const chatPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), fileId: z.uuid() }),
  z.object({ type: z.literal("source") }).extend(chatSourceSchema.shape),
  z.object({ type: z.literal("thought"), seconds: z.number().int().min(0).max(3_600) }),
]);
export type ChatPart = z.output<typeof chatPartSchema>;

export const chatMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  status: z.enum(CHAT_MESSAGE_STATUSES),
  parts: z.array(chatPartSchema),
  creditsCharged: z.number().int().min(0),
  createdAt: isoDate,
});
export type ChatMessageView = z.output<typeof chatMessageSchema>;

export const chatMessagesPageSchema = z.object({
  /** Newest first; the web app reverses a page for display. */
  items: z.array(chatMessageSchema),
  nextCursor: z.string().nullable(),
});

/** The data of each SSE event, keyed by its `event:` name. */
export const CHAT_EVENT_DATA = {
  message_id: z.object({ userMessageId: z.uuid(), assistantMessageId: z.uuid() }),
  text: z.object({ delta: z.string() }),
  thinking: z.object({ delta: z.string() }),
  source: chatSourceSchema,
  credits: z.object({ charged: z.number().int().min(0), balance: z.number().int() }),
  done: z.object({ status: z.enum(["done", "stopped"]) }),
  error: z.object({
    code: z.string(),
    reason: z.string().optional(),
    /** Support reference; present for failures that were stored in `error_events`. */
    ref: z.string().optional(),
  }),
  heartbeat: z.object({}),
} as const;
export type ChatEventName = keyof typeof CHAT_EVENT_DATA;
export const CHAT_EVENT_NAMES = Object.keys(CHAT_EVENT_DATA) as ChatEventName[];

export type ChatEvent = {
  [K in ChatEventName]: { event: K; data: z.output<(typeof CHAT_EVENT_DATA)[K]> };
}[ChatEventName];

export function isChatEventName(value: string): value is ChatEventName {
  return Object.hasOwn(CHAT_EVENT_DATA, value);
}

/** Parses one raw SSE event (`event:` name + JSON `data:`); `null` for unknown names or bad data. */
export function parseChatEvent(name: string, data: string): ChatEvent | null {
  if (!isChatEventName(name)) return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = CHAT_EVENT_DATA[name].safeParse(json);
  return parsed.success ? ({ event: name, data: parsed.data } as ChatEvent) : null;
}
