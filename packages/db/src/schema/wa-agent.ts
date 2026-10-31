import { E164_PATTERN } from "@wasfa/shared/identity";
import {
  WA_AGENT_CONVERSATION_STATUSES,
  WA_AGENT_DIRECTIONS,
  WA_AGENT_KINDS,
  WA_AGENT_MAX_TEXT,
  WA_AGENT_MESSAGE_STATUSES,
  WA_MEDIA_STATUSES,
  WA_OUTBOX_KINDS,
  WA_OUTBOX_STATES,
  WA_TOOL_EFFECT_STATES,
} from "@wasfa/shared/schemas/wa-agent";
import { FAILURE_CLASSES, WA_TURN_STATES } from "@wasfa/shared/wa-agent/failure";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { idColumn, inList, matches, timestamps } from "./columns.js";
import { users } from "./users.js";

/*
 * The WhatsApp AI agent's transcript (docs/WA-AGENT.md). One conversation per WhatsApp chat (`jid`);
 * it may or may not be linked to an account (`user_id` is re-resolved from the verified phone on every
 * inbound message). Transcripts are health-adjacent: admin-only, and deleted after
 * `waAgent.retentionDays` together with their media in R2 (worker job `wa-agent.retention`).
 */
export const waConversations = pgTable(
  "wa_conversations",
  {
    id: idColumn(),
    // The phone-number jid, or the LID jid when WhatsApp did not tell us the number.
    jid: text().notNull().unique("wa_conversations_jid_key"),
    phone: text(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    status: text({ enum: WA_AGENT_CONVERSATION_STATUSES }).notNull().default("active"),
    pausedUntil: timestamp({ withTimezone: true }),
    lastInboundAt: timestamp({ withTimezone: true }),
    lastOutboundAt: timestamp({ withTimezone: true }),
    summary: text(),
    // Fencing authority: bumped when a turn takes the lock, so a stale worker's writes fail the check.
    turnFence: bigint({ mode: "number" }).notNull().default(0),
    ...timestamps(),
  },
  (table) => [
    check("wa_conversations_status_check", inList(table.status, WA_AGENT_CONVERSATION_STATUSES)),
    check(
      "wa_conversations_phone_format_check",
      sql`${table.phone} is null or ${matches(table.phone, E164_PATTERN.source)}`,
    ),
    index("wa_conversations_user_idx").on(table.userId),
  ],
);

/*
 * One attempt-chain to answer a set of inbound messages (docs/WA-AGENT-RUNTIME.md §17.1). `fence` is the
 * conversation's `turn_fence` when the turn took the lock. `trace` holds codes, timings and counts, never text.
 */
export const waTurns = pgTable(
  "wa_turns",
  {
    id: idColumn(),
    conversationId: uuid()
      .notNull()
      .references(() => waConversations.id, { onDelete: "cascade" }),
    // Filled once conversation sessions exist (WP2).
    sessionId: uuid(),
    state: text({ enum: WA_TURN_STATES }).notNull(),
    fence: bigint({ mode: "number" }).notNull(),
    attempt: integer().notNull().default(1),
    inboundIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    causeClass: text({ enum: FAILURE_CLASSES }),
    errorRef: text(),
    trace: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    costUsdMicros: bigint({ mode: "number" }).notNull().default(0),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check("wa_turns_state_check", inList(table.state, WA_TURN_STATES)),
    check(
      "wa_turns_cause_class_check",
      sql`${table.causeClass} is null or ${inList(table.causeClass, FAILURE_CLASSES)}`,
    ),
    check("wa_turns_trace_check", sql`jsonb_typeof(${table.trace}) = 'object'`),
    index("wa_turns_conversation_started_idx").on(table.conversationId, table.startedAt.desc()),
    // The sweeper only looks at live turns, so the index skips the finished bulk.
    index("wa_turns_live_idx")
      .on(table.state, table.startedAt)
      .where(sql`${table.state} in ('queued', 'running', 'deferred')`),
  ],
);

export const waMessages = pgTable(
  "wa_messages",
  {
    id: idColumn(),
    conversationId: uuid()
      .notNull()
      .references(() => waConversations.id, { onDelete: "cascade" }),
    direction: text({ enum: WA_AGENT_DIRECTIONS }).notNull(),
    kind: text({ enum: WA_AGENT_KINDS }).notNull(),
    text: text(),
    // Object key in the uploads bucket (`wa/<yyyy>/<mm>/<uuid>`).
    mediaKey: text(),
    mediaMime: text(),
    mediaBytes: integer(),
    mediaSeconds: integer(),
    // WhatsApp's own id: unique, so a redelivered stream entry is stored once.
    waMessageId: text().unique("wa_messages_wa_message_id_key"),
    status: text({ enum: WA_AGENT_MESSAGE_STATUSES }).notNull(),
    dropReason: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Why a media message has no usable file; null for non-media rows.
    mediaStatus: text({ enum: WA_MEDIA_STATUSES }),
    // Set only in the transaction that answers the message, so null on an inbound row means "unanswered".
    turnId: uuid().references(() => waTurns.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("wa_messages_direction_check", inList(table.direction, WA_AGENT_DIRECTIONS)),
    check("wa_messages_kind_check", inList(table.kind, WA_AGENT_KINDS)),
    check("wa_messages_status_check", inList(table.status, WA_AGENT_MESSAGE_STATUSES)),
    check(
      "wa_messages_text_check",
      sql`${table.text} is null or char_length(${table.text}) <= ${sql.raw(String(WA_AGENT_MAX_TEXT))}`,
    ),
    check("wa_messages_meta_check", sql`jsonb_typeof(${table.meta}) = 'object'`),
    check(
      "wa_messages_media_status_check",
      sql`${table.mediaStatus} is null or ${inList(table.mediaStatus, WA_MEDIA_STATUSES)}`,
    ),
    index("wa_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("wa_messages_created_idx").on(table.createdAt),
    index("wa_messages_unanswered_idx")
      .on(table.conversationId)
      .where(sql`${table.direction} = 'in' and ${table.turnId} is null`),
  ],
);

/*
 * Proof that a tool's side effect ran. The key is a hash of turn, tool and args (never the args, which can
 * hold customer text), so a re-run of the same turn finds the stored result instead of repeating the effect.
 */
export const waToolEffects = pgTable(
  "wa_tool_effects",
  {
    key: text().primaryKey(),
    turnId: uuid()
      .notNull()
      .references(() => waTurns.id, { onDelete: "cascade" }),
    tool: text().notNull(),
    state: text({ enum: WA_TOOL_EFFECT_STATES }).notNull(),
    result: jsonb().$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (table) => [
    check("wa_tool_effects_state_check", inList(table.state, WA_TOOL_EFFECT_STATES)),
    // The turn FK cascades; without this a turn delete scans the table.
    index("wa_tool_effects_turn_idx").on(table.turnId),
  ],
);

/*
 * Customer-bound results waiting for delivery, independent of the turn that produced them: a result that
 * is ready while the chat is paused is held, not lost. `idempotency_key` makes enqueueing repeatable.
 */
export const waOutbox = pgTable(
  "wa_outbox",
  {
    id: idColumn(),
    conversationId: uuid()
      .notNull()
      .references(() => waConversations.id, { onDelete: "cascade" }),
    kind: text({ enum: WA_OUTBOX_KINDS }).notNull(),
    idempotencyKey: text().notNull().unique("wa_outbox_idempotency_key_key"),
    // The thing being delivered (rx id, document id ...).
    refId: uuid(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    state: text({ enum: WA_OUTBOX_STATES }).notNull(),
    // Credits were spent on it, so delivery may bypass an owner takeover.
    paidWork: boolean().notNull().default(false),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // The failure class only, never customer text.
    lastError: text(),
    ...timestamps(),
    deliveredAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check("wa_outbox_kind_check", inList(table.kind, WA_OUTBOX_KINDS)),
    check("wa_outbox_state_check", inList(table.state, WA_OUTBOX_STATES)),
    check("wa_outbox_payload_check", sql`jsonb_typeof(${table.payload}) = 'object'`),
    index("wa_outbox_due_idx")
      .on(table.state, table.nextAttemptAt)
      .where(sql`${table.state} in ('ready', 'held')`),
    index("wa_outbox_kind_ref_idx").on(table.kind, table.refId),
  ],
);

export type WaConversation = typeof waConversations.$inferSelect;
export type WaMessage = typeof waMessages.$inferSelect;
export type WaTurn = typeof waTurns.$inferSelect;
export type WaToolEffect = typeof waToolEffects.$inferSelect;
export type WaOutboxRow = typeof waOutbox.$inferSelect;
