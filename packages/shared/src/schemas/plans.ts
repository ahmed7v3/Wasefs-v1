import { z } from "zod";

import { AI_MODES, AI_TASKS } from "../ai.js";
import { PLAN_AUDIENCES, PLAN_KEY_PATTERN, PLAN_VISIBILITIES } from "../plans.js";
import { RX_MAX_PAGES } from "../rx.js";

import { cursorQuerySchema } from "./admin.js";
import { creditReasonSchema, planSummarySchema, walletOwnerSchema } from "./credits.js";

/*
 * Plans contract (Phase 2, Task 2.2): plan management for the admin panel. A plan's allowances are
 * one entitlement per task, replaced as a whole.
 */

const isoDate = z.iso.datetime({ offset: true });

export const PLAN_MONTHLY_CREDITS_MAX = 1_000_000;
const badge = z.string().trim().min(1).max(24).nullable();

const planFields = {
  key: z.string().min(2).max(40).regex(PLAN_KEY_PATTERN),
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  audience: z.enum(PLAN_AUDIENCES),
  isDefault: z.boolean(),
  monthlyCredits: z.number().int().min(0).max(PLAN_MONTHLY_CREDITS_MAX),
  visibility: z.enum(PLAN_VISIBILITIES),
  sort: z.number().int().min(-10_000).max(10_000),
  badgeAr: badge,
  badgeEn: badge,
};

export const createPlanSchema = z.object({
  ...planFields,
  audience: planFields.audience.default("any"),
  isDefault: planFields.isDefault.default(false),
  visibility: planFields.visibility.default("public"),
  sort: planFields.sort.default(0),
  badgeAr: planFields.badgeAr.default(null),
  badgeEn: planFields.badgeEn.default(null),
});
export type CreatePlanInput = z.output<typeof createPlanSchema>;

/** A plan's key is its identity in code and in flag rules: it never changes. */
export const updatePlanSchema = z
  .object({
    nameAr: planFields.nameAr,
    nameEn: planFields.nameEn,
    audience: planFields.audience,
    isDefault: planFields.isDefault,
    monthlyCredits: planFields.monthlyCredits,
    visibility: planFields.visibility,
    sort: planFields.sort,
    badgeAr: planFields.badgeAr,
    badgeEn: planFields.badgeEn,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "at least one field");
export type UpdatePlanInput = z.output<typeof updatePlanSchema>;

export const planParamSchema = z.object({ id: z.uuid() });

export const planEntitlementSchema = z
  .object({
    task: z.enum(AI_TASKS),
    allowed: z.boolean(),
    modes: z
      .array(z.enum(AI_MODES))
      .max(AI_MODES.length)
      .refine((modes) => new Set(modes).size === modes.length, "modes must be unique"),
    /** Null = unlimited. */
    dailyCap: z.number().int().min(0).max(1_000_000).nullable(),
    monthlyCap: z.number().int().min(0).max(1_000_000).nullable(),
    maxPagesPerRx: z.number().int().min(1).max(RX_MAX_PAGES).nullable(),
    webSearch: z.boolean(),
  })
  .refine((entitlement) => !entitlement.allowed || entitlement.modes.length > 0, {
    message: "an allowed task needs at least one mode",
    path: ["modes"],
  });
export type PlanEntitlementInput = z.output<typeof planEntitlementSchema>;

/** The full set for the plan: tasks not listed lose their row (= not configured = not allowed). */
export const putEntitlementsSchema = z
  .array(planEntitlementSchema)
  .max(AI_TASKS.length)
  .refine(
    (rows) => new Set(rows.map((row) => row.task)).size === rows.length,
    "tasks must be unique",
  );

export const planEntitlementViewSchema = z.object({
  task: z.enum(AI_TASKS),
  allowed: z.boolean(),
  modes: z.array(z.enum(AI_MODES)),
  dailyCap: z.number().int().nullable(),
  monthlyCap: z.number().int().nullable(),
  maxPagesPerRx: z.number().int(),
  webSearch: z.boolean(),
});
export type PlanEntitlementView = z.output<typeof planEntitlementViewSchema>;

export const planViewSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  audience: z.enum(PLAN_AUDIENCES),
  isDefault: z.boolean(),
  monthlyCredits: z.number().int(),
  visibility: z.enum(PLAN_VISIBILITIES),
  sort: z.number().int(),
  badgeAr: z.string().nullable(),
  badgeEn: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  entitlements: z.array(planEntitlementViewSchema),
});
export type PlanView = z.output<typeof planViewSchema>;

export const planListResponseSchema = z.object({ items: z.array(planViewSchema) });

export const assignPlanSchema = z
  .object({
    owner: walletOwnerSchema,
    planId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
    reason: creditReasonSchema,
  })
  .refine(
    (value) =>
      value.endsAt === undefined ||
      value.endsAt === null ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt ?? new Date().toISOString()),
    { message: "ends_at must be after starts_at", path: ["endsAt"] },
  );
export type AssignPlanInput = z.output<typeof assignPlanSchema>;

export const planAssignmentSchema = z.object({
  id: z.uuid(),
  owner: walletOwnerSchema,
  plan: planSummarySchema,
  startsAt: isoDate,
  endsAt: isoDate.nullable(),
  assignedBy: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: isoDate,
});
export type PlanAssignmentView = z.output<typeof planAssignmentSchema>;

export const planAssignmentPageSchema = z.object({
  items: z.array(planAssignmentSchema),
  nextCursor: z.string().nullable(),
});

/** Both owner fields or neither: a half-given owner is a mistake, not "everyone". */
export const planAssignmentsQuerySchema = cursorQuerySchema
  .extend({
    ownerType: walletOwnerSchema.shape.type.optional(),
    ownerId: z.uuid().optional(),
  })
  .refine((value) => (value.ownerType === undefined) === (value.ownerId === undefined), {
    message: "ownerType and ownerId go together",
    path: ["ownerId"],
  });
export type PlanAssignmentsQuery = z.output<typeof planAssignmentsQuerySchema>;
