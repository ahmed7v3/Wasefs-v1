import { Inject, Injectable, Optional } from "@nestjs/common";
import { newId } from "@wasfa/shared/ids";
import { WA_AGENT_EVENTS_STREAM } from "@wasfa/shared/schemas/phone";
import {
  WA_AGENT_FOLLOW_UP_WINDOW_MS,
  waAgentEventSchema,
  waAgentRxKey,
  type WaAgentEvent,
  type WaAgentOutboundPart,
  type WaOutboxKind,
} from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { ObjectStorage } from "../../files/object-storage.js";
import { RxService } from "../../rx/rx.service.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { OutboxDeliverer } from "../outbox/deliverer.js";
import { EventPartsBuilder } from "../outbox/outbox-parts.js";
import { WaOutboxRepo } from "../outbox/wa-outbox.repo.js";
import { WaOutboundService } from "../transport/outbound.service.js";
import { StreamConsumer } from "../transport/stream-consumer.js";

import { WaAgentCommerceRepo } from "./agent-commerce.repo.js";

import type { ApiEnv } from "../../config/env.js";
import type { WaConversation } from "@wasfa/db";
import type { Locale } from "@wasfa/shared/i18n";

const GROUP = "wa-agent-events";

/** The agent turn's lock (`WaAgentTurnService`): taking it keeps a follow-up from landing inside a turn. */
const turnLockKey = (conversationId: string) => `wa:agent:turn:${conversationId}`;
const LOCK_MS = 15_000;
/** A handled entry id is remembered this long, so a redelivery (v2) never sends a follow-up twice. */
const DONE_TTL_SECONDS = 7 * 24 * 60 * 60;
const doneKey = (entryId: string) => `wa:agent:events:done:${entryId}`;
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 500;
const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

/**
 * Reads `wa:agent:events` (written by the worker): a payment decision on an order, a prescription
 * reading that ended, or a file the agent asked for (ready, or failed). Each becomes a fixed message in the customer's WhatsApp chat, queued through
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

  private readonly builder: EventPartsBuilder;

  constructor(
    @Inject(API_ENV) apiEnv: ApiEnv,
    logger: PinoLogger,
    private readonly conversations: WaAgentRepo,
    private readonly commerce: WaAgentCommerceRepo,
    private readonly outbound: WaOutboundService,
    rx: RxService,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: ObjectStorage,
    // v2 only: routed results go through the outbox (absent in v1-only wiring).
    @Optional() private readonly outbox?: WaOutboxRepo,
    @Optional() private readonly deliverer?: OutboxDeliverer,
  ) {
    super(apiEnv, logger, WA_AGENT_EVENTS_STREAM, GROUP, {
      isV2: async () => (await settings.get("waAgent")).runtime.v2,
      keepData: true,
    });
    this.logger.setContext("WaAgentEvents");
    this.builder = new EventPartsBuilder(apiEnv.WEB_ORIGIN[0] ?? "", commerce, rx);
  }

  async process(payload: unknown, entryId?: string): Promise<void> {
    const parsed = waAgentEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn("Malformed agent event dropped");
      return;
    }
    const event = parsed.data;
    if (this.outbox !== undefined && (await this.isV2())) {
      await this.intake(event, entryId);
      return;
    }
    // The worker puts no event id in the payload; the entry id is the identity of one event.
    if (entryId !== undefined && (await this.redis.exists(doneKey(entryId))) === 1) return;
    // A file the worker stored is deleted unless a queued message points to it (entries are never retried).
    const stored =
      event.type === "document_ready"
        ? event.mediaKey
        : event.type === "rx_done"
          ? event.pdfKey
          : undefined;
    let sentKeys: string[] = [];
    let failed = false;
    try {
      sentKeys = await this.deliver(event);
      if (entryId !== undefined)
        await this.redis.set(doneKey(entryId), "1", "EX", DONE_TTL_SECONDS);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // v2 retries a failed entry, so its file must still be there; v1 never retries.
      const retried = failed && (await this.isV2());
      if (stored !== undefined && !sentKeys.includes(stored) && !retried) {
        await this.storage.remove(stored).catch(() => undefined);
      }
    }
  }

  /**
   * v2: the event becomes (or completes) a `wa_outbox` row, which the deliverer sends under the chat's lock.
   * The state transition is the idempotency, so no "done" marker is kept. An analysis started before the
   * switch has no route row: its Redis key still names the chat, and the result gets a `ready` row then.
   */
  private async intake(event: WaAgentEvent, entryId: string | undefined): Promise<void> {
    const outbox = this.outbox;
    if (outbox === undefined) return;
    const payload: Record<string, unknown> = { ...event };
    let created: boolean;
    if ("rxId" in event) {
      if ((await outbox.routeResult(event.rxId, payload)) !== null) {
        this.deliverer?.kick();
        return;
      }
      // A repeated event finds the route already past `waiting`: nothing more to do.
      if (await outbox.hasRoute(event.rxId)) return;
      const conversationId = await this.redis.getdel(waAgentRxKey(event.rxId));
      if (conversationId === null) return await this.dropStored(event);
      created = await this.insert(
        conversationId,
        "rx_result",
        event.rxId,
        `rx:${event.rxId}`,
        payload,
      );
    } else if (event.type === "document_ready" || event.type === "document_failed") {
      const id =
        event.type === "document_ready"
          ? event.mediaKey
          : `failed:${event.conversationId}:${entryId ?? newId()}`;
      created = await this.insert(event.conversationId, "document", null, `doc:${id}`, payload);
    } else {
      const conversation = await this.commerce.recentConversation(
        event.userId,
        new Date(Date.now() - WA_AGENT_FOLLOW_UP_WINDOW_MS),
      );
      if (conversation === null) return;
      // The entry id tells a redelivery from a second decision on the same order (reject, resubmit, reject).
      const key = `pay:${event.type}:${event.orderId}${entryId === undefined ? "" : `:${entryId}`}`;
      created = await this.insert(conversation.id, "payment", event.orderId, key, payload);
    }
    if (created) this.deliverer?.kick();
  }

  private async insert(
    conversationId: string,
    kind: WaOutboxKind,
    refId: string | null,
    idempotencyKey: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    // All of these are results the customer asked for or paid for.
    const row = await this.outbox?.insertReady({
      conversationId,
      kind,
      refId,
      idempotencyKey,
      payload,
      paidWork: true,
    });
    return row !== null && row !== undefined;
  }

  /** A result nobody is waiting for: the PDF the worker stored has no message to go with. */
  private async dropStored(event: WaAgentEvent): Promise<void> {
    if (event.type === "rx_done" && event.pdfKey !== undefined) {
      await this.storage.remove(event.pdfKey).catch(() => undefined);
    }
  }

  /** Queues the follow-up of one event; returns the stored files its messages point to (none when nothing was queued). */
  private async deliver(event: WaAgentEvent): Promise<string[]> {
    const config = await this.settings.get("waAgent");
    if (!config.enabled) return [];
    const locale: Locale = config.language === "en" ? "en" : "ar";

    const conversation = await this.target(event);
    if (conversation === null) return [];
    const parts = await this.builder.parts(event, conversation, config.caps, locale);
    if (parts === null || parts.length === 0) return [];
    if (!(await this.send(conversation.id, parts))) return [];
    this.logger.info({ conversationId: conversation.id, type: event.type }, "Agent follow-up sent");
    return parts.flatMap((part) => ("mediaKey" in part && part.mediaKey ? [part.mediaKey] : []));
  }

  /** The chat to tell: the chat that asked, the rx request's own chat, or the user's chat with a message in the last 24 h. */
  private async target(event: WaAgentEvent): Promise<WaConversation | null> {
    if (event.type === "document_ready" || event.type === "document_failed") {
      return this.conversations.find(event.conversationId);
    }
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
  /** Queues the parts while holding the chat's turn lock, so they do not land inside an agent turn. */
  private async send(conversationId: string, parts: WaAgentOutboundPart[]): Promise<boolean> {
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
      return true;
    } catch (error) {
      // Paused, blocked or switched off: the customer still has the web notification.
      this.logger.info(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Agent follow-up not queued",
      );
      return false;
    } finally {
      if (held) await this.redis.eval(RELEASE_LOCK, 1, key, token);
    }
  }
}
