import { Inject, Injectable } from "@nestjs/common";
import { newId } from "@wasfa/shared/ids";
import { WA_AGENT_EVENTS_STREAM } from "@wasfa/shared/schemas/phone";
import {
  WA_AGENT_FOLLOW_UP_WINDOW_MS,
  waAgentEventSchema,
  waAgentRxKey,
  type WaAgentEvent,
  type WaAgentOutboundPart,
} from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { RxService } from "../../rx/rx.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { StreamConsumer } from "../stream-consumer.js";
import { WaAgentRepo } from "../wa-agent.repo.js";
import { WaOutboundService } from "../wa-outbound.service.js";

import { WaAgentCommerceRepo } from "./agent-commerce.repo.js";
import { paymentMessage, rxDoneParts, rxFailedText } from "./agent-event-messages.js";
import { agentUser } from "./agent-user.js";

import type { ApiEnv } from "../../config/env.js";
import type { WaConversation } from "@wasfa/db";
import type { Locale } from "@wasfa/shared/i18n";

const GROUP = "wa-agent-events";

/** The agent turn's lock (`WaAgentTurnService`): taking it keeps a follow-up from landing inside a turn. */
const turnLockKey = (conversationId: string) => `wa:agent:turn:${conversationId}`;
const LOCK_MS = 15_000;
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 500;
const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

type PaymentEvent = Extract<WaAgentEvent, { orderId: string }>;
type RxEvent = Extract<WaAgentEvent, { rxId: string }>;

/**
 * Reads `wa:agent:events` (written by the worker): a payment decision on an order, or a prescription
 * reading that ended. Each becomes a fixed message in the customer's WhatsApp chat, queued through
 * `WaOutboundService` (so the pause, block, switch and 24 h rules apply). No model is involved: the
 * words are i18n, the facts are read for the account the chat belongs to. Logs ids only.
 */
@Injectable()
export class WaAgentEventsConsumer extends StreamConsumer {
  /** Waits of the turn lock; tests shorten them. */
  readonly timing = {
    lockWaitMs: LOCK_WAIT_MS,
    pollMs: LOCK_POLL_MS,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };

  constructor(
    @Inject(API_ENV) private readonly apiEnv: ApiEnv,
    logger: PinoLogger,
    private readonly conversations: WaAgentRepo,
    private readonly commerce: WaAgentCommerceRepo,
    private readonly outbound: WaOutboundService,
    private readonly rx: RxService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {
    super(apiEnv, logger, WA_AGENT_EVENTS_STREAM, GROUP);
    this.logger.setContext("WaAgentEvents");
  }

  async process(payload: unknown): Promise<void> {
    const parsed = waAgentEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Malformed agent event dropped");
      return;
    }
    const event = parsed.data;
    const config = await this.settings.get("waAgent");
    if (!config.enabled) return;
    const locale: Locale = config.language === "en" ? "en" : "ar";

    const conversation = await this.target(event);
    if (conversation === null) return;
    const texts =
      "rxId" in event
        ? await this.rxTexts(event, conversation, config.caps, locale)
        : await this.paymentTexts(event, locale);
    if (texts === null || texts.length === 0) return;
    await this.send(
      conversation.id,
      texts.map((text): WaAgentOutboundPart => ({ kind: "text", text })),
    );
    this.logger.info({ conversationId: conversation.id, type: event.type }, "Agent follow-up sent");
  }

  /** The chat to tell: the rx request's own chat, or the user's chat with a message in the last 24 h. */
  private async target(event: WaAgentEvent): Promise<WaConversation | null> {
    if ("rxId" in event) {
      // Consumed once: a redelivered entry finds no key and sends nothing twice.
      const conversationId = await this.redis.getdel(waAgentRxKey(event.rxId));
      return conversationId === null ? null : this.conversations.find(conversationId);
    }
    return this.commerce.recentConversation(
      event.userId,
      new Date(Date.now() - WA_AGENT_FOLLOW_UP_WINDOW_MS),
    );
  }

  private async paymentTexts(event: PaymentEvent, locale: Locale): Promise<string[] | null> {
    // Scoped to the user in the event: an order of anyone else is simply not found.
    const row = await this.commerce.orderWithPayment(event.userId, event.orderId);
    if (!row) return null;
    const plan = row.order.planId === null ? null : await this.commerce.plan(row.order.planId);
    return [
      paymentMessage(
        event.type,
        {
          number: row.order.number,
          planName: plan === null ? null : locale === "en" ? plan.nameEn : plan.nameAr,
          rejectReason: row.payment.rejectReason,
        },
        locale,
      ),
    ];
  }

  private async rxTexts(
    event: RxEvent,
    conversation: WaConversation,
    caps: { maxReplyChars: number; maxMessagesPerTurn: number },
    locale: Locale,
  ): Promise<string[] | null> {
    if (event.type === "rx_failed") return [rxFailedText(locale)];
    if (conversation.userId === null) return null;
    const row = await this.commerce.user(conversation.userId);
    if (row?.status !== "active") return null;
    // The analysis is read as its owner: someone else's analysis id is simply not found.
    const view = await this.rx.get(agentUser(row, new Date()), event.rxId);
    if (view.result === null) return [rxFailedText(locale)];
    const origin = this.apiEnv.WEB_ORIGIN[0] ?? "";
    return rxDoneParts(view.result, `${origin}/analyze/${event.rxId}`, caps, locale);
  }

  /** Queues the parts while holding the chat's turn lock, so they do not land inside an agent turn. */
  private async send(conversationId: string, parts: WaAgentOutboundPart[]): Promise<void> {
    const token = newId();
    const key = turnLockKey(conversationId);
    const { lockWaitMs, pollMs, sleep } = this.timing;
    let held = false;
    for (let waited = 0; waited <= lockWaitMs; waited += pollMs) {
      held = (await this.redis.set(key, token, "PX", LOCK_MS, "NX")) === "OK";
      if (held) break;
      await sleep(pollMs);
    }
    // A turn that outlives the wait is not worth blocking the stream for: send anyway.
    try {
      await this.outbound.enqueue(conversationId, parts);
    } catch (error) {
      // Paused, blocked or switched off: the customer still has the web notification.
      this.logger.info(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Agent follow-up not queued",
      );
    } finally {
      if (held) await this.redis.eval(RELEASE_LOCK, 1, key, token);
    }
  }
}
