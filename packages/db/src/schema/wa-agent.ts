import { E164_PATTERN } from "@wasfa/shared/identity";
import {
  WA_AGENT_CONVERSATION_STATUSES,
  WA_AGENT_DIRECTIONS,
  WA_AGENT_KINDS,
  WA_AGENT_MAX_TEXT,
  WA_AGENT_MESSAGE_STATUSES,
} from "@wasfa/shared/schemas/wa-agent";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
    index("wa_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("wa_messages_created_idx").on(table.createdAt),
  ],
);

export type WaConversation = typeof waConversations.$inferSelect;
export type WaMessage = typeof waMessages.$inferSelect;
