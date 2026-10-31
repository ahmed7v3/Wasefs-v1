import { Inject, Injectable } from "@nestjs/common";
import { setMessagesMeta, waMessages, waOutbox, type Transaction } from "@wasfa/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import {
  assertFenceIn,
  insertPendingEffect,
  markEffectDone,
} from "../agent/tools/tool-effects.repo.js";

/** An inbound picture or file of a chat, as the commerce tools pick them. */
export interface InboundMedia {
  id: string;
  kind: "image" | "document";
  mediaKey: string;
  mediaMime: string;
  mediaBytes: number;
  createdAt: Date;
  /** The `rx_page` file an earlier try imported for this picture (`meta.fileId`), reused on a retry. */
  fileId: string | null;
}

/** Some picture of the start was already read by another analysis; nothing was written. */
export class RxAlreadyAnalysedError extends Error {
  constructor() {
    super("media already analysed");
    this.name = "RxAlreadyAnalysedError";
  }
}

/** The database side of the prescription start: the chat's pictures and the one-transaction commit. */
@Injectable()
export class AgentRxRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The newest picture or PDF the customer sent since `since` that no tool used yet (`meta.<usedKey>`). */
  async newestUnusedMedia(
    conversationId: string,
    kinds: readonly ("image" | "document")[],
    since: Date,
    usedKey: "attachedAs" | "rxId",
    limit: number,
  ): Promise<InboundMedia[]> {
    const rows = await this.handle.db
      .select({
        id: waMessages.id,
        kind: waMessages.kind,
        mediaKey: waMessages.mediaKey,
        mediaMime: waMessages.mediaMime,
        mediaBytes: waMessages.mediaBytes,
        createdAt: waMessages.createdAt,
        fileId: sql<string | null>`${waMessages.meta}->>'fileId'`,
      })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "in"),
          inArray(waMessages.kind, [...kinds]),
          gte(waMessages.createdAt, since),
          sql`not (${waMessages.meta} ? ${usedKey})`,
        ),
      )
      .orderBy(desc(waMessages.createdAt), desc(waMessages.id))
      .limit(limit);
    return rows.flatMap((row) =>
      (row.kind === "image" || row.kind === "document") &&
      row.mediaKey !== null &&
      row.mediaMime !== null
        ? [
            {
              id: row.id,
              kind: row.kind,
              mediaKey: row.mediaKey,
              mediaMime: row.mediaMime,
              mediaBytes: row.mediaBytes ?? 0,
              createdAt: row.createdAt,
              fileId: row.fileId,
            },
          ]
        : [],
    );
  }

  /** Gives a claim back when the work it was for failed. */
  async releaseMedia(messageId: string, usedKey: "attachedAs" | "rxId"): Promise<void> {
    await this.handle.db
      .update(waMessages)
      .set({ meta: sql`${waMessages.meta} - ${usedKey}::text` })
      .where(eq(waMessages.id, messageId));
  }

  /** Records what a claimed message became (`attachedAs: { fileId, paymentId }`, `rxId`). */
  setMediaMeta(messageId: string, meta: Record<string, unknown>): Promise<void> {
    return setMessagesMeta(this.handle.db, [messageId], meta);
  }

  /** Forgets the imported file of pictures whose file was deleted (a declined start), so a retry imports again. */
  async dropMediaFileId(messageIds: readonly string[]): Promise<void> {
    if (messageIds.length === 0) return;
    await this.handle.db
      .update(waMessages)
      .set({ meta: sql`${waMessages.meta} - 'fileId'` })
      .where(inArray(waMessages.id, [...messageIds]));
  }

  /**
   * The rx start of docs/WA-AGENT-RUNTIME.md section 17.3, one transaction: the effect row, the fence,
   * the claim of every picture (all or none), the analysis (`create`), the outbox route and the effect
   * result. Throws `StaleFenceError` or `RxAlreadyAnalysedError` with nothing written.
   */
  async commitRxStart(input: {
    effectKey: string;
    turnId: string;
    conversationId: string;
    fence?: number | undefined;
    mediaIds: readonly string[];
    analysisId: string;
    result: Record<string, unknown>;
    create: (tx: Transaction) => Promise<void>;
  }): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      await insertPendingEffect(tx, {
        key: input.effectKey,
        turnId: input.turnId,
        tool: "analyze_prescription",
      });
      if (input.fence !== undefined) {
        await assertFenceIn(tx, input.conversationId, input.fence, true);
      }
      const claimed = await tx
        .update(waMessages)
        .set({
          meta: sql`${waMessages.meta} || jsonb_build_object('rxId', ${input.analysisId}::text)`,
        })
        .where(
          and(inArray(waMessages.id, [...input.mediaIds]), sql`not (${waMessages.meta} ? 'rxId')`),
        )
        .returning({ id: waMessages.id });
      if (claimed.length !== input.mediaIds.length) throw new RxAlreadyAnalysedError();
      await input.create(tx);
      await tx
        .insert(waOutbox)
        .values({
          conversationId: input.conversationId,
          kind: "rx_result",
          idempotencyKey: `rx:${input.analysisId}`,
          refId: input.analysisId,
          state: "waiting",
          paidWork: true,
        })
        .onConflictDoNothing();
      await markEffectDone(tx, input.effectKey, input.result);
    });
  }
}
