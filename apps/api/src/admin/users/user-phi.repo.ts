import { Inject, Injectable } from "@nestjs/common";
import {
  chats,
  phiAccessSessions,
  rxAnalyses,
  rxCorrections,
  users,
  type PhiAccessSession,
  type RxAnalysis,
} from "@wasfa/db";
import { and, asc, desc, eq, gt, or, sql, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

import type { PhiAccessReason } from "@wasfa/shared/growth";

/** The analyses that belong to the user: made by them, or made for them (organization context). */
const ofUser = (userId: string): SQL | undefined =>
  or(eq(rxAnalyses.ownerUserId, userId), eq(rxAnalyses.createdBy, userId));

// `result.items` is free JSON in the table: only a well-formed array is counted.
const items = sql`case when jsonb_typeof(${rxAnalyses.result}->'items') = 'array' then ${rxAnalyses.result}->'items' else '[]'::jsonb end`;
const badgeCount = (badge: string) =>
  sql<number>`(select count(*)::int from jsonb_array_elements(${items}) as item where item->>'badge' = ${badge})`;

/** Health-data reads of the user 360 page (Decision 12). Metadata lists never select drug text. */
@Injectable()
export class AdminUserPhiRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async createSession(input: {
    adminId: string;
    userId: string;
    reason: PhiAccessReason;
    note: string | null;
    expiresAt: Date;
  }): Promise<PhiAccessSession> {
    const [row] = await this.handle.db
      .insert(phiAccessSessions)
      .values({
        adminUserId: input.adminId,
        userId: input.userId,
        reason: input.reason,
        note: input.note,
        expiresAt: input.expiresAt,
      })
      .returning();
    if (!row) throw new Error("PHI access session was not stored");
    return row;
  }

  /** The newest unexpired session of THIS admin for THIS user. */
  async activeSession(
    adminId: string,
    userId: string,
    now: Date,
  ): Promise<PhiAccessSession | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(phiAccessSessions)
      .where(
        and(
          eq(phiAccessSessions.adminUserId, adminId),
          eq(phiAccessSessions.userId, userId),
          gt(phiAccessSessions.expiresAt, now),
        ),
      )
      .orderBy(desc(phiAccessSessions.expiresAt), desc(phiAccessSessions.id))
      .limit(1);
    return row;
  }

  /** Metadata only: no drug name, no text, never `result` itself. */
  prescriptionPage(userId: string, cursor: Cursor | undefined, limit: number) {
    return this.handle.db
      .select({
        id: rxAnalyses.id,
        createdAt: rxAnalyses.createdAt,
        status: rxAnalyses.status,
        mode: rxAnalyses.mode,
        skillVersion: rxAnalyses.skillVersion,
        finishedAt: rxAnalyses.finishedAt,
        credits: rxAnalyses.creditsCharged,
        pageCount: sql<number>`(select count(*)::int from rx_pages where rx_pages.analysis_id = rx_analyses.id)`,
        itemCount: sql<number>`jsonb_array_length(${items})`,
        lowConfidence: badgeCount("low"),
        mediumConfidence: badgeCount("medium"),
        costUsdMicros: sql<number>`(select coalesce(sum(ai_usage.cost_usd_micros), 0)::float8 from ai_usage where ai_usage.request_id = rx_analyses.id::text)`,
        cursorAt: stamp(rxAnalyses.createdAt),
      })
      .from(rxAnalyses)
      .where(
        and(
          ofUser(userId),
          cursor ? afterCursor(rxAnalyses.createdAt, rxAnalyses.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(rxAnalyses.createdAt), desc(rxAnalyses.id))
      .limit(limit + 1);
  }

  async findPrescription(userId: string, rxId: string): Promise<RxAnalysis | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(rxAnalyses)
      .where(and(eq(rxAnalyses.id, rxId), ofUser(userId)));
    return row;
  }

  /** What the customer view lacks: the AI cost, who created it and the user's corrections (two reads, no N+1). */
  async prescriptionExtras(rxId: string) {
    const [head] = await this.handle.db
      .select({
        costUsdMicros: sql<number>`(select coalesce(sum(ai_usage.cost_usd_micros), 0)::float8 from ai_usage where ai_usage.request_id = ${rxAnalyses.id}::text)`,
        creatorId: users.id,
        creatorName: users.name,
      })
      .from(rxAnalyses)
      .leftJoin(users, eq(users.id, rxAnalyses.createdBy))
      .where(eq(rxAnalyses.id, rxId));
    const corrections = await this.handle.db
      .select({
        itemIndex: rxCorrections.itemIndex,
        field: rxCorrections.field,
        before: rxCorrections.before,
        after: rxCorrections.after,
        createdAt: rxCorrections.createdAt,
        consentForEval: rxCorrections.consentForEval,
      })
      .from(rxCorrections)
      .where(eq(rxCorrections.analysisId, rxId))
      .orderBy(asc(rxCorrections.createdAt), asc(rxCorrections.itemIndex));
    return {
      costUsdMicros: head?.costUsdMicros ?? 0,
      creator: head?.creatorId ? { id: head.creatorId, name: head.creatorName ?? "" } : null,
      corrections,
    };
  }

  /** Dates and counts only: the title is the user's own words about their health. */
  chatPage(userId: string, cursor: Cursor | undefined, limit: number) {
    return this.handle.db
      .select({
        id: chats.id,
        createdAt: chats.createdAt,
        updatedAt: chats.updatedAt,
        archived: chats.archived,
        messageCount: sql<number>`(select count(*)::int from chat_messages m where m.chat_id = chats.id)`,
        cursorAt: stamp(chats.updatedAt),
      })
      .from(chats)
      .where(
        and(
          eq(chats.userId, userId),
          cursor ? afterCursor(chats.updatedAt, chats.id, cursor, "uuid") : undefined,
        ),
      )
      .orderBy(desc(chats.updatedAt), desc(chats.id))
      .limit(limit + 1);
  }
}
