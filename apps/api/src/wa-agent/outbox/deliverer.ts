import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { type Locale } from "@wasfa/shared/i18n";
import { WA_AGENT_DLQ_STREAM } from "@wasfa/shared/schemas/phone";
import {
  WA_AGENT_FOLLOW_UP_WINDOW_MS,
  waAgentEventSchema,
  type WaAgentEvent,
} from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AdminAlertService } from "../../alerts/alerts.service.js";
import { REDIS } from "../../common/redis.js";
import { API_ENV } from "../../config/config.module.js";
import { ObjectStorage } from "../../files/object-storage.js";
import { SettingsService } from "../../settings/settings.service.js";
import { HANDOFF_ALERT_KIND } from "../agent/handoff.service.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { WaAgentStateService } from "../conversation/state.service.js";
import { WaOutboundService } from "../transport/outbound.service.js";
import { ConversationLock, StaleFenceError } from "../turn/lock.js";
import { TurnRepo } from "../turn/turn.repo.js";
import { WA_OUTBOX_SWEEPS, type OutboxSweep } from "../wa-agent.tokens.js";

import { EventPartsBuilder } from "./outbox-parts.js";
import { WaOutboxRepo } from "./wa-outbox.repo.js";

import type { ApiEnv } from "../../config/env.js";
import type { WaOutboxRow } from "@wasfa/db";

export const SWEEP_EVERY_MS = 5_000;
const BATCH = 20;
const PROMOTE_EVERY_MS = 30_000;
const PROMOTE_GRACE_MS = 30_000;
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 500;
const LOCK_BUSY_RETRY_MS = 10_000;
/** Held items are looked at again this often (a pause ends by itself); a new customer message does it at once. */
const HELD_RECHECK_MS = 60_000;
export const MAX_ATTEMPTS = 8;
/** Waits before attempt 2, 3, 4, 5, then every later one. */
export const BACKOFF_MS = [10_000, 30_000, 120_000, 600_000, 1_800_000] as const;

const errorClass = (error: unknown) => (error instanceof Error ? error.name : "unknown");

/**
 * Delivers `wa_outbox` rows (docs/WA-AGENT-RUNTIME.md §9): results of paid work and worker events, by
 * lock and fence like a turn, so a result never lands inside a reply. A held chat, a closed window or a
 * missing switch holds the item; paid work passes an owner pause (`waAgent.delivery`); failures retry with
 * backoff and end `dead` (dead-letter stream + admin alert). Several api replicas can sweep: rows are
 * claimed with `skip locked`. Logs ids and error classes only.
 */
@Injectable()
export class OutboxDeliverer implements OnModuleInit, OnApplicationShutdown {
  /** Waits for the conversation lock; tests shorten them. */
  readonly timing = {
    lockWaitMs: LOCK_WAIT_MS,
    promoteEveryMs: PROMOTE_EVERY_MS,
    pollMs: LOCK_POLL_MS,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private lastPromote = 0;

  constructor(
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, "NODE_ENV">,
    private readonly rows: WaOutboxRepo,
    private readonly lock: ConversationLock,
    private readonly turns: TurnRepo,
    private readonly conversations: WaAgentRepo,
    private readonly outbound: WaOutboundService,
    private readonly settings: SettingsService,
    private readonly builder: EventPartsBuilder,
    private readonly storage: ObjectStorage,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly alerts: AdminAlertService,
    private readonly logger: PinoLogger,
    @Optional() @Inject(WA_OUTBOX_SWEEPS) private readonly sweeps: OutboxSweep[] = [],
  ) {
    this.logger.setContext("WaOutboxDeliverer");
  }

  onModuleInit(): void {
    // Tests drive `sweep()` themselves, so nothing delivers behind their back.
    if (this.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Something was just written: deliver now instead of at the next tick. */
  kick(): void {
    if (this.env.NODE_ENV !== "test") void this.sweep();
  }

  /** The customer wrote: what was held for the closed window or a pause is due now, before anything else. */
  async onCustomerMessage(conversationId: string): Promise<void> {
    if ((await this.rows.releaseHeld(conversationId)) > 0) this.kick();
  }

  /** One pass; a call during a pass makes the running one go round again. */
  async sweep(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.pass().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async pass(): Promise<void> {
    do {
      this.again = false;
      try {
        await this.rows.recoverStale();
        // rx reconciler sweep is scheduled here
        for (const sweep of this.sweeps) {
          await sweep().catch((error: unknown) => {
            this.logger.warn({ reason: errorClass(error) }, "Outbox sweep callback failed");
          });
        }
        await this.promoteFinished();
        for (const row of await this.rows.claimDue(BATCH)) await this.deliver(row);
      } catch (error) {
        this.logger.error({ reason: errorClass(error) }, "Outbox sweep failed");
      }
    } while (this.again);
  }

  /** Every 30 s: a route whose analysis ended 30 s ago without an event is delivered anyway (the real event normally wins). */
  private async promoteFinished(): Promise<void> {
    if (Date.now() - this.lastPromote < this.timing.promoteEveryMs) return;
    this.lastPromote = Date.now();
    await this.rows.promoteFinished(new Date(Date.now() - PROMOTE_GRACE_MS), BATCH);
  }

  private async deliver(row: WaOutboxRow): Promise<void> {
    const handle = await this.acquire(row.conversationId);
    if (handle === null) {
      await this.rows.requeue(row.id, LOCK_BUSY_RETRY_MS);
      return;
    }
    try {
      // The fence is taken after the lock, like a turn: a holder that lost the lock cannot commit.
      const fence = await this.turns.bumpFence(row.conversationId);
      await this.attempt(row, fence);
    } catch (error) {
      await this.failed(row, error);
    } finally {
      await handle.release();
    }
  }

  private async acquire(conversationId: string) {
    const { lockWaitMs, pollMs, sleep } = this.timing;
    for (let waited = 0; waited <= lockWaitMs; waited += pollMs) {
      const handle = await this.lock.acquire(conversationId);
      if (handle !== null) return handle;
      await sleep(pollMs);
    }
    return null;
  }

  private async attempt(row: WaOutboxRow, fence: number): Promise<void> {
    const config = await this.settings.get("waAgent");
    const conversation = await this.conversations.find(row.conversationId);
    if (conversation === null) return this.rows.markDead(row.id, row.attempts, "conversation_gone");
    if (conversation.status === "blocked" || !config.enabled) {
      return this.rows.hold(row.id, HELD_RECHECK_MS);
    }
    const paused = WaAgentStateService.isHeld(conversation);
    const bypassPause = row.paidWork && config.delivery.paidWorkBypassesTakeover;
    if (paused && !bypassPause) return this.rows.hold(row.id, HELD_RECHECK_MS);
    // The bridge answers only inside the customer's 24 h window: wait for the next message.
    const lastIn = conversation.lastInboundAt?.getTime() ?? 0;
    if (Date.now() - lastIn > WA_AGENT_FOLLOW_UP_WINDOW_MS) {
      return this.rows.hold(row.id, HELD_RECHECK_MS);
    }

    const event = waAgentEventSchema.safeParse(row.payload);
    if (!event.success) return this.dead(row, row.attempts, "invalid_payload");
    const locale: Locale = config.language === "en" ? "en" : "ar";
    const parts = await this.builder.parts(event.data, conversation, config.caps, locale);
    if (parts === null || parts.length === 0) return this.dead(row, row.attempts, "no_content");

    await this.outbound.enqueueDelivery(row.conversationId, parts, {
      fence,
      idempotencyKey: row.idempotencyKey,
      bypassPause: paused && bypassPause,
    });
    await this.rows.markDelivered(row.id);
    this.logger.info({ outboxId: row.id, kind: row.kind }, "Outbox item delivered");
  }

  private async failed(row: WaOutboxRow, error: unknown): Promise<void> {
    // Someone else took the conversation's fence meanwhile: nothing was sent, try again soon.
    if (error instanceof StaleFenceError) return this.rows.requeue(row.id, LOCK_BUSY_RETRY_MS);
    // Blocked or switched off between the check and the queueing.
    if (error instanceof AppError && error.code === ErrorCode.CONFLICT) {
      return this.rows.hold(row.id, HELD_RECHECK_MS);
    }
    const attempts = row.attempts + 1;
    const cls = errorClass(error);
    this.logger.warn({ outboxId: row.id, attempts, reason: cls }, "Outbox delivery failed");
    if (attempts >= MAX_ATTEMPTS) return this.dead(row, attempts, cls, true);
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[0];
    await this.rows.retry(row.id, attempts, delay, cls);
  }

  /** Ends the item: its stored file goes, and a delivery that kept failing is reported (ids only). */
  private async dead(
    row: WaOutboxRow,
    attempts: number,
    cls: string,
    report = false,
  ): Promise<void> {
    await this.rows.markDead(row.id, attempts, cls);
    const event = waAgentEventSchema.safeParse(row.payload);
    const stored = event.success ? storedKey(event.data) : undefined;
    if (stored !== undefined) await this.storage.remove(stored).catch(() => undefined);
    if (!report) return;
    await this.redis
      .xadd(
        WA_AGENT_DLQ_STREAM,
        "*",
        "stream",
        "wa:outbox",
        "id",
        row.id,
        "group",
        "outbox-deliverer",
        "errorClass",
        cls,
        "deliveries",
        String(attempts),
        "at",
        new Date().toISOString(),
        "kind",
        row.kind,
        "data",
        JSON.stringify({ outboxId: row.id, kind: row.kind, refId: row.refId }),
      )
      .catch(() => undefined);
    await this.alerts
      .notify({
        kind: HANDOFF_ALERT_KIND,
        severity: "warning",
        refType: "wa_outbox",
        refId: row.id,
        summary: `تعذّر تسليم نتيجة واتساب (${row.kind}) بعد ${attempts} محاولات: ${row.id.slice(0, 8)}`,
        link: "/admin/whatsapp/agent",
      })
      .catch(() => undefined);
  }
}

/** The stored file an event points to (a result's PDF, a requested document). */
function storedKey(event: WaAgentEvent): string | undefined {
  if (event.type === "document_ready") return event.mediaKey;
  return event.type === "rx_done" ? event.pdfKey : undefined;
}
