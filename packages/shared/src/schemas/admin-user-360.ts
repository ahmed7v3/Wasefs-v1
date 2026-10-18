import { z } from "zod";

import { BILLING_KEY_PATTERN, BILLING_MAX_MONTHS, CURRENCY_CODE_PATTERN } from "../billing.js";
import { PHI_ACCESS_REASONS } from "../growth.js";
import { PLAN_KEY_PATTERN } from "../plans.js";

/*
 * User 360 (Task 3.15; ADMIN-CONSOLE-SPEC §8): bodies and queries of the `/admin/users/:id/*`
 * routes. Lists are keyset-paginated `{ items, nextCursor }`; money is integer minor units.
 */

const cursor = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional();
const limit = z.coerce.number().int().min(1).max(100).default(25);
const reason = z.string().trim().min(3).max(500);

export const adminUserPageQuerySchema = z.object({ cursor, limit });
export type AdminUserPageQuery = z.output<typeof adminUserPageQuerySchema>;

export const adminUserParamsSchema = z.object({ id: z.uuid() });
export const adminUserRxParamsSchema = z.object({ id: z.uuid(), rxId: z.uuid() });
export const adminUserChatParamsSchema = z.object({ id: z.uuid(), chatId: z.uuid() });
export const adminUserNoteParamsSchema = z.object({ id: z.uuid(), noteId: z.uuid() });
export const adminReferralParamsSchema = z.object({ referralId: z.uuid() });

// --- Contact reveal -----------------------------------------------------------------------------

export const CONTACT_FIELDS = ["email", "phone"] as const;
export const adminRevealContactSchema = z.object({ field: z.enum(CONTACT_FIELDS), reason });
export type AdminRevealContact = z.output<typeof adminRevealContactSchema>;

// --- PHI access ---------------------------------------------------------------------------------

export const adminPhiSessionSchema = z.object({
  reason: z.enum(PHI_ACCESS_REASONS),
  note: z.string().trim().max(300).optional(),
});
export type AdminPhiSession = z.output<typeof adminPhiSessionSchema>;

// --- Notes --------------------------------------------------------------------------------------

export const adminNoteCreateSchema = z.object({
  body: z.string().trim().min(1).max(4_000),
  pinned: z.boolean().default(false),
});
export const adminNotePatchSchema = z
  .object({ pinned: z.boolean().optional(), body: z.string().trim().min(1).max(4_000).optional() })
  .refine((value) => value.pinned !== undefined || value.body !== undefined, "empty");
export type AdminNoteCreate = z.output<typeof adminNoteCreateSchema>;
export type AdminNotePatch = z.output<typeof adminNotePatchSchema>;

// --- Plan change (§8.3) -------------------------------------------------------------------------

export const ADMIN_PLAN_CHANGE_KINDS = [
  "gift",
  "compensation",
  "paid_offline",
  "trial",
  "sponsored",
] as const;
export type AdminPlanChangeKind = (typeof ADMIN_PLAN_CHANGE_KINDS)[number];

const planChangeShape = {
  planKey: z.string().max(40).regex(PLAN_KEY_PATTERN),
  duration: z.union([
    z.object({ months: z.number().int().min(1).max(BILLING_MAX_MONTHS) }).strict(),
    z.object({ until: z.coerce.date() }).strict(),
  ]),
  kind: z.enum(ADMIN_PLAN_CHANGE_KINDS),
  extraCredits: z.number().int().min(0).max(1_000_000).default(0),
  notify: z.boolean().default(true),
  reason,
  paidOffline: z
    .object({
      amountMinor: z.number().int().min(1).max(1_000_000_000),
      currency: z.string().regex(CURRENCY_CODE_PATTERN),
      methodKey: z.string().regex(BILLING_KEY_PATTERN),
      reference: z.string().trim().min(1).max(120),
    })
    .optional(),
  dealId: z.uuid().optional(),
};

type PlanChangeDraft = {
  kind: AdminPlanChangeKind;
  duration: { months: number } | { until: Date };
  paidOffline?: unknown;
  dealId?: string | undefined;
};

/** The cross-field rules of the dialog: paid-offline needs the payment, sponsored needs the deal. */
function planChangeRules(value: PlanChangeDraft, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if ((value.kind === "paid_offline") !== (value.paidOffline !== undefined)) {
    issue("paidOffline", value.kind === "paid_offline" ? "required" : "not_allowed");
  }
  if ((value.kind === "sponsored") !== (value.dealId !== undefined)) {
    issue("dealId", value.kind === "sponsored" ? "required" : "not_allowed");
  }
  // An order buys whole months; "until a date" has no price.
  if (value.kind === "paid_offline" && !("months" in value.duration)) {
    issue("duration", "months_required");
  }
}

/** Preview: the same body as the change, without the idempotency id. */
export const adminPlanChangePreviewSchema = z
  .object({ ...planChangeShape, requestId: z.uuid().optional() })
  .superRefine(planChangeRules);
export const adminPlanChangeSchema = z
  .object({ ...planChangeShape, requestId: z.uuid() })
  .superRefine(planChangeRules);
export type AdminPlanChangeInput = z.output<typeof adminPlanChangeSchema>;
export type AdminPlanChangePreviewInput = z.output<typeof adminPlanChangePreviewSchema>;

export const PLAN_CHANGE_EFFECTS = ["replace", "extend", "schedule"] as const;
export type PlanChangeEffect = (typeof PLAN_CHANGE_EFFECTS)[number];

// --- Quick actions ------------------------------------------------------------------------------

export const adminCouponGrantSchema = z.object({ couponId: z.uuid() });
export const adminPersonalOfferSchema = z.object({
  promotionId: z.uuid(),
  validHours: z.number().int().min(1).max(24 * 90),
});
export const adminPointsAdjustSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, "zero"),
  // The pending bucket is the hold of the referral rewards; an admin moves spendable points only.
  bucket: z.enum(["cash", "credit_only"]),
  reason,
  requestId: z.uuid(),
});
export const adminReferralActionSchema = z.object({ reason });
