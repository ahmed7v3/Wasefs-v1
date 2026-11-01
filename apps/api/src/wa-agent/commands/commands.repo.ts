import { Inject, Injectable } from "@nestjs/common";
import { waAgentSessions, waConversations, waMessages } from "@wasfa/db";
import { and, desc, eq, inArray, isNotNull, lte, or } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { ReportDocument } from "./command-types.js";

/** Every SQL statement of the command layer; each one is scoped to a single conversation id the server holds. */
@Injectable()
export class CommandsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** The newest outbound document of the chat with one of these names (the rx report), if its file still exists. */
  async lastReport(
    conversationId: string,
    fileNames: readonly string[],
  ): Promise<ReportDocument | null> {
    const [row] = await this.handle.db
      .select({ mediaKey: waMessages.mediaKey, fileName: waMessages.text })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          eq(waMessages.direction, "out"),
          eq(waMessages.kind, "document"),
          inArray(waMessages.text, [...fileNames]),
          isNotNull(waMessages.mediaKey),
          inArray(waMessages.status, ["queued", "sent"]),
        ),
      )
      .orderBy(desc(waMessages.createdAt))
      .limit(1);
    return row?.mediaKey == null || row.fileName === null
      ? null
      : { mediaKey: row.mediaKey, fileName: row.fileName };
  }

  /**
   * The privacy deletion (docs/WA-AGENT-RUNTIME.md §18.4): this conversation's messages up to `upTo`, and the
   * summaries that quote them. Returns the files to remove from storage: what the customer sent and the
   * voice notes the agent made. Outbound documents and images point at shared files (rx reports, the media
   * library) and are never removed. The account, the rx results and the session rows stay.
   */
  erase(conversationId: string, upTo: Date): Promise<string[]> {
    return this.handle.db.transaction(async (tx) => {
      const scope = and(
        eq(waMessages.conversationId, conversationId),
        lte(waMessages.createdAt, upTo),
      );
      const files = await tx
        .select({ mediaKey: waMessages.mediaKey })
        .from(waMessages)
        .where(
          and(
            scope,
            isNotNull(waMessages.mediaKey),
            or(eq(waMessages.direction, "in"), eq(waMessages.kind, "audio")),
          ),
        );
      await tx.delete(waMessages).where(scope);
      await tx
        .update(waAgentSessions)
        .set({ summary: null, summarizedCount: 0 })
        .where(eq(waAgentSessions.conversationId, conversationId));
      await tx
        .update(waConversations)
        .set({ summary: null })
        .where(eq(waConversations.id, conversationId));
      return files.flatMap((file) => (file.mediaKey === null ? [] : [file.mediaKey]));
    });
  }
}
