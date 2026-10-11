import { Inject, Injectable } from "@nestjs/common";
import {
  isUniqueViolation,
  organizations,
  planAssignments,
  planEntitlements,
  plans,
  users,
  type NewPlan,
  type Plan,
  type PlanAssignment,
  type PlanEntitlement,
  type WalletOwner,
} from "@wasfa/db";
import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { and, asc, count, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DB, type DbHandle } from "../../common/database.js";
import { afterCursor, stamp, type Cursor } from "../common/keyset.js";

import type { PlanEntitlementInput } from "@wasfa/shared/schemas/plans";

export interface PlanWithEntitlements extends Plan {
  entitlements: PlanEntitlement[];
}

export interface AssignmentRow {
  assignment: PlanAssignment;
  planKey: string;
  planNameAr: string;
  planNameEn: string;
  /** Set for a user owner (the other owner side is null). */
  ownerUserName: string | null;
  ownerUserEmail: string | null;
  /** Set for an organization owner. */
  ownerOrgName: string | null;
  assignedByName: string | null;
  /** `created_at` as exact text, for the cursor. */
  cursorAt: string;
}

type PatchableField =
  | "nameAr"
  | "nameEn"
  | "audience"
  | "isDefault"
  | "monthlyCredits"
  | "visibility"
  | "sort"
  | "badgeAr"
  | "badgeEn";

/** The fields of a plan an admin may change; `undefined` = leave as is. */
export type PlanPatch = { [K in PatchableField]?: NewPlan[K] | undefined };

export type UpdateOutcome =
  | { kind: "updated"; before: Plan; after: Plan }
  | { kind: "not_found" }
  | { kind: "default_required" };

export type RemoveOutcome =
  | { kind: "deleted"; plan: Plan }
  | { kind: "not_found" }
  | { kind: "default_plan" }
  | { kind: "in_use" };

const PLAN_KEY_CONSTRAINT = "plans_key_key";

/** `users` a second time: the admin who made the assignment, next to the user who owns it. */
const assigner = alias(users, "assigner");

/** Plan editing and assignments (the writes). Reading what a plan allows is `PlansRepo`. */
@Injectable()
export class AdminPlansRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** Every plan with its entitlements, in the order the picker shows them. */
  async list(): Promise<PlanWithEntitlements[]> {
    const [planRows, entitlementRows] = await Promise.all([
      this.handle.db.select().from(plans).orderBy(asc(plans.sort), asc(plans.key)),
      this.handle.db.select().from(planEntitlements).orderBy(asc(planEntitlements.task)),
    ]);
    return planRows.map((plan) => ({
      ...plan,
      entitlements: entitlementRows.filter((row) => row.planId === plan.id),
    }));
  }

  async find(id: string): Promise<PlanWithEntitlements | undefined> {
    const [plan] = await this.handle.db.select().from(plans).where(eq(plans.id, id));
    if (!plan) return undefined;
    const entitlements = await this.handle.db
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, plan.id))
      .orderBy(asc(planEntitlements.task));
    return { ...plan, entitlements };
  }

  /**
   * `undefined` when the key is taken. A new default plan takes the flag from the old one in the
   * same transaction, so there is never none or two.
   */
  async create(values: NewPlan): Promise<Plan | undefined> {
    try {
      return await this.handle.db.transaction(async (tx) => {
        if (values.isDefault === true) {
          // Plans are few; locking them all serialises two concurrent default switches.
          await tx.select({ id: plans.id }).from(plans).for("update");
          await tx.update(plans).set({ isDefault: false }).where(eq(plans.isDefault, true));
        }
        const [created] = await tx.insert(plans).values(values).returning();
        if (!created) throw new Error("Plan was not stored");
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error, PLAN_KEY_CONSTRAINT)) return undefined;
      throw error;
    }
  }

  update(id: string, patch: PlanPatch): Promise<UpdateOutcome> {
    return this.handle.db.transaction(async (tx) => {
      if (patch.isDefault === true) {
        await tx.select({ id: plans.id }).from(plans).for("update");
      }
      const [before] = await tx.select().from(plans).where(eq(plans.id, id)).for("update");
      if (!before) return { kind: "not_found" } as const;
      // The default plan is replaced by making another one default, never by switching it off.
      if (patch.isDefault === false && before.isDefault)
        return { kind: "default_required" } as const;

      if (patch.isDefault === true && !before.isDefault) {
        await tx
          .update(plans)
          .set({ isDefault: false })
          .where(and(eq(plans.isDefault, true), ne(plans.id, id)));
      }
      const [after] = await tx.update(plans).set(patch).where(eq(plans.id, id)).returning();
      if (!after) throw new Error("Plan was not updated");
      return { kind: "updated", before, after } as const;
    });
  }

  /** Replaces the plan's entitlements as a whole. `undefined` when the plan is gone. */
  replaceEntitlements(
    planId: string,
    entitlements: readonly PlanEntitlementInput[],
  ): Promise<{ before: PlanEntitlement[]; after: PlanEntitlement[] } | undefined> {
    return this.handle.db.transaction(async (tx) => {
      const [plan] = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.id, planId))
        .for("update");
      if (!plan) return undefined;
      const before = await tx
        .select()
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, planId))
        .orderBy(asc(planEntitlements.task));
      await tx.delete(planEntitlements).where(eq(planEntitlements.planId, planId));
      const after =
        entitlements.length === 0
          ? []
          : await tx
              .insert(planEntitlements)
              .values(
                entitlements.map((row) => ({
                  planId,
                  task: row.task,
                  allowed: row.allowed,
                  modes: row.modes,
                  dailyCap: row.dailyCap,
                  monthlyCap: row.monthlyCap,
                  // No per-plan page limit means the global one.
                  maxPagesPerRx: row.maxPagesPerRx ?? RX_MAX_PAGES,
                  webSearch: row.webSearch,
                })),
              )
              .returning();
      await tx
        .update(plans)
        .set({ updatedAt: sql`now()` })
        .where(eq(plans.id, planId));
      return { before, after: after.sort((a, b) => a.task.localeCompare(b.task)) };
    });
  }

  /** Refuses the default plan and any plan that has (or had) assignments: history keeps its plan. */
  remove(id: string): Promise<RemoveOutcome> {
    return this.handle.db.transaction(async (tx) => {
      const [plan] = await tx.select().from(plans).where(eq(plans.id, id)).for("update");
      if (!plan) return { kind: "not_found" } as const;
      if (plan.isDefault) return { kind: "default_plan" } as const;
      const [used] = await tx
        .select({ assignments: count() })
        .from(planAssignments)
        .where(eq(planAssignments.planId, id));
      if ((used?.assignments ?? 0) > 0) return { kind: "in_use" } as const;
      await tx.delete(plans).where(eq(plans.id, id));
      return { kind: "deleted", plan } as const;
    });
  }

  async planExists(id: string): Promise<boolean> {
    const [row] = await this.handle.db.select({ id: plans.id }).from(plans).where(eq(plans.id, id));
    return row !== undefined;
  }

  async createAssignment(values: {
    owner: WalletOwner;
    planId: string;
    startsAt?: Date | undefined;
    endsAt?: Date | null | undefined;
    assignedBy: string;
    reason: string;
  }): Promise<PlanAssignment> {
    const [row] = await this.handle.db
      .insert(planAssignments)
      .values({
        ...(values.owner.type === "user"
          ? { ownerUserId: values.owner.id }
          : { ownerOrgId: values.owner.id }),
        planId: values.planId,
        ...(values.startsAt ? { startsAt: values.startsAt } : {}),
        endsAt: values.endsAt ?? null,
        assignedBy: values.assignedBy,
        reason: values.reason,
      })
      .returning();
    if (!row) throw new Error("Assignment was not stored");
    return row;
  }

  /** `limit + 1` assignments, newest first; one owner's history when `owner` is given. */
  async assignmentPage(
    owner: WalletOwner | undefined,
    cursor: Cursor | undefined,
    limit: number,
  ): Promise<AssignmentRow[]> {
    const conditions: (SQL | undefined)[] = [];
    if (owner) {
      conditions.push(
        owner.type === "user"
          ? eq(planAssignments.ownerUserId, owner.id)
          : eq(planAssignments.ownerOrgId, owner.id),
      );
    }
    if (cursor) {
      conditions.push(afterCursor(planAssignments.createdAt, planAssignments.id, cursor, "uuid"));
    }
    const rows = await this.assignmentSelect()
      .where(and(...conditions))
      .orderBy(desc(planAssignments.createdAt), desc(planAssignments.id))
      .limit(limit + 1);
    return rows;
  }

  async findAssignment(id: string): Promise<AssignmentRow | undefined> {
    const [row] = await this.assignmentSelect().where(eq(planAssignments.id, id));
    return row;
  }

  /**
   * Assignments with their plan and the names to show for owner and assigner, in one query. The
   * joins are LEFT so a missing row never hides an assignment; an anonymized user keeps the
   * (anonymized) values stored on the row.
   */
  private assignmentSelect() {
    return this.handle.db
      .select({
        assignment: planAssignments,
        planKey: plans.key,
        planNameAr: plans.nameAr,
        planNameEn: plans.nameEn,
        ownerUserName: users.name,
        ownerUserEmail: users.email,
        ownerOrgName: organizations.name,
        assignedByName: assigner.name,
        cursorAt: stamp(planAssignments.createdAt),
      })
      .from(planAssignments)
      .innerJoin(plans, eq(plans.id, planAssignments.planId))
      .leftJoin(users, eq(users.id, planAssignments.ownerUserId))
      .leftJoin(organizations, eq(organizations.id, planAssignments.ownerOrgId))
      .leftJoin(assigner, eq(assigner.id, planAssignments.assignedBy));
  }

  /**
   * Closes an assignment at `now` (or just after its start, for one that has not begun: the period
   * check needs `ends_at > starts_at`, and such a row then never applies). `already_ended` when it is
   * not open any more.
   */
  endAssignment(
    id: string,
    now: Date,
  ): Promise<
    | { kind: "ended"; before: PlanAssignment; after: PlanAssignment }
    | { kind: "not_found" }
    | { kind: "already_ended" }
  > {
    return this.handle.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(planAssignments)
        .where(eq(planAssignments.id, id))
        .for("update");
      if (!before) return { kind: "not_found" } as const;
      if (before.endsAt !== null && before.endsAt.getTime() <= now.getTime()) {
        return { kind: "already_ended" } as const;
      }
      const endsAt = new Date(Math.max(now.getTime(), before.startsAt.getTime() + 1));
      const [after] = await tx
        .update(planAssignments)
        .set({ endsAt })
        .where(eq(planAssignments.id, id))
        .returning();
      if (!after) throw new Error("Assignment was not updated");
      return { kind: "ended", before, after } as const;
    });
  }
}
