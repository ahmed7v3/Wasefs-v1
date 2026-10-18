import { AI_MODES, AI_TASKS } from "@wasfa/shared/ai";
import { count } from "drizzle-orm";

import {
  creditPackPrices,
  creditPacks,
  paymentMethods,
  planEntitlements,
  planPrices,
  plans,
  payoutMethods,
  referralPrograms,
  rewardRules,
  taxRules,
  type NewPlanEntitlement,
  type NewRewardRule,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { PlanAudience, PlanVisibility } from "@wasfa/shared/plans";

/*
 * Seed data of billing and rewards (Phase 3, Task 3.1). Same policy as the rest of the seed:
 * insert-only and idempotent, existing rows are never touched, and children (prices, entitlements,
 * rules) are seeded only in the same transaction that creates their parent, so an admin who edits or
 * removes one never sees it come back. Everything commercial starts switched off or hidden until the
 * owner decides: hidden plans, a disabled tax rule (the accountant has not answered), a disabled
 * card gateway (no keys yet) and `rewards.enabled = false` (the `rewards` setting default).
 */

interface PlanSeed {
  key: string;
  nameAr: string;
  nameEn: string;
  audience: PlanAudience;
  monthlyCredits: number;
  visibility: PlanVisibility;
  sort: number;
  maxMembers: number | null;
  webSearch: boolean;
  /** EGP minor units: one month, then twelve months (pay 10, get 12; BILLING §2.2). */
  prices: readonly { months: number; amountMinor: number }[];
}

// Hidden until the owner publishes the prices. `free` lives in seed-ai.ts.
export const BILLING_PLAN_SEEDS: readonly PlanSeed[] = [
  {
    key: "plus",
    nameAr: "بلس",
    nameEn: "Plus",
    audience: "individual",
    monthlyCredits: 150,
    visibility: "hidden",
    sort: 15,
    maxMembers: null,
    webSearch: false,
    prices: [
      { months: 1, amountMinor: 9_900 },
      { months: 12, amountMinor: 99_000 },
    ],
  },
  {
    key: "pro",
    nameAr: "الاحترافية",
    nameEn: "Pro",
    audience: "any",
    monthlyCredits: 500,
    visibility: "hidden",
    sort: 20,
    maxMembers: null,
    webSearch: true,
    prices: [
      { months: 1, amountMinor: 29_900 },
      { months: 12, amountMinor: 299_000 },
    ],
  },
  {
    key: "clinic",
    nameAr: "العيادات والصيدليات",
    nameEn: "Clinic / Pharmacy",
    audience: "organization",
    monthlyCredits: 2_000,
    visibility: "hidden",
    sort: 30,
    maxMembers: 5,
    webSearch: true,
    prices: [
      { months: 1, amountMinor: 99_900 },
      { months: 12, amountMinor: 999_000 },
    ],
  },
];

function entitlementsFor(plan: PlanSeed): Omit<NewPlanEntitlement, "planId">[] {
  return AI_TASKS.map((task) => ({
    task,
    // Web search is its own task: only plans that include it may run it.
    allowed: task !== "web_search" || plan.webSearch,
    modes: [...AI_MODES],
    maxPagesPerRx: 4,
    webSearch: plan.webSearch,
  }));
}

interface CreditPackSeed {
  key: string;
  nameAr: string;
  nameEn: string;
  credits: number;
  bonusCredits: number;
  /** EGP minor units. */
  amountMinor: number;
  sort: number;
}

export const CREDIT_PACK_SEEDS: readonly CreditPackSeed[] = [
  {
    key: "pack_100",
    nameAr: "100 رصيد",
    nameEn: "100 credits",
    credits: 100,
    bonusCredits: 0,
    amountMinor: 7_900,
    sort: 10,
  },
  {
    key: "pack_300",
    nameAr: "300 رصيد",
    nameEn: "300 credits",
    credits: 300,
    bonusCredits: 30,
    amountMinor: 19_900,
    sort: 20,
  },
  {
    key: "pack_1000",
    nameAr: "1000 رصيد",
    nameEn: "1,000 credits",
    credits: 1_000,
    bonusCredits: 150,
    amountMinor: 54_900,
    sort: 30,
  },
];

const TRANSFER_INSTRUCTIONS_AR =
  "حوّل مبلغ {amount} إلى الرقم {account}، واكتب {reference} في ملاحظة التحويل إن أمكن، ثم ارفع صورة التحويل.";
const TRANSFER_INSTRUCTIONS_EN =
  "Send {amount} to {account}, write {reference} in the transfer note if the app allows it, then upload a screenshot of the transfer.";

type NewPaymentMethodSeed = typeof paymentMethods.$inferInsert;

export const PAYMENT_METHOD_SEEDS: readonly NewPaymentMethodSeed[] = [
  {
    // Off until the Kashier keys are entered; the fee is set from the Kashier contract (0 until then).
    key: "kashier_card",
    kind: "gateway",
    provider: "kashier",
    nameAr: "بطاقة أو محفظة إلكترونية",
    nameEn: "Card or e-wallet",
    feeBps: 0,
    feeFixedMinor: 0,
    currencies: ["EGP"],
    countries: null,
    requiresProof: false,
    enabled: false,
    sort: 10,
  },
  {
    key: "instapay",
    kind: "manual",
    provider: "instapay",
    nameAr: "إنستاباي",
    nameEn: "InstaPay",
    instructionsAr: TRANSFER_INSTRUCTIONS_AR,
    instructionsEn: TRANSFER_INSTRUCTIONS_EN,
    accountDisplay: "01014677026",
    feeBps: 0,
    feeFixedMinor: 0,
    currencies: ["EGP"],
    countries: null,
    requiresProof: true,
    enabled: true,
    sort: 20,
  },
  {
    key: "vodafone_cash",
    kind: "manual",
    provider: "vodafone_cash",
    nameAr: "فودافون كاش",
    nameEn: "Vodafone Cash",
    instructionsAr: TRANSFER_INSTRUCTIONS_AR,
    instructionsEn: TRANSFER_INSTRUCTIONS_EN,
    accountDisplay: "01014677026",
    feeBps: 0,
    feeFixedMinor: 0,
    currencies: ["EGP"],
    countries: null,
    requiresProof: true,
    enabled: true,
    sort: 30,
  },
];

/** Reward rules of the `standard` program: REFERRALS-REWARDS §3.3 (the referee's 10% off is a coupon, not a rule). */
export const STANDARD_REWARD_RULE_SEEDS: readonly Omit<NewRewardRule, "programId">[] = [
  {
    event: "referee_verified",
    beneficiary: "referrer",
    rewardKind: "fixed_points",
    value: 50,
    redeemableAs: "credits_only",
    holdDays: 3,
  },
  {
    event: "referee_verified",
    beneficiary: "referee",
    rewardKind: "fixed_credits",
    value: 20,
    redeemableAs: "credits_only",
    holdDays: 0,
  },
  {
    event: "first_payment",
    beneficiary: "referrer",
    rewardKind: "percent_of_net_bps",
    value: 2_000,
    redeemableAs: "cash_or_credits",
    holdDays: 14,
  },
  {
    event: "renewal",
    beneficiary: "referrer",
    rewardKind: "percent_of_net_bps",
    value: 1_000,
    redeemableAs: "cash_or_credits",
    holdDays: 14,
    maxRenewals: 3,
  },
  {
    event: "credit_pack",
    beneficiary: "referrer",
    rewardKind: "percent_of_net_bps",
    value: 500,
    redeemableAs: "cash_or_credits",
    holdDays: 14,
  },
];

type NewPayoutMethodSeed = typeof payoutMethods.$inferInsert;

// Disabled until the owner has confirmed the legal treatment of payouts with an accountant.
export const PAYOUT_METHOD_SEEDS: readonly NewPayoutMethodSeed[] = [
  {
    key: "vodafone_cash",
    nameAr: "فودافون كاش",
    nameEn: "Vodafone Cash",
    fieldSchema: {
      fields: [
        { key: "number", labelKey: "rewards.payout.field.number", kind: "egypt_mobile", required: true },
      ],
    },
    enabled: false,
    noteAr: "خلال 48 ساعة عمل",
    noteEn: "Within 48 working hours",
    sort: 10,
  },
  {
    key: "instapay",
    nameAr: "إنستاباي",
    nameEn: "InstaPay",
    fieldSchema: {
      fields: [
        {
          key: "address",
          labelKey: "rewards.payout.field.address",
          kind: "instapay_address",
          required: true,
        },
      ],
    },
    enabled: false,
    noteAr: "خلال 48 ساعة عمل",
    noteEn: "Within 48 working hours",
    sort: 20,
  },
  {
    key: "bank",
    nameAr: "تحويل بنكي",
    nameEn: "Bank transfer",
    fieldSchema: {
      fields: [{ key: "iban", labelKey: "rewards.payout.field.iban", kind: "iban", required: true }],
    },
    enabled: false,
    noteAr: "خلال 3 أيام عمل",
    noteEn: "Within 3 working days",
    sort: 30,
  },
];

export interface BillingSeedResult {
  billingPlans: number;
  planPrices: number;
  creditPacks: number;
  creditPackPrices: number;
  taxRules: number;
  paymentMethods: number;
  referralPrograms: number;
  rewardRules: number;
  payoutMethods: number;
}

/**
 * Idempotent and insert-only (see the note at the top). Runs in one transaction, after
 * `seedAiProduct`, whose `free` plan it does not touch. Settings `billing`, `rewards` and `growth`
 * are seeded with the other site settings from the registry defaults.
 */
export async function seedBilling(db: Database): Promise<BillingSeedResult> {
  return db.transaction(async (tx) => {
    // No conflict target on purpose (see seedAiProduct): the key is unique, and so can be other indexes.
    const createdPlans = await tx
      .insert(plans)
      .values(
        BILLING_PLAN_SEEDS.map((plan) => ({
          key: plan.key,
          nameAr: plan.nameAr,
          nameEn: plan.nameEn,
          audience: plan.audience,
          isDefault: false,
          monthlyCredits: plan.monthlyCredits,
          visibility: plan.visibility,
          sort: plan.sort,
          maxMembers: plan.maxMembers,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: plans.id, key: plans.key });

    const planSeeds = createdPlans.flatMap((created) => {
      const seed = BILLING_PLAN_SEEDS.find((plan) => plan.key === created.key);
      return seed === undefined ? [] : [{ id: created.id, seed }];
    });
    const entitlements = planSeeds.flatMap(({ id, seed }) =>
      entitlementsFor(seed).map((row) => ({ ...row, planId: id })),
    );
    if (entitlements.length > 0) {
      await tx.insert(planEntitlements).values(entitlements);
    }
    const prices = planSeeds.flatMap(({ id, seed }) =>
      seed.prices.map((price) => ({ planId: id, currency: "EGP", ...price })),
    );
    if (prices.length > 0) {
      await tx.insert(planPrices).values(prices);
    }

    const createdPacks = await tx
      .insert(creditPacks)
      .values(
        CREDIT_PACK_SEEDS.map((pack) => ({
          key: pack.key,
          nameAr: pack.nameAr,
          nameEn: pack.nameEn,
          credits: pack.credits,
          bonusCredits: pack.bonusCredits,
          sort: pack.sort,
        })),
      )
      .onConflictDoNothing({ target: creditPacks.key })
      .returning({ id: creditPacks.id, key: creditPacks.key });
    const packPrices = createdPacks.flatMap((created) => {
      const seed = CREDIT_PACK_SEEDS.find((pack) => pack.key === created.key);
      return seed === undefined
        ? []
        : [{ packId: created.id, currency: "EGP", amountMinor: seed.amountMinor }];
    });
    if (packPrices.length > 0) {
      await tx.insert(creditPackPrices).values(packPrices);
    }

    // Tax rules have no natural key: seed the Egyptian rule only into an empty table. It stays
    // inactive until the accountant confirms the rate and whether these sales are taxable.
    const [taxCount] = await tx.select({ total: count() }).from(taxRules);
    let insertedTaxRules = 0;
    if ((taxCount?.total ?? 0) === 0) {
      await tx.insert(taxRules).values({
        country: "EG",
        nameAr: "ضريبة القيمة المضافة",
        nameEn: "VAT",
        rateBps: 1_400,
        mode: "inclusive",
        active: false,
      });
      insertedTaxRules = 1;
    }

    const createdMethods = await tx
      .insert(paymentMethods)
      .values([...PAYMENT_METHOD_SEEDS])
      .onConflictDoNothing({ target: paymentMethods.key })
      .returning({ id: paymentMethods.id });

    const createdPrograms = await tx
      .insert(referralPrograms)
      .values({
        key: "standard",
        kind: "standard",
        nameAr: "برنامج الدعوات",
        nameEn: "Referral program",
      })
      .onConflictDoNothing({ target: referralPrograms.key })
      .returning({ id: referralPrograms.id });
    const program = createdPrograms[0];
    const createdRules =
      program === undefined
        ? []
        : await tx
            .insert(rewardRules)
            .values(STANDARD_REWARD_RULE_SEEDS.map((rule) => ({ ...rule, programId: program.id })))
            .returning({ id: rewardRules.id });

    const createdPayouts = await tx
      .insert(payoutMethods)
      .values([...PAYOUT_METHOD_SEEDS])
      .onConflictDoNothing({ target: payoutMethods.key })
      .returning({ id: payoutMethods.id });

    return {
      billingPlans: createdPlans.length,
      planPrices: prices.length,
      creditPacks: createdPacks.length,
      creditPackPrices: packPrices.length,
      taxRules: insertedTaxRules,
      paymentMethods: createdMethods.length,
      referralPrograms: createdPrograms.length,
      rewardRules: createdRules.length,
      payoutMethods: createdPayouts.length,
    };
  });
}
