import { Inject, Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { WA_AGENT_OUT_STREAM, WA_AGENT_STREAM_MAXLEN } from "@wasfa/shared/schemas/phone";
import {
  waAgentOutboundFor,
  type WaAgentOutEntry,
  type WaAgentOutboundPart,
} from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";
import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { TurnRepo } from "./turn/turn.repo.js";
import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";

import type { ApiEnv } from "../config/env.js";
import type { TurnEnd } from "./turn/turn.repo.js";
import type { OutboundPartRow, WaConversation } from "@wasfa/db";
import type { WaTurnState } from "@wasfa/shared/wa-agent/failure";

/** How long a delivered outbox key is remembered. */
const PUBLISHED_TTL_SECONDS = 7 * 24 * 60 * 60;

const refuse = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });

function rowOf(part: WaAgentOutboundPart): OutboundPartRow {
  if (part.kind === "text") return { kind: "text", text: part.text };
  if (part.kind === "image") return { kind: "image", mediaKey: part.mediaKey, text: part.caption };
  if (part.kind === "document") {
    return { kind: "document", mediaKey: part.mediaKey, text: part.fileName };
  }
  return { kind: "voice", mediaKey: part.mediaKey };
}

/**
 * The agent's one way to talk: validates the parts against the admin caps, refuses when the agent is
 * off or the chat is paused / blocked, records `queued` rows and hands the turn to the bridge on
 * `wa:agent:out`. The bridge applies the anti-ban guard (24 h window, caps, delay) and reports each
 * part on `wa:agent:sent`; this service never talks to WhatsApp.
 */
@Injectable()
export class WaOutboundService {
  constructor(
    private readonly repo: WaAgentRepo,
    private readonly turns: TurnRepo,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, "MEDIA_PUBLIC_ORIGIN">,
  ) {}

  /** Returns the ids of the queued messages, one per part, in order. */
  async enqueue(conversationId: string, parts: unknown): Promise<string[]> {
    const { conversation, parsed } = await this.prepare(conversationId, parts);
    const messageIds = await this.repo.queueOutbound(conversationId, parsed.map(rowOf));
    await this.publish(conversation, messageIds, parsed);
    return messageIds;
  }

  /**
   * The v2 turn's way: the rows are inserted under the turn's fence and, in the same transaction, the
   * turn's inbound rows are linked and the turn is closed `replied` (docs/WA-AGENT-RUNTIME.md §17.4). The
   * stream entry is added only after that commit. Throws `StaleFenceError` when the lock was taken over.
   */
  async enqueueFenced(
    conversationId: string,
    parts: unknown,
    end: Omit<TurnEnd, "conversationId">,
    state: WaTurnState = "replied",
  ): Promise<string[]> {
    const { conversation, parsed } = await this.prepare(conversationId, parts);
    const messageIds = await this.turns.commitReply(
      { ...end, conversationId },
      parsed.map(rowOf),
      state,
    );
    try {
      await this.publish(conversation, messageIds, parsed);
    } catch (error) {
      // Nothing reached the bridge: reopen the turn so its retry answers the customer.
      await this.turns.reopen({ turnId: end.turnId, fence: end.fence });
      throw error;
    }
    return messageIds;
  }

  /**
   * An outbox delivery (docs/WA-AGENT-RUNTIME.md §9): rows inserted under the deliverer's fence. The pause
   * refusal is skipped only for `bypassPause` (paid work); a block and the switch still refuse. A key that
   * was already published returns no ids (a crash between the publish and the outbox update must not send twice).
   */
  async enqueueDelivery(
    conversationId: string,
    parts: unknown,
    options: { fence: number; idempotencyKey: string; bypassPause: boolean },
  ): Promise<string[]> {
    const marker = `wa:agent:outbox:published:${options.idempotencyKey}`;
    if ((await this.redis.exists(marker)) === 1) return [];
    const { conversation, parsed } = await this.prepare(conversationId, parts, options.bypassPause);
    const messageIds = await this.turns.commitDelivery(
      conversationId,
      options.fence,
      parsed.map(rowOf),
    );
    await this.publish(conversation, messageIds, parsed, options.bypassPause);
    await this.redis.set(marker, "1", "EX", PUBLISHED_TTL_SECONDS);
    return messageIds;
  }

  private async prepare(conversationId: string, parts: unknown, bypassPause = false) {
    const config = await this.settings.get("waAgent");
    if (!config.enabled) throw refuse("agent_disabled");
    // A part that carries a url may only point into the public media library, never anywhere else.
    const parsed = waAgentOutboundFor(config.caps, this.env.MEDIA_PUBLIC_ORIGIN ?? "").safeParse(
      parts,
    );
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: {
          reason: "invalid_parts",
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        },
      });
    }
    const conversation = await this.repo.find(conversationId);
    if (!conversation) throw new AppError(ErrorCode.NOT_FOUND);
    if (conversation.status === "blocked") throw refuse("conversation_blocked");
    if (!bypassPause && WaAgentStateService.isHeld(conversation)) {
      throw refuse("conversation_paused");
    }

    return { conversation, parsed: parsed.data };
  }

  /** Hands queued rows to the bridge; when the stream refuses, the rows are dropped, not left `queued`. */
  private async publish(
    conversation: WaConversation,
    messageIds: string[],
    parts: WaAgentOutboundPart[],
    paidWork = false,
  ): Promise<void> {
    const entry: WaAgentOutEntry = {
      conversationId: conversation.id,
      messageIds,
      jid: conversation.jid,
      parts,
      ...(paidWork ? { paidWork: true } : {}),
    };
    try {
      await this.redis.xadd(
        WA_AGENT_OUT_STREAM,
        "MAXLEN",
        "~",
        WA_AGENT_STREAM_MAXLEN,
        "*",
        "data",
        JSON.stringify(entry),
      );
    } catch (error) {
      // Nothing reached the bridge: do not leave rows that stay "queued" for ever.
      for (const id of messageIds) {
        await this.repo.recordVerdict(id, "dropped", { reason: "queue_failed" });
      }
      throw error;
    }
  }
}
