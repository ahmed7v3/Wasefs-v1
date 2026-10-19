import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { CreditsService } from "../../credits/credits.service.js";
import { decodeCursor, toPage } from "../common/keyset.js";

import {
  AdminPlansRepo,
  type AssignmentRow,
  type PlanPatch,
  type PlanWithEntitlements,
} from "./admin-plans.repo.js";

import type { AuditScope } from "../../audit/audited.decorator.js";
import type { AuthenticatedUser } from "../../common/current-user.js";
import type { Plan, PlanEntitlement, WalletOwner } from "@wasfa/db";
import type {
  AssignPlanInput,
  CreatePlanInput,
  PlanAssignmentView,
  PlanAssignmentsQuery,
  PlanEntitlementInput,
  PlanView,
  UpdatePlanInput,
} from "@wasfa/shared/schemas/plans";

/** Fields kept in the audit rows of plan changes. */
export const PLAN_AUDIT_FIELDS = [
  "key",
  "nameAr",
  "nameEn",
  "audience",
  "isDefault",
  "monthlyCredits",
  "visibility",
  "sort",
  "badgeAr",
  "badgeEn",
  "taglineAr",
  "taglineEn",
  "features",
  "trialDays",
  "pinRecommended",
  "maxMembers",
  "fairUseNoteAr",
  "fairUseNoteEn",
  "availableFrom",
  "availableUntil",
] as const;
export const ENTITLEMENT_AUDIT_FIELDS = ["entitlements"] as const;
// No ids or dates in `before`/`after`: the audit redactor scrubs digit runs (phone numbers) and
// would randomly mangle them. The target id (the assignment) holds the owner, plan and dates.
export const ASSIGNMENT_AUDIT_FIELDS = ["ownerType", "planKey", "reason", "ended"] as const;

const conflict = (reason: string) => new AppError(ErrorCode.CONFLICT, { details: { reason } });

const planFields = (plan: Plan) => ({
  key: plan.key,
  nameAr: plan.nameAr,
  nameEn: plan.nameEn,
  audience: plan.audience,
  isDefault: plan.isDefault,
  monthlyCredits: plan.monthlyCredits,
  visibility: plan.visibility,
  sort: plan.sort,
  badgeAr: plan.badgeAr,
  badgeEn: plan.badgeEn,
  taglineAr: plan.taglineAr,
  taglineEn: plan.taglineEn,
  features: plan.features,
  trialDays: plan.trialDays,
  pinRecommended: plan.pinRecommended,
  maxMembers: plan.maxMembers,
  fairUseNoteAr: plan.fairUseNoteAr,
  fairUseNoteEn: plan.fairUseNoteEn,
});

const entitlementView = (row: PlanEntitlement) => ({
  task: row.task,
  allowed: row.allowed,
  modes: row.modes,
  dailyCap: row.dailyCap,
  monthlyCap: row.monthlyCap,
  maxPagesPerRx: row.maxPagesPerRx,
  webSearch: row.webSearch,
});

/**
 * `2026/10/20 10:00 UTC`: the audit redactor reads `2026-10-20` as a phone-like digit run and would
 * scrub it, slashes keep the date readable.
 */
const auditDate = (date: Date | null) =>
  date ? `${date.toISOString().slice(0, 16).replaceAll("-", "/").replace("T", " ")} UTC` : null;

/** Audit snapshot of a plan: its fields and its sale window. */
const auditFields = (plan: Plan) => ({
  ...planFields(plan),
  availableFrom: auditDate(plan.availableFrom),
  availableUntil: auditDate(plan.availableUntil),
});

const planView = (plan: PlanWithEntitlements): PlanView => ({
  id: plan.id,
  ...planFields(plan),
  availableFrom: plan.availableFrom?.toISOString() ?? null,
  availableUntil: plan.availableUntil?.toISOString() ?? null,
  createdAt: plan.createdAt.toISOString(),
  updatedAt: plan.updatedAt.toISOString(),
  entitlements: plan.entitlements.map(entitlementView),
});

function assignmentView(row: AssignmentRow): PlanAssignmentView {
  const { assignment } = row;
  const ownerId = assignment.ownerUserId ?? assignment.ownerOrgId;
  if (ownerId === null) throw new Error("Assignment without an owner");
  const owner: WalletOwner = {
    type: assignment.ownerUserId !== null ? "user" : "org",
    id: ownerId,
  };
  return {
    id: assignment.id,
    owner,
    ownerDisplay:
      owner.type === "user"
        ? { name: row.ownerUserName, email: row.ownerUserEmail }
        : { name: row.ownerOrgName, email: null },
    plan: {
      id: assignment.planId,
      key: row.planKey,
      nameAr: row.planNameAr,
      nameEn: row.planNameEn,
    },
    startsAt: assignment.startsAt.toISOString(),
    endsAt: assignment.endsAt?.toISOString() ?? null,
    assignedBy: assignment.assignedBy,
    assignedByDisplay: assignment.assignedBy === null ? null : { name: row.assignedByName },
    reason: assignment.reason,
    createdAt: assignment.createdAt.toISOString(),
  };
}

/** Plan editor and manual assignments (Phase 2; subscriptions replace assignments in Phase 3). */
@Injectable()
export class AdminPlansService {
  constructor(
    private readonly repo: AdminPlansRepo,
    private readonly credits: CreditsService,
  ) {}

  async list(): Promise<{ items: PlanView[] }> {
    return { items: (await this.repo.list()).map(planView) };
  }

  async create(input: CreatePlanInput, audit: AuditScope): Promise<PlanView> {
    const created = await this.repo.create(input);
    if (!created) throw conflict("plan_key_exists");
    audit.targetId = created.id;
    audit.after = auditFields(created);
    return planView({ ...created, entitlements: [] });
  }

  async update(id: string, input: UpdatePlanInput, audit: AuditScope): Promise<PlanView> {
    const { availableFrom, availableUntil, ...rest } = input;
    const patch: PlanPatch = {
      ...rest,
      ...(availableFrom === undefined
        ? {}
        : { availableFrom: availableFrom === null ? null : new Date(availableFrom) }),
      ...(availableUntil === undefined
        ? {}
        : { availableUntil: availableUntil === null ? null : new Date(availableUntil) }),
    };
    const outcome = await this.repo.update(id, patch);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "default_required") throw conflict("default_plan_required");
    if (outcome.kind === "invalid_window") throw conflict("invalid_window");
    audit.targetId = id;
    audit.before = auditFields(outcome.before);
    audit.after = auditFields(outcome.after);
    const plan = await this.repo.find(id);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND);
    return planView(plan);
  }

  async replaceEntitlements(
    id: string,
    entitlements: readonly PlanEntitlementInput[],
    audit: AuditScope,
  ): Promise<PlanView> {
    const changes = await this.repo.replaceEntitlements(id, entitlements);
    if (!changes) throw new AppError(ErrorCode.NOT_FOUND);
    audit.targetId = id;
    audit.before = { entitlements: changes.before.map(entitlementView) };
    audit.after = { entitlements: changes.after.map(entitlementView) };
    const plan = await this.repo.find(id);
    if (!plan) throw new AppError(ErrorCode.NOT_FOUND);
    return planView(plan);
  }

  async remove(id: string, audit: AuditScope): Promise<void> {
    const outcome = await this.repo.remove(id);
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind !== "deleted") throw conflict("plan_in_use");
    audit.targetId = id;
    audit.before = auditFields(outcome.plan);
  }

  async assignments(query: PlanAssignmentsQuery) {
    const owner: WalletOwner | undefined =
      query.ownerType !== undefined && query.ownerId !== undefined
        ? { type: query.ownerType, id: query.ownerId }
        : undefined;
    const rows = await this.repo.assignmentPage(
      owner,
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({
      at: row.cursorAt,
      key: row.assignment.id,
    }));
    return { items: page.items.map(assignmentView), nextCursor: page.nextCursor };
  }

  async assign(
    actor: AuthenticatedUser,
    input: AssignPlanInput,
    audit: AuditScope,
  ): Promise<PlanAssignmentView> {
    const plan = await this.repo.find(input.planId);
    if (!plan || !(await this.credits.ownerExists(input.owner))) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    const created = await this.repo.createAssignment({
      owner: input.owner,
      planId: plan.id,
      startsAt: input.startsAt === undefined ? undefined : new Date(input.startsAt),
      endsAt: input.endsAt === undefined || input.endsAt === null ? null : new Date(input.endsAt),
      assignedBy: actor.id,
      reason: input.reason,
    });
    audit.targetId = created.id;
    audit.after = { ownerType: input.owner.type, planKey: plan.key, reason: input.reason };
    const row = await this.repo.findAssignment(created.id);
    if (!row) throw new Error("Assignment was not stored");
    return assignmentView(row);
  }

  async endAssignment(id: string, audit: AuditScope): Promise<void> {
    const outcome = await this.repo.endAssignment(id, new Date());
    if (outcome.kind === "not_found") throw new AppError(ErrorCode.NOT_FOUND);
    if (outcome.kind === "already_ended") throw conflict("assignment_ended");
    audit.targetId = id;
    audit.before = { ended: false };
    audit.after = { ended: true };
  }
}
