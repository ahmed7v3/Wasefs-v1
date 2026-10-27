import { customerContact, waConversations, type Database, type Transaction } from "@wasfa/db";
import { WA_AGENT_EVENTS_STREAM, WA_AGENT_STREAM_MAXLEN } from "@wasfa/shared/schemas/phone";
import {
  WA_AGENT_FOLLOW_UP_WINDOW_MS,
  waAgentEventSchema,
  type WaAgentEvent,
} from "@wasfa/shared/schemas/wa-agent";
import { and, eq, gte } from "drizzle-orm";

import { readSetting } from "../settings.js";

import { customerWhatsappOn } from "./customer-channel.js";

import type { Redis } from "ioredis";

/*
 * The worker's half of the WhatsApp agent's follow-ups (docs/WA-AGENT.md section 1): it decides
 * whether the agent should tell a customer about a payment decision, and appends the event to
 * `wa:agent:events`. The api composes and sends the message (fixed text, no model).
 */

/** The payment events the agent follows up; the customer-message path may already cover them. */
export type PaymentFollowUp = Extract<
  WaAgentEvent,
  { type: "order_paid" | "payment_rejected" | "payment_resubmit" }
>;

/**
 * Whether the agent follows up `event`: the agent is on, the account is active and has not stopped
 * WhatsApp messages, the customer wrote to the agent in the last 24 hours (inside the bridge's
 * reply window), and the customer-message path would NOT already deliver this on WhatsApp.
 */
export async function agentShouldFollowUp(
  db: Database | Transaction,
  event: PaymentFollowUp,
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await readSetting(db, "waAgent")).enabled) return false;
  const contact = await customerContact(db, event.userId);
  if (!contact?.active || contact.whatsappOptedOut) return false;
  const whatsapp = (await readSetting(db, "whatsapp")).customerMessages;
  if (customerWhatsappOn(whatsapp.enabled, contact.whatsappJid)) return false;
  const [recent] = await db
    .select({ id: waConversations.id })
    .from(waConversations)
    .where(
      and(
        eq(waConversations.userId, event.userId),
        gte(waConversations.lastInboundAt, new Date(now.getTime() - WA_AGENT_FOLLOW_UP_WINDOW_MS)),
      ),
    )
    .limit(1);
  return recent !== undefined;
}

/** Appends one event for the api's `WaAgentEventsConsumer`. */
export async function pushWaAgentEvent(redis: Redis, event: WaAgentEvent): Promise<void> {
  await redis.xadd(
    WA_AGENT_EVENTS_STREAM,
    "MAXLEN",
    "~",
    WA_AGENT_STREAM_MAXLEN,
    "*",
    "data",
    JSON.stringify(waAgentEventSchema.parse(event)),
  );
}
