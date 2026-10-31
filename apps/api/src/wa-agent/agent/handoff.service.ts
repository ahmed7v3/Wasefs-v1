import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { AdminAlertService } from "../../alerts/alerts.service.js";
import { REDIS } from "../../common/redis.js";
import { SettingsService } from "../../settings/settings.service.js";
import { WaAgentStateService } from "../wa-agent-state.service.js";
import { WaAgentRepo } from "../wa-agent.repo.js";

import type { AlertKind } from "@wasfa/shared/billing";

/** The owner alert for a handed-over chat; it reaches admins holding `wa_agent.inbox`. */
export const HANDOFF_ALERT_KIND: AlertKind = "wa_agent.handoff";

/**
 * While set, the agent stays silent in this chat: the owner has been asked to take over and the pause
 * is about to be applied. It only bridges that gap (the row's pause takes over, and an admin resume
 * must not meet a stale flag), so it is short-lived and removed once the pause is on.
 */
export const handoffFlagKey = (conversationId: string) => `wa:agent:handoff:${conversationId}`;
const alertOnceKey = (conversationId: string) => `wa:agent:handoff-alert:${conversationId}`;

const MINUTE_SECONDS = 60;
const ALERT_REPEAT_SECONDS = 10 * 60;
const FLAG_SECONDS = 5 * 60;

/** How long a pause waits for the bridge to report on the reply that explains the handoff. */
export interface HandoffTiming {
  pollMs: number;
  maxWaitMs: number;
  sleep: (ms: number) => Promise<void>;
}

/**
 * Handing a chat to the owner. The alert and the "stay silent" flag are immediate. The pause is
 * applied only after the agent's last reply (the one telling the customer the owner will answer) was
 * delivered: the bridge drops anything sent into a paused chat, so pausing first would swallow it.
 */
@Injectable()
export class WaAgentHandoffService implements OnApplicationShutdown {
  readonly timing: HandoffTiming = {
    pollMs: 2_000,
    maxWaitMs: 120_000,
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
  private readonly pending = new Map<string, Promise<void>>();
  private closing = false;

  constructor(
    private readonly alerts: AdminAlertService,
    private readonly state: WaAgentStateService,
    private readonly repo: WaAgentRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentHandoff");
  }

  /** Alerts the owner (once per 10 minutes per chat) and silences the agent in this chat. */
  async raise(conversationId: string, reason: string): Promise<void> {
    await this.redis.set(handoffFlagKey(conversationId), "1", "EX", FLAG_SECONDS);
    const first = await this.redis.set(
      alertOnceKey(conversationId),
      "1",
      "EX",
      ALERT_REPEAT_SECONDS,
      "NX",
    );
    if (first !== "OK") return;
    await this.notify(conversationId, reason);
  }

  /**
   * Tells the admins about a failure without silencing the agent or pausing the chat (the failure policy,
   * docs/WA-AGENT-RUNTIME.md section 5.4). The caller rate-limits.
   */
  async alertOwner(conversationId: string, reason: string): Promise<void> {
    await this.notify(conversationId, reason);
  }

  private async notify(conversationId: string, reason: string): Promise<void> {
    try {
      // The conversation id and the agent's own reason only: never the phone number or the messages.
      await this.alerts.notify({
        kind: HANDOFF_ALERT_KIND,
        severity: "warning",
        refType: "wa_conversation",
        refId: conversationId,
        summary: `وكيل واتساب حوّل المحادثة ${conversationId.slice(0, 8)} إليك: ${reason}`,
        link: "/admin/whatsapp/agent",
      });
    } catch (error) {
      // The chat is still silenced and paused; a failed alert must not fail the customer's reply.
      this.logger.warn(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Handoff alert failed",
      );
    }
  }

  /** Pauses the chat once none of `messageIds` is still waiting for the bridge. Returns at once. */
  pauseWhenDelivered(conversationId: string, messageIds: readonly string[]): void {
    if (this.pending.has(conversationId)) return;
    const job = this.waitThenPause(conversationId, messageIds)
      .catch((error: unknown) => {
        this.logger.warn(
          { conversationId, reason: error instanceof Error ? error.name : "unknown" },
          "Handoff pause failed",
        );
      })
      .finally(() => {
        this.pending.delete(conversationId);
      });
    this.pending.set(conversationId, job);
  }

  /** Resolves when every pause started so far has been applied (tests and shutdown). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
  }

  async onApplicationShutdown(): Promise<void> {
    // Do not lose a pause to a restart: apply what is waiting now.
    this.closing = true;
    await this.drain();
  }

  private async waitThenPause(
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<void> {
    const { sleep, pollMs, maxWaitMs } = this.timing;
    for (let waited = 0; !this.closing && waited < maxWaitMs; waited += pollMs) {
      if ((await this.repo.queuedCount(messageIds)) === 0) break;
      await sleep(pollMs);
    }
    const { takeoverPauseMinutes } = await this.settings.get("waAgent");
    await this.state.pause(
      conversationId,
      new Date(Date.now() + takeoverPauseMinutes * MINUTE_SECONDS * 1_000),
    );
    await this.redis.del(handoffFlagKey(conversationId));
  }
}
