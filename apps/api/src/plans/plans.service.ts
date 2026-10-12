import { Injectable } from "@nestjs/common";

import { PlansRepo, ownerKey } from "./plans.repo.js";

import type { Plan, PlanEntitlement, WalletOwner } from "@wasfa/db";
import type { AiTask } from "@wasfa/shared/ai";

/**
 * What a user or organization may do: the plan they are on (an open assignment, else the default
 * plan) and the plan's allowance for a task. Quotas and routing read it; they never read plan rows.
 */
@Injectable()
export class PlansService {
  constructor(private readonly repo: PlansRepo) {}

  /** The plan the owner is on right now. A database without a default plan is broken, not a user error. */
  async effectivePlan(owner: WalletOwner, now = new Date()): Promise<Plan> {
    const plan = (await this.repo.assignedPlan(owner, now)) ?? (await this.repo.defaultPlan());
    if (!plan) throw new Error("No default plan exists");
    return plan;
  }

  /** Effective plans of many owners, keyed by `ownerKey`. */
  async effectivePlans(
    owners: readonly WalletOwner[],
    now = new Date(),
  ): Promise<Map<string, Plan>> {
    const assigned = await this.repo.assignedPlans(owners, now);
    const fallback = owners.some((owner) => !assigned.has(ownerKey(owner)))
      ? await this.repo.defaultPlan()
      : undefined;
    const result = new Map<string, Plan>();
    for (const owner of owners) {
      const plan = assigned.get(ownerKey(owner)) ?? fallback;
      if (!plan) throw new Error("No default plan exists");
      result.set(ownerKey(owner), plan);
    }
    return result;
  }

  /** Every allowance of a plan (what the owner may do), in no particular order. */
  entitlementsOf(plan: Plan): Promise<PlanEntitlement[]> {
    return this.repo.entitlementsOfPlan(plan.id);
  }

  /** The allowance of the owner's plan for `task`; `null` when the plan does not configure it (= not allowed). */
  async entitlement(owner: WalletOwner, task: AiTask): Promise<PlanEntitlement | null> {
    const plan = await this.effectivePlan(owner);
    return (await this.repo.entitlementOf(plan.id, task)) ?? null;
  }
}
