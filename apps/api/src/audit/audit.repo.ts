import { Inject, Injectable } from "@nestjs/common";
import { auditLogs, type NewAuditLog } from "@wasfa/db";

import { DB, type DbHandle } from "../common/database.js";

/**
 * The only writer of `audit_logs`. The API's database role may INSERT and SELECT here but not
 * UPDATE or DELETE (migration 0005), so even a bug in this class cannot rewrite history.
 */
@Injectable()
export class AuditRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async insert(row: NewAuditLog): Promise<void> {
    await this.handle.db.insert(auditLogs).values(row);
  }
}
