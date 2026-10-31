import { Inject, Injectable } from "@nestjs/common";
import {
  WA_DOCUMENT_GUEST_TEMPLATES,
  waRenderDocumentPayloadSchema,
  type WaCreateDocumentArgs,
} from "@wasfa/shared/schemas/wa-document";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";

import { WaDocumentQueue } from "./wa-document-queue.js";

import type { AgentToolResult } from "../agent/tools/tool.js";

/** A linked chat may have this many files a day; a guest one an hour. */
export const DOCUMENTS_PER_CONVERSATION_PER_DAY = 5;
export const GUEST_DOCUMENT_WINDOW_SECONDS = 60 * 60;
/** Files over all chats a day: the render is CPU work and the files go to WhatsApp. */
export const DOCUMENTS_PER_DAY = 500;
const DAY_SECONDS = 24 * 60 * 60;

const guestKey = (conversationId: string) => `wa:agent:doc:guest:${conversationId}`;
const chatDayKey = (conversationId: string, day: string) =>
  `wa:agent:doc:chat:${conversationId}:${day}`;
const totalDayKey = (day: string) => `wa:agent:doc:total:${day}`;

export interface DocumentCall {
  conversationId: string;
  /** The chat is linked to an account; a guest gets the narrower rules. */
  linked: boolean;
  /** The language when the model did not choose one. */
  language: "ar" | "en";
  args: WaCreateDocumentArgs;
  now: Date;
  /** The tool-effect key of a v2 turn: the render job id derives from it, so a repeat renders once. */
  effectKey?: string;
}

/**
 * `create_document`: checks who may make which file and how many, then hands the render to the
 * worker (the file comes back as a `document_ready` event, see `WaAgentEventsConsumer`). Free of
 * charge. A guest gets `report` and `table` only (no account data), one file per conversation per
 * hour; a linked chat gets five a day. All chats share a daily cap. A count taken for a file that
 * is then not queued is given back.
 */
@Injectable()
export class AgentDocumentService {
  constructor(
    private readonly queue: WaDocumentQueue,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentDocuments");
  }

  async create(call: DocumentCall): Promise<AgentToolResult> {
    const { args, conversationId } = call;
    if (!call.linked && !WA_DOCUMENT_GUEST_TEMPLATES.includes(args.template)) {
      return { error: "not_linked" };
    }
    const day = call.now.toISOString().slice(0, 10);
    const undo: Array<() => Promise<unknown>> = [];
    const giveBack = async () => {
      for (const step of undo) await step().catch(() => undefined);
    };

    if (!call.linked) {
      const took = await this.redis.set(
        guestKey(conversationId),
        "1",
        "EX",
        GUEST_DOCUMENT_WINDOW_SECONDS,
        "NX",
      );
      if (took === null) return { error: "limit_reached" };
      undo.push(() => this.redis.del(guestKey(conversationId)));
    }

    const total = await this.count(totalDayKey(day));
    undo.push(() => this.redis.decr(totalDayKey(day)));
    if (total > DOCUMENTS_PER_DAY) {
      await giveBack();
      return { error: "limit_reached" };
    }
    if (call.linked) {
      const mine = await this.count(chatDayKey(conversationId, day));
      undo.push(() => this.redis.decr(chatDayKey(conversationId, day)));
      if (mine > DOCUMENTS_PER_CONVERSATION_PER_DAY) {
        await giveBack();
        return { error: "limit_reached" };
      }
    }

    try {
      await this.queue.render(
        waRenderDocumentPayloadSchema.parse({
          ...args,
          conversationId,
          language: args.language ?? call.language,
        }),
        call.effectKey === undefined ? undefined : `doc-${call.effectKey.slice(0, 32)}`,
      );
    } catch (error) {
      await giveBack();
      this.logger.warn(
        { conversationId, reason: error instanceof Error ? error.name : "unknown" },
        "Document job not queued",
      );
      return { error: "unavailable" };
    }
    this.logger.info({ conversationId, template: args.template }, "Agent document queued");
    return { creating: true };
  }

  private async count(key: string): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) await this.redis.expire(key, 2 * DAY_SECONDS);
    return value;
  }
}
