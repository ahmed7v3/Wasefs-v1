import { Inject, Injectable } from "@nestjs/common";
import { organizationMemberLimits } from "@wasfa/db";
import { and, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";

/** The only place `organization_member_limits` is written. The cap is enforced at reserve time (`@wasfa/db` credits-ledger). */
@Injectable()
export class MemberLimitsRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async set(orgId: string, userId: string, monthlyCreditCap: number, setBy: string): Promise<void> {
    await this.handle.db
      .insert(organizationMemberLimits)
      .values({ orgId, userId, monthlyCreditCap, setBy })
      .onConflictDoUpdate({
        target: [organizationMemberLimits.orgId, organizationMemberLimits.userId],
        set: { monthlyCreditCap, setBy, updatedAt: sql`now()` },
      });
  }

  async clear(orgId: string, userId: string): Promise<void> {
    await this.handle.db
      .delete(organizationMemberLimits)
      .where(
        and(eq(organizationMemberLimits.orgId, orgId), eq(organizationMemberLimits.userId, userId)),
      );
  }
}
