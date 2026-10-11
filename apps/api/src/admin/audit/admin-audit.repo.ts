import { Inject, Injectable } from "@nestjs/common";
import { auditLogs, users } from "@wasfa/db";
import { and, desc, eq, gte, lte, or, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

export interface AuditFilters {
  actorId?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

const columns = {
  id: auditLogs.id,
  actorId: auditLogs.actorId,
  actorName: users.name,
  action: auditLogs.action,
  targetType: auditLogs.targetType,
  targetId: auditLogs.targetId,
  before: auditLogs.before,
  after: auditLogs.after,
  ip: auditLogs.ip,
  userAgent: auditLogs.userAgent,
  createdAt: auditLogs.createdAt,
  cursorAt: stamp(auditLogs.createdAt),
};

/** Read side of `audit_logs` for the admin panel (the API's database role cannot update or delete there). */
@Injectable()
export class AdminAuditRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `limit + 1` rows, newest first, so the caller can tell whether another page exists. */
  list(filters: AuditFilters, cursor: Cursor | undefined, limit: number): Promise<AuditRow[]> {
    const conditions: (SQL | undefined)[] = [
      filters.actorId === undefined ? undefined : eq(auditLogs.actorId, filters.actorId),
      filters.action === undefined ? undefined : eq(auditLogs.action, filters.action),
      filters.targetType === undefined ? undefined : eq(auditLogs.targetType, filters.targetType),
      filters.targetId === undefined ? undefined : eq(auditLogs.targetId, filters.targetId),
      filters.from === undefined ? undefined : gte(auditLogs.createdAt, filters.from),
      filters.to === undefined ? undefined : lte(auditLogs.createdAt, filters.to),
      cursor === undefined
        ? undefined
        : afterCursor(auditLogs.createdAt, auditLogs.id, cursor, "uuid"),
    ];
    return this.handle.db
      .select(columns)
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit + 1);
  }

  /** The latest rows where the user is the target or the actor. */
  recentFor(userId: string, limit: number): Promise<AuditRow[]> {
    return this.handle.db
      .select(columns)
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(
        or(
          and(eq(auditLogs.targetType, "user"), eq(auditLogs.targetId, userId)),
          eq(auditLogs.actorId, userId),
        ),
      )
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit);
  }
}
