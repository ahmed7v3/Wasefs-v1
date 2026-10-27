import { Inject, Injectable } from "@nestjs/common";
import {
  clearIntegrationSecret,
  getConversation,
  getIntegrationSecretMeta,
  getMessageMedia,
  listConversations,
  listTranscript,
  mediaAssets,
  setIntegrationSecret,
  waAgentCostByDay,
  waDroppedByDay,
  waUsageByDay,
  type ConversationFilter,
  type ConversationListRow,
  type TranscriptRow,
  type WaConversation,
  type WaCursor,
  type WaUsageDayRow,
} from "@wasfa/db";
import { inArray } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

const VOICE_KEY = "elevenlabs" as const;

/** Every query behind `/admin/wa-agent`: the inbox, the usage numbers, the voice key and media checks. */
@Injectable()
export class AdminWaAgentRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  conversations(
    filter: ConversationFilter,
    cursor: WaCursor | undefined,
    limit: number,
  ): Promise<ConversationListRow[]> {
    return listConversations(this.handle.db, filter, cursor, limit);
  }

  findConversation(id: string): Promise<WaConversation | null> {
    return getConversation(this.handle.db, id);
  }

  transcript(
    conversationId: string,
    cursor: WaCursor | undefined,
    limit: number,
  ): Promise<TranscriptRow[]> {
    return listTranscript(this.handle.db, conversationId, cursor, limit);
  }

  messageMedia(messageId: string) {
    return getMessageMedia(this.handle.db, messageId);
  }

  usageByDay(since: Date): Promise<WaUsageDayRow[]> {
    return waUsageByDay(this.handle.db, since);
  }

  droppedByDay(since: Date) {
    return waDroppedByDay(this.handle.db, since);
  }

  costByDay(since: Date) {
    return waAgentCostByDay(this.handle.db, since);
  }

  voiceKeyMeta() {
    return getIntegrationSecretMeta(this.handle.db, VOICE_KEY);
  }

  setVoiceKey(apiKey: string, encKey: Buffer, actorId: string) {
    return setIntegrationSecret(this.handle.db, VOICE_KEY, apiKey, encKey, actorId);
  }

  clearVoiceKey(): Promise<boolean> {
    return clearIntegrationSecret(this.handle.db, VOICE_KEY);
  }

  /** Media-library assets by id, to check that the agent's media list points at finished images. */
  async assetsById(
    ids: readonly string[],
  ): Promise<Map<string, { status: string; mime: string | null }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.handle.db
      .select({ id: mediaAssets.id, status: mediaAssets.status, mime: mediaAssets.mime })
      .from(mediaAssets)
      .where(inArray(mediaAssets.id, [...ids]));
    return new Map(rows.map((row) => [row.id, { status: row.status, mime: row.mime }]));
  }
}
