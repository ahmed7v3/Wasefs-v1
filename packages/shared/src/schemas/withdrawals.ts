import { z } from "zod";

import { BILLING_KEY_PATTERN, CURRENCY_CODE_PATTERN } from "../billing.js";
import { WITHDRAWAL_STATUSES } from "../rewards.js";
import {
  PAYOUT_FIELD_KINDS,
  WITHDRAWAL_FLAGS,
  WITHDRAWAL_REFUSAL_REASONS,
  WITHDRAWAL_REJECT_REASONS,
} from "../withdrawals.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * Withdrawals contract (Phase 3, Task 3.12). The server decides every amount; no schema here carries
 * a computed value from the client. A destination's plain value appears in exactly one response: the
 * admin's `reveal`.
 */

const isoDate = z.iso.datetime({ offset: true });
const currency = z.string().regex(CURRENCY_CODE_PATTERN);
const points = z.number().int().min(0);

// --- The caller's payout destinations ---------------------------------------------------------------

/** `POST /me/payout-destinations`: the values are validated against the method's field schema. */
export const payoutDestinationInputSchema = z.object({
  methodKey: z.string().regex(BILLING_KEY_PATTERN),
  values: z.record(z.string().max(32), z.string().max(80)),
});

export const payoutMethodViewSchema = z.object({
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      labelKey: z.string(),
      kind: z.enum(PAYOUT_FIELD_KINDS),
      required: z.boolean(),
    }),
  ),
  feeMinor: z.number().int().min(0),
  minAmountMinor: z.number().int().min(0).nullable(),
  maxAmountMinor: z.number().int().min(0).nullable(),
  noteAr: z.string().nullable(),
  noteEn: z.string().nullable(),
});

export const payoutDestinationViewSchema = z.object({
  id: z.uuid(),
  methodKey: z.string(),
  methodNameAr: z.string(),
  methodNameEn: z.string(),
  /** `010••••7026`; the plain value is never returned to the user either. */
  masked: z.string(),
  /** Until this moment the destination cannot receive money (the cooldown after adding it). */
  usableAfter: isoDate,
  usable: z.boolean(),
  createdAt: isoDate,
});
export type PayoutDestinationView = z.output<typeof payoutDestinationViewSchema>;

/** `GET /me/payout-destinations`. */
export const payoutDestinationsSchema = z.object({
  max: z.number().int().min(1),
  methods: z.array(payoutMethodViewSchema),
  destinations: z.array(payoutDestinationViewSchema),
});

// --- Eligibility and the caller's requests ------------------------------------------------------------

/** `GET /me/withdrawals/eligibility`: every check, with progress toward the minimum. */
export const withdrawalEligibilitySchema = z.object({
  /** False while cashing out is off (settings or kill switch): nothing else matters then. */
  available: z.boolean(),
  eligible: z.boolean(),
  /** Every check that currently fails, in `WITHDRAWAL_REFUSAL_REASONS`. */
  reasons: z.array(z.enum(WITHDRAWAL_REFUSAL_REASONS)),
  pointValueMinor: z.number().int().min(1),
  currency,
  cash: points,
  cashValueMinor: z.number().int().min(0),
  minWithdrawalPoints: points,
  minWithdrawalMinor: z.number().int().min(0),
  /** Points still missing to reach the minimum; 0 once reached. */
  pointsToMinimum: points,
  phoneVerified: z.boolean(),
  accountAgeDays: z.number().int().min(0),
  minAccountAgeDays: z.number().int().min(0),
  openRequestId: z.uuid().nullable(),
  monthly: z.object({ used: points, cap: points, remaining: points }),
  debt: points,
  /** Soonest moment a saved destination becomes usable; null when one already is or none is saved. */
  nextDestinationUsableAt: isoDate.nullable(),
  usableDestinations: z.number().int().min(0),
  slaHours: z.number().int().min(1),
  maxRequestsPerDay: z.number().int().min(1),
});
export type WithdrawalEligibility = z.output<typeof withdrawalEligibilitySchema>;

export const withdrawalTimelineEntrySchema = z.object({
  status: z.enum(["requested", "approved", "paid", "rejected", "canceled"]),
  at: isoDate,
});

/** What the user sees of one request. Review flags and admin names stay on the admin side. */
export const withdrawalViewSchema = z.object({
  id: z.uuid(),
  status: z.enum(WITHDRAWAL_STATUSES),
  points: z.number().int().min(1),
  amountMinor: z.number().int().min(0),
  feeMinor: z.number().int().min(0),
  currency,
  destination: z.object({ id: z.uuid(), methodKey: z.string(), masked: z.string() }),
  transferReference: z.string().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: isoDate,
  timeline: z.array(withdrawalTimelineEntrySchema),
});
export type WithdrawalView = z.output<typeof withdrawalViewSchema>;

/** `POST /me/withdrawals` answers with the request and whether it was already there. */
export const withdrawalCreatedSchema = withdrawalViewSchema.extend({ replayed: z.boolean() });

export const withdrawalListSchema = z.object({ items: z.array(withdrawalViewSchema) });

// --- Admin ---------------------------------------------------------------------------------------------

export const adminWithdrawalIdSchema = z.object({ id: z.uuid() });

export const adminWithdrawalListQuerySchema = cursorQuerySchema.extend({
  status: z.enum(WITHDRAWAL_STATUSES).optional(),
  flag: z.enum(WITHDRAWAL_FLAGS).optional(),
});

export const adminWithdrawalItemSchema = z.object({
  id: z.uuid(),
  status: z.enum(WITHDRAWAL_STATUSES),
  points: z.number().int().min(1),
  amountMinor: z.number().int().min(0),
  currency,
  /** Initials and a short id: never a name, email or phone. */
  maskedUser: z.string(),
  accountAgeDays: z.number().int().min(0),
  flags: z.array(z.string()),
  /** True after a first approval that still needs a different second admin. */
  awaitingSecondApproval: z.boolean(),
  ageSeconds: z.number().int().min(0),
  overdue: z.boolean(),
  lockHolder: z.object({ id: z.uuid(), displayName: z.string().nullable() }).nullable(),
  createdAt: isoDate,
});

const totalSchema = z.object({
  currency,
  count: z.number().int().min(0),
  points: z.number().int().min(0),
  amountMinor: z.number().int().min(0),
});

export const adminWithdrawalListSchema = z.object({
  items: z.array(adminWithdrawalItemSchema),
  nextCursor: z.string().nullable(),
  totals: z.object({
    waiting: z.array(totalSchema),
    approvedNotPaid: z.array(totalSchema),
    paidThisMonth: z.array(totalSchema),
  }),
});

export const adminWithdrawalDetailSchema = z.object({
  id: z.uuid(),
  status: z.enum(WITHDRAWAL_STATUSES),
  points: z.number().int().min(1),
  amountMinor: z.number().int().min(0),
  feeMinor: z.number().int().min(0),
  currency,
  rateMinorPerPoint: z.number().int().min(1),
  flags: z.array(z.string()),
  user: z.object({
    maskedUser: z.string(),
    accountAgeDays: z.number().int().min(0),
    lifetimeEarned: points,
    cash: points,
    openDebt: points,
    phoneVerified: z.boolean(),
  }),
  destination: z.object({
    id: z.uuid(),
    methodKey: z.string(),
    methodNameAr: z.string(),
    masked: z.string(),
    usableAfter: isoDate,
  }),
  approvedBy: z.uuid().nullable(),
  approvedAt: isoDate.nullable(),
  secondApprovedBy: z.uuid().nullable(),
  secondApprovedAt: isoDate.nullable(),
  /** The threshold above which a second, different admin must approve. */
  fourEyesThresholdPoints: points,
  requiresSecondApproval: z.boolean(),
  awaitingSecondApproval: z.boolean(),
  paidBy: z.uuid().nullable(),
  paidAt: isoDate.nullable(),
  transferReference: z.string().nullable(),
  proofFileId: z.uuid().nullable(),
  rejectReason: z.string().nullable(),
  createdAt: isoDate,
  /** The released `cash` rewards that funded the balance, newest first. */
  funding: z.array(
    z.object({
      at: isoDate,
      points: z.number().int(),
      event: z.string().nullable(),
      referralId: z.uuid().nullable(),
      orderId: z.uuid().nullable(),
      refereeInitials: z.string().nullable(),
    }),
  ),
  previous: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(WITHDRAWAL_STATUSES),
      points: z.number().int().min(1),
      amountMinor: z.number().int().min(0),
      currency,
      createdAt: isoDate,
    }),
  ),
  lockHolder: z.object({ id: z.uuid(), displayName: z.string().nullable() }).nullable(),
});
export type AdminWithdrawalDetail = z.output<typeof adminWithdrawalDetailSchema>;

/** `override: true` takes over a review someone else is looking at (the lock is advisory). */
export const approveWithdrawalSchema = z.object({
  override: z.boolean().default(false),
});

export const rejectWithdrawalSchema = z.object({
  reasonKey: z.enum(WITHDRAWAL_REJECT_REASONS),
  note: z.string().trim().max(500).optional(),
  override: z.boolean().default(false),
});

export const markWithdrawalPaidSchema = z.object({
  /** The bank or wallet transfer reference; unique across all requests. */
  transferReference: z.string().trim().min(3).max(100),
  proofFileId: z.uuid().optional(),
  override: z.boolean().default(false),
});

export const revealDestinationSchema = z.object({ override: z.boolean().default(false) });

/** The destination's plain value, shown once to the admin who is about to pay it. */
export const revealedDestinationSchema = z.object({
  methodKey: z.string(),
  values: z.record(z.string(), z.string()),
});

/** `week=2026-W42`: ISO week (Monday to Sunday, UTC). */
export const withdrawalExportQuerySchema = z.object({
  week: z.string().regex(/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/),
});

export const withdrawalStepResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(WITHDRAWAL_STATUSES),
  /** `first` = first of two approvals recorded; `approved` = done. */
  stage: z.enum(["first", "approved", "rejected", "paid"]),
  replayed: z.boolean(),
});
export type WithdrawalStepResult = z.output<typeof withdrawalStepResultSchema>;
