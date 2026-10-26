import { Inject, Injectable } from "@nestjs/common";
import { waAgentBlockKey, waAgentPauseKey } from "@wasfa/shared/schemas/wa-agent";
import { Redis } from "ioredis";

import { REDIS } from "../common/redis.js";

import { WaAgentRepo } from "./wa-agent.repo.js";

import type { WaConversation } from "@wasfa/db";

/** A block has no end, but every Redis key expires: it is refreshed whenever the chat writes. */
const BLOCK_MIRROR_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Pause, resume and block of a chat. The database row is the truth; the bridge cannot ask the api
 * in the middle of a send, so the state is mirrored to Redis keys it checks (`wa:agent:pause:<jid>`
 * with a TTL up to `paused_until`, `wa:agent:block:<jid>`). Redis trouble is never allowed to undo
 * the database change: the outbound service refuses on the row as well.
 */
@Injectable()
export class WaAgentStateService {
  constructor(
    private readonly repo: WaAgentRepo,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async pause(conversationId: string, until: Date): Promise<WaConversation | null> {
    const conversation = await this.repo.pause(conversationId, until);
    if (conversation) await this.mirror(conversation);
    return conversation;
  }

  async resume(conversationId: string): Promise<WaConversation | null> {
    const conversation = await this.repo.resume(conversationId);
    if (conversation) await this.mirror(conversation);
    return conversation;
  }

  async block(conversationId: string): Promise<WaConversation | null> {
    const conversation = await this.repo.block(conversationId);
    if (conversation) await this.mirror(conversation);
    return conversation;
  }

  /** True while the chat must not be answered. An expired pause no longer counts. */
  static isHeld(conversation: WaConversation, now: number = Date.now()): boolean {
    if (conversation.status === "blocked") return true;
    return (
      conversation.status === "paused" &&
      conversation.pausedUntil !== null &&
      conversation.pausedUntil.getTime() > now
    );
  }

  /** Makes the Redis keys match the row. */
  async mirror(conversation: WaConversation, now: number = Date.now()): Promise<void> {
    const { jid } = conversation;
    try {
      const pauseMs =
        conversation.status === "paused" && conversation.pausedUntil
          ? conversation.pausedUntil.getTime() - now
          : 0;
      if (pauseMs > 0) await this.redis.set(waAgentPauseKey(jid), "1", "PX", pauseMs);
      else await this.redis.del(waAgentPauseKey(jid));
      if (conversation.status === "blocked") {
        await this.redis.set(waAgentBlockKey(jid), "1", "EX", BLOCK_MIRROR_TTL_SECONDS);
      } else {
        await this.redis.del(waAgentBlockKey(jid));
      }
    } catch {
      // Best effort: the row still stops every reply the api queues.
    }
  }
}
