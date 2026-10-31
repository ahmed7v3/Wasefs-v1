import { Inject, Injectable } from "@nestjs/common";
import { waAgentSessions, waConversations, waMessages, type TurnMessage } from "@wasfa/db";
import {
  waAgentProfileSchema,
  waSessionStateSchema,
  type WaAgentProfile,
  type WaSessionState,
} from "@wasfa/shared/wa-agent/session";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

import type { HistoryRow } from "../agent/agent-prompt.js";
import type { WaSessionEndReason } from "@wasfa/shared/schemas/wa-agent";

type Tx = Parameters<Parameters<DbHandle["db"]["transaction"]>[0]>[0];

/** The columns of a message the agent shows to a model (same shape as `TurnMessage`). */
const rowColumns = {
  id: waMessages.id,
  direction: waMessages.direction,
  kind: waMessages.kind,
  text: waMessages.text,
  mediaKey: waMessages.mediaKey,
  mediaMime: waMessages.mediaMime,
  mediaBytes: waMessages.mediaBytes,
  createdAt: waMessages.createdAt,
  answered: sql<boolean>`${waMessages.meta} ? 'turn'`,
  // Media handle (`#3`) and the tool notes of a reply (docs/WA-AGENT-RUNTIME.md §18.5).
  handle: waMessages.handle,
  toolNotes: sql<unknown>`${waMessages.meta}->'toolNotes'`,
};

/** What a turn needs of the chat's current session. */
export interface SessionContext {
  id: string;
  summary: string | null;
  summarizedCount: number;
  isReturning: boolean;
  startedAt: Date;
  /** Rows the agent sent in this session (the returning note fades once it has talked a little). */
  outboundCount: number;
}

/** Every SQL statement of the agent sessions (docs/WA-AGENT-RUNTIME.md §18); logic lives in `SessionService`. */
@Injectable()
export class SessionRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    return this.handle.db.transaction(run);
  }

  /** The chat's session fields, row-locked so two writers cannot both roll the session over. */
  async lockConversation(
    tx: Tx,
    conversationId: string,
  ): Promise<{ sessionId: string | null; lastInboundAt: Date | null } | null> {
    const [row] = await tx
      .select({
        sessionId: waConversations.sessionId,
        lastInboundAt: waConversations.lastInboundAt,
      })
      .from(waConversations)
      .where(eq(waConversations.id, conversationId))
      .for("update");
    return row ?? null;
  }

  /** Opens a session and makes it the conversation's current one. */
  async open(tx: Tx, conversationId: string, isReturning: boolean, now: Date): Promise<string> {
    const [row] = await tx
      .insert(waAgentSessions)
      .values({ conversationId, isReturning, startedAt: now })
      .returning({ id: waAgentSessions.id });
    if (row === undefined) throw new Error("wa_agent_sessions insert returned no row");
    await tx
      .update(waConversations)
      .set({ sessionId: row.id, updatedAt: now })
      .where(eq(waConversations.id, conversationId));
    return row.id;
  }

  async end(tx: Tx, sessionId: string, reason: WaSessionEndReason, now: Date): Promise<void> {
    await tx
      .update(waAgentSessions)
      .set({ endedAt: now, endReason: reason })
      .where(and(eq(waAgentSessions.id, sessionId), isNull(waAgentSessions.endedAt)));
  }

  async stampRow(tx: Tx, rowId: string, sessionId: string): Promise<void> {
    await tx.update(waMessages).set({ sessionId }).where(eq(waMessages.id, rowId));
  }

  /** Gives out the session's next media handle (1, 2, ...). */
  async takeHandle(tx: Tx, sessionId: string): Promise<number> {
    const [row] = await tx
      .update(waAgentSessions)
      .set({ nextHandle: sql`${waAgentSessions.nextHandle} + 1` })
      .where(eq(waAgentSessions.id, sessionId))
      .returning({ handle: sql<number>`${waAgentSessions.nextHandle} - 1` });
    if (row === undefined) throw new Error("wa_agent_sessions row vanished");
    return row.handle;
  }

  /** The newest media row of the session (the one before the row being assigned) and its set's size. */
  async lastMedia(
    tx: Tx,
    sessionId: string,
  ): Promise<{ createdAt: Date; setLabel: string | null; setSize: number } | null> {
    const [row] = await tx
      .select({ createdAt: waMessages.createdAt, setLabel: waMessages.setLabel })
      .from(waMessages)
      .where(and(eq(waMessages.sessionId, sessionId), sql`${waMessages.handle} is not null`))
      .orderBy(desc(waMessages.handle))
      .limit(1);
    if (row === undefined) return null;
    if (row.setLabel === null) return { ...row, setSize: 0 };
    const [count] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(waMessages)
      .where(and(eq(waMessages.sessionId, sessionId), eq(waMessages.setLabel, row.setLabel)));
    return { ...row, setSize: count?.total ?? 0 };
  }

  async stampMedia(
    tx: Tx,
    rowId: string,
    sessionId: string,
    handle: number,
    setLabel: string,
  ): Promise<void> {
    await tx
      .update(waMessages)
      .set({ sessionId, handle, setLabel })
      .where(eq(waMessages.id, rowId));
  }

  /** Puts freshly queued reply rows into the conversation's current session (inside the queueing transaction). */
  async stampOutbound(tx: Tx, conversationId: string, rowIds: readonly string[]): Promise<void> {
    if (rowIds.length === 0) return;
    await tx
      .update(waMessages)
      .set({
        sessionId: sql`(select ${waConversations.sessionId} from ${waConversations} where ${waConversations.id} = ${conversationId})`,
      })
      .where(inArray(waMessages.id, [...rowIds]));
  }

  // --- state and profile ---

  async state(sessionId: string): Promise<WaSessionState> {
    const [row] = await this.handle.db
      .select({ state: waAgentSessions.state })
      .from(waAgentSessions)
      .where(eq(waAgentSessions.id, sessionId));
    const parsed = waSessionStateSchema.safeParse(row?.state ?? {});
    return parsed.success ? parsed.data : {};
  }

  async mergeState(sessionId: string, patch: WaSessionState): Promise<void> {
    await this.handle.db
      .update(waAgentSessions)
      .set({ state: sql`${waAgentSessions.state} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(waAgentSessions.id, sessionId));
  }

  async removeStateKey(sessionId: string, key: string): Promise<void> {
    await this.handle.db
      .update(waAgentSessions)
      .set({ state: sql`${waAgentSessions.state} - ${key}::text` })
      .where(eq(waAgentSessions.id, sessionId));
  }

  async profile(conversationId: string): Promise<WaAgentProfile> {
    const [row] = await this.handle.db
      .select({ profile: waConversations.profile })
      .from(waConversations)
      .where(eq(waConversations.id, conversationId));
    const parsed = waAgentProfileSchema.safeParse(row?.profile ?? {});
    return parsed.success ? parsed.data : {};
  }

  async mergeProfile(conversationId: string, patch: WaAgentProfile): Promise<void> {
    await this.handle.db
      .update(waConversations)
      .set({ profile: sql`${waConversations.profile} || ${JSON.stringify(patch)}::jsonb` })
      .where(eq(waConversations.id, conversationId));
  }

  // --- what a v2 turn reads ---

  /** The current session with its outbound count; null while the chat has none. */
  async context(conversationId: string): Promise<SessionContext | null> {
    const [row] = await this.handle.db
      .select({
        id: waAgentSessions.id,
        summary: waAgentSessions.summary,
        summarizedCount: waAgentSessions.summarizedCount,
        isReturning: waAgentSessions.isReturning,
        startedAt: waAgentSessions.startedAt,
      })
      .from(waConversations)
      .innerJoin(waAgentSessions, eq(waAgentSessions.id, waConversations.sessionId))
      .where(eq(waConversations.id, conversationId));
    if (row === undefined) return null;
    const [count] = await this.handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(waMessages)
      .where(and(eq(waMessages.sessionId, row.id), eq(waMessages.direction, "out")));
    return { ...row, outboundCount: count?.total ?? 0 };
  }

  /**
   * The newest `limit` delivered or received rows of the session, oldest first. Rows written without a
   * session (a notice queued by another path) count when they were created after the session started.
   */
  async history(
    conversationId: string,
    session: Pick<SessionContext, "id" | "startedAt">,
    limit: number,
  ): Promise<HistoryRow[]> {
    const rows = await this.handle.db
      .select(rowColumns)
      .from(waMessages)
      .where(
        and(
          eq(waMessages.conversationId, conversationId),
          ne(waMessages.status, "dropped"),
          or(
            eq(waMessages.sessionId, session.id),
            and(isNull(waMessages.sessionId), sql`${waMessages.createdAt} >= ${session.startedAt}`),
          ),
        ),
      )
      .orderBy(desc(waMessages.createdAt), desc(waMessages.id))
      .limit(limit);
    return rows.reverse();
  }

  /** Session messages after `after` (all when null), oldest first, at most `limit`, for the summary job. */
  rowsSince(sessionId: string, after: Date | null, limit: number): Promise<TurnMessage[]> {
    return this.handle.db
      .select(rowColumns)
      .from(waMessages)
      .where(
        and(
          eq(waMessages.sessionId, sessionId),
          ne(waMessages.status, "dropped"),
          after === null ? undefined : sql`${waMessages.createdAt} > ${after}`,
        ),
      )
      .orderBy(asc(waMessages.createdAt), asc(waMessages.id))
      .limit(limit);
  }

  /** How many session messages came after `after` (all when null). */
  async countSince(sessionId: string, after: Date | null): Promise<number> {
    const [row] = await this.handle.db
      .select({ total: sql<number>`count(*)::int` })
      .from(waMessages)
      .where(
        and(
          eq(waMessages.sessionId, sessionId),
          ne(waMessages.status, "dropped"),
          after === null ? undefined : sql`${waMessages.createdAt} > ${after}`,
        ),
      );
    return row?.total ?? 0;
  }

  async saveSummary(sessionId: string, summary: string, summarizedCount: number): Promise<void> {
    await this.handle.db
      .update(waAgentSessions)
      .set({ summary, summarizedCount })
      .where(eq(waAgentSessions.id, sessionId));
  }
}
