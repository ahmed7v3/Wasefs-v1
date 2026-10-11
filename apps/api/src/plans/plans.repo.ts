import { Inject, Injectable } from "@nestjs/common";
import {
  planAssignments,
  planEntitlements,
  plans,
  type Plan,
  type PlanEntitlement,
  type WalletOwner,
} from "@wasfa/db";
import { and, desc, eq, gt, inArray, isNull, lte, or, type SQL } from "drizzle-orm";

import { DB, type DbHandle } from "../common/database.js";

import type { AiTask } from "@wasfa/shared/ai";

/** `user:<id>` / `org:<id>`: the key of an owner in a map. */
export const ownerKey = (owner: WalletOwner): string => `${owner.type}:${owner.id}`;

const ownerCondition = (owner: WalletOwner): SQL =>
  owner.type === "user"
    ? eq(planAssignments.ownerUserId, owner.id)
    : eq(planAssignments.ownerOrgId, owner.id);

/** An assignment counts while `starts_at <= now < coalesce(ends_at, infinity)`. */
const activeAt = (now: Date): SQL =>
  and(
    lte(planAssignments.startsAt, now),
    or(isNull(planAssignments.endsAt), gt(planAssignments.endsAt, now)),
  ) as SQL;

/** Which plan an owner is on and what the plan allows. Writes (the plan editor) live in `AdminPlansRepo`. */
@Injectable()
export class PlansRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  async defaultPlan(): Promise<Plan | undefined> {
    const [row] = await this.handle.db.select().from(plans).where(eq(plans.isDefault, true));
    return row;
  }

  /** The newest open assignment of the owner, or `undefined` when they are on the default plan. */
  async assignedPlan(owner: WalletOwner, now: Date): Promise<Plan | undefined> {
    const [row] = await this.handle.db
      .select({ plan: plans })
      .from(planAssignments)
      .innerJoin(plans, eq(plans.id, planAssignments.planId))
      .where(and(ownerCondition(owner), activeAt(now)))
      .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id))
      .limit(1);
    return row?.plan;
  }

  /** Assigned plans of many owners at once (a page of wallets); owners without one are absent. */
  async assignedPlans(owners: readonly WalletOwner[], now: Date): Promise<Map<string, Plan>> {
    const found = new Map<string, Plan>();
    const groups = [
      { type: "user", column: planAssignments.ownerUserId },
      { type: "org", column: planAssignments.ownerOrgId },
    ] as const;
    for (const { type, column } of groups) {
      const ids = owners.filter((owner) => owner.type === type).map((owner) => owner.id);
      if (ids.length === 0) continue;
      const rows = await this.handle.db
        .select({ ownerId: column, plan: plans })
        .from(planAssignments)
        .innerJoin(plans, eq(plans.id, planAssignments.planId))
        .where(and(inArray(column, ids), activeAt(now)))
        .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id));
      // Newest first, so the first row seen for an owner is the effective one.
      for (const row of rows) {
        if (row.ownerId === null) continue;
        const key = `${type}:${row.ownerId}`;
        if (!found.has(key)) found.set(key, row.plan);
      }
    }
    return found;
  }

  async entitlementOf(planId: string, task: AiTask): Promise<PlanEntitlement | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(planEntitlements)
      .where(and(eq(planEntitlements.planId, planId), eq(planEntitlements.task, task)));
    return row;
  }
}
