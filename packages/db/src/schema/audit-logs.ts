import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { idColumn } from "./columns.js";

// Append-only record of every admin write: who, what, before/after.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: idColumn(),
    actorId: uuid(),
    action: text().notNull(),
    targetType: text().notNull(),
    targetId: text(),
    before: jsonb(),
    after: jsonb(),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
    index("audit_logs_actor_created_idx").on(table.actorId, table.createdAt),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
