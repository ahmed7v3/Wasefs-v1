import { Inject, Injectable } from "@nestjs/common";
import { rxAnalyses, waMessages, type WaMessage } from "@wasfa/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { RxStatus } from "@wasfa/shared/rx";

/** One inbound picture or file of a session with what its status is derived from. */
export interface AttachmentRow {
  messageId: string;
  handle: number;
  kind: "image" | "document";
  mime: string | null;
  createdAt: Date;
  setLabel: string | null;
  mediaKey: string | null;
  mediaBytes: number | null;
  mediaStatus: WaMessage["mediaStatus"];
  /** The analysis that claimed the row (`meta.rxId`) and its state; both null while unclaimed. */
  rxId: string | null;
  rxStatus: RxStatus | null;
}

/**
 * Every SQL statement of the attachment registry (docs/WA-AGENT-RUNTIME.md §8.1, §18.5). All of them are
 * bound to one session id that the server took from the conversation, never from the model.
 */
@Injectable()
export class AttachmentsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The session's media rows, oldest handle first; `newest` keeps only the last N. */
  async rows(sessionId: string, newest?: number): Promise<AttachmentRow[]> {
    const query = this.handle.db
      .select({
        messageId: waMessages.id,
        handle: waMessages.handle,
        kind: waMessages.kind,
        mime: waMessages.mediaMime,
        createdAt: waMessages.createdAt,
        setLabel: waMessages.setLabel,
        mediaKey: waMessages.mediaKey,
        mediaBytes: waMessages.mediaBytes,
        mediaStatus: waMessages.mediaStatus,
        rxId: sql<string | null>`${waMessages.meta}->>'rxId'`,
        rxStatus: rxAnalyses.status,
      })
      .from(waMessages)
      // The guard keeps a malformed `rxId` from failing the cast for the whole session.
      .leftJoin(
        rxAnalyses,
        sql`${rxAnalyses.id} = case when ${waMessages.meta}->>'rxId' ~ '^[0-9a-f-]{36}$' then (${waMessages.meta}->>'rxId')::uuid end`,
      )
      .where(
        and(
          eq(waMessages.sessionId, sessionId),
          eq(waMessages.direction, "in"),
          isNotNull(waMessages.handle),
        ),
      )
      .orderBy(desc(waMessages.handle));
    const rows = newest === undefined ? await query : await query.limit(newest);
    return rows
      .reverse()
      .flatMap((row) =>
        row.handle !== null && (row.kind === "image" || row.kind === "document")
          ? [{ ...row, handle: row.handle, kind: row.kind }]
          : [],
      );
  }
}
