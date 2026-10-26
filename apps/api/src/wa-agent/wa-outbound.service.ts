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
import { SettingsService } from "../settings/settings.service.js";

import { WaAgentStateService } from "./wa-agent-state.service.js";
import { WaAgentRepo } from "./wa-agent.repo.js";

import type { OutboundPartRow } from "@wasfa/db";

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
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Returns the ids of the queued messages, one per part, in order. */
  async enqueue(conversationId: string, parts: unknown): Promise<string[]> {
    const config = await this.settings.get("waAgent");
    if (!config.enabled) throw refuse("agent_disabled");
    const parsed = waAgentOutboundFor(config.caps).safeParse(parts);
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
    if (WaAgentStateService.isHeld(conversation)) throw refuse("conversation_paused");

    const messageIds = await this.repo.queueOutbound(conversationId, parsed.data.map(rowOf));
    const entry: WaAgentOutEntry = {
      conversationId,
      messageIds,
      jid: conversation.jid,
      parts: parsed.data,
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
    return messageIds;
  }
}
