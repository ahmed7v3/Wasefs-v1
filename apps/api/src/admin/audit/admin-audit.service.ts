import { Injectable } from "@nestjs/common";

import { decodeCursor, toPage, type Page } from "../common/keyset.js";

import { AdminAuditRepo, type AuditRow } from "./admin-audit.repo.js";

import type { AuditEntry, AuditQuery } from "@wasfa/shared/schemas/admin";

export function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly repo: AdminAuditRepo) {}

  async list(query: AuditQuery): Promise<Page<AuditEntry>> {
    const rows = await this.repo.list(
      {
        actorId: query.actorId,
        action: query.action,
        targetType: query.targetType,
        targetId: query.targetId,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return { items: page.items.map(toAuditEntry), nextCursor: page.nextCursor };
  }

  async recentForUser(userId: string): Promise<AuditEntry[]> {
    return (await this.repo.recentFor(userId, 20)).map(toAuditEntry);
  }
}
