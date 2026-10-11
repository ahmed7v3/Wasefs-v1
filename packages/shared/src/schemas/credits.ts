import { z } from "zod";

import { CREDIT_LEDGER_KINDS } from "../ai.js";

import { cursorQuerySchema } from "./admin.js";

/*
 * Credits contract (Phase 2, Task 2.2). Credits are integers; there are no fractions anywhere.
 * A wallet belongs to one owner: a user or an organization.
 */

const isoDate = z.iso.datetime({ offset: true });

export const WALLET_OWNER_TYPES = ["user", "org"] as const;
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];

export const walletOwnerSchema = z.object({
  type: z.enum(WALLET_OWNER_TYPES),
  id: z.uuid(),
});
export type WalletOwner = z.output<typeof walletOwnerSchema>;

/** Why an admin changed something: shown in the audit trail and the ledger. */
export const creditReasonSchema = z.string().trim().min(3).max(500);

/** One adjustment moves at most this many credits, in either direction. */
export const CREDIT_ADJUST_MAX = 1_000_000;

export const adjustCreditsSchema = z.object({
  owner: walletOwnerSchema,
  delta: z
    .number()
    .int()
    .min(-CREDIT_ADJUST_MAX)
    .max(CREDIT_ADJUST_MAX)
    .refine((value) => value !== 0, "must not be zero"),
  reason: creditReasonSchema,
  /** Chosen by the admin page per submit, so a retried request cannot adjust twice. */
  idempotencyKey: z.uuid(),
});
export type AdjustCreditsInput = z.output<typeof adjustCreditsSchema>;

export const planSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
});
export type PlanSummary = z.output<typeof planSummarySchema>;

export const creditWalletSchema = z.object({
  owner: walletOwnerSchema,
  balance: z.number().int(),
  plan: planSummarySchema,
  updatedAt: isoDate,
});
export type CreditWallet = z.output<typeof creditWalletSchema>;

export const creditLedgerEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(CREDIT_LEDGER_KINDS),
  /** Signed: negative = credits spent or removed. */
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  reason: z.string().nullable(),
  actorId: z.uuid().nullable(),
  reservationId: z.uuid().nullable(),
  createdAt: isoDate,
});
export type CreditLedgerEntryView = z.output<typeof creditLedgerEntrySchema>;

export const creditLedgerPageSchema = z.object({
  items: z.array(creditLedgerEntrySchema),
  nextCursor: z.string().nullable(),
});

/** Admin list of wallets: the wallet plus who owns it (name and email, or the organization's name). */
export const adminCreditWalletSchema = creditWalletSchema.extend({
  id: z.uuid(),
  ownerName: z.string().nullable(),
  ownerEmail: z.string().nullable(),
});
export type AdminCreditWallet = z.output<typeof adminCreditWalletSchema>;

export const adminCreditWalletPageSchema = z.object({
  items: z.array(adminCreditWalletSchema),
  nextCursor: z.string().nullable(),
});

export const adminWalletListQuerySchema = cursorQuerySchema.extend({
  /** Owner name or email (users) or name (organizations), contains. */
  q: z.string().trim().min(1).max(100).optional(),
});

export const adminAdjustResponseSchema = z.object({
  wallet: creditWalletSchema,
  entry: creditLedgerEntrySchema,
});

/** `GET /me/credits`: the signed-in user's own wallet (organization wallets come later). */
export const meCreditsResponseSchema = z.object({
  wallet: z.object({ ownerType: z.literal("user"), balance: z.number().int() }),
  plan: planSummarySchema.omit({ id: true }),
  monthlyCredits: z.number().int(),
  /** First day of the next UTC month, when the monthly grant arrives. */
  nextGrantAt: isoDate,
});
export type MeCreditsResponse = z.output<typeof meCreditsResponseSchema>;
