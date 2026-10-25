import { z } from "zod";

/*
 * Response shapes of `/admin/users/:id/*` (Task 3.15) as the user 360 page reads them. Only the
 * fields the page renders are typed; anything else the API adds is ignored, so a new column there
 * never breaks this page.
 */

const iso = z.string();
const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const userSummarySchema = z.object({
  profile: z.object({
    id: z.uuid(),
    name: z.string(),
    status: z.string(),
    locale: z.string(),
    image: z.string().nullable(),
    providers: z.array(z.string()),
  }),
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  chips: z.object({
    emailVerified: z.boolean(),
    phoneVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    suspended: z.boolean(),
  }),
  plan: z.object({
    key: z.string(),
    nameAr: z.string(),
    nameEn: z.string(),
    subscriptionId: z.string().nullable(),
    status: z.string().nullable(),
    source: z.string().nullable(),
    expiresAt: iso.nullable(),
    cancelAtPeriodEnd: z.boolean(),
  }),
  wallets: z.object({
    personal: z.object({ walletId: z.string().nullable(), balance: z.number() }),
    orgs: z.array(z.object({ orgId: z.string(), name: z.string(), balance: z.number() })),
  }),
  memberships: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
  memberSince: iso,
  lastSeenAt: iso.nullable(),
  lifetimeRevenue: z.record(z.string(), z.number()),
  lifetimeAiCostUsdMicros: z.number(),
  referralSource: z
    .object({
      code: z.string().nullable(),
      source: z.string().nullable(),
      status: z.string().nullable(),
      referrerInitials: z.string().nullable(),
    })
    .nullable(),
});
export type UserSummary = z.output<typeof userSummarySchema>;

export const revealedContactSchema = z.object({ value: z.string().nullable() });

export const timelineItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  kind: z.string(),
  occurredAt: iso,
  summaryKey: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export const timelinePageSchema = page(timelineItemSchema);
export type TimelineItem = z.output<typeof timelineItemSchema>;

export const userBillingSchema = z.object({
  current: z
    .object({ id: z.string(), status: z.string(), planKey: z.string().optional() })
    .loose()
    .nullable(),
  subscriptions: z.array(
    z
      .object({
        id: z.string(),
        status: z.string(),
        source: z.string(),
        currentPeriodStart: iso,
        currentPeriodEnd: iso,
      })
      .loose(),
  ),
  history: z.array(z.object({ id: z.string(), type: z.string(), createdAt: iso }).loose()),
  orders: page(
    z
      .object({
        id: z.string(),
        number: z.string(),
        status: z.string(),
        totalMinor: z.number(),
        currency: z.string(),
        createdAt: iso,
        paidAt: iso.nullable(),
      })
      .loose(),
  ),
  coupons: z.array(z.object({ code: z.string().optional() }).loose()),
  deal: z
    .object({
      dealId: z.string(),
      name: z.string(),
      planKey: z.string(),
      reason: z.object({ key: z.string(), params: z.record(z.string(), z.unknown()) }).nullable(),
    })
    .nullable(),
});
export type UserBilling = z.output<typeof userBillingSchema>;

export const userCreditsSchema = z.object({
  wallets: userSummarySchema.shape.wallets,
  ledger: page(
    z.object({
      id: z.string(),
      kind: z.string(),
      amount: z.number(),
      balanceAfter: z.number(),
      reason: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  usage: z.object({
    days: z.number(),
    items: z.array(
      z.object({ task: z.string(), day: z.string(), calls: z.number(), credits: z.number() }),
    ),
  }),
});

export const userReferralsSchema = z.object({
  code: z.object({ code: z.string() }).loose().nullable(),
  invitedBy: z
    .object({
      referralId: z.string(),
      code: z.string().nullable(),
      status: z.string(),
      referrerInitials: z.string().nullable(),
    })
    .nullable(),
  invitees: z.array(
    z.object({
      referralId: z.string(),
      initials: z.string(),
      status: z.string(),
      fraudScore: z.number(),
      flags: z.array(z.string()).nullable(),
      pendingPoints: z.number(),
      settledPoints: z.number(),
      createdAt: iso,
    }),
  ),
  wallet: z.object({
    pending: z.number(),
    cash: z.number(),
    creditOnly: z.number(),
    lifetimeEarned: z.number(),
  }),
  ledger: page(
    z
      .object({
        id: z.string(),
        kind: z.string(),
        bucket: z.string(),
        amount: z.number(),
        createdAt: iso,
      })
      .loose(),
  ),
});

export const phiSessionSchema = z.object({ id: z.string(), reason: z.string(), expiresAt: iso });
export const activePhiSessionSchema = z.object({ session: phiSessionSchema.nullable() });

export const prescriptionsPageSchema = page(
  z.object({
    id: z.string(),
    createdAt: iso,
    status: z.string(),
    mode: z.string(),
    pageCount: z.number(),
    itemCount: z.number().nullable(),
    lowConfidence: z.number().nullable(),
    mediumConfidence: z.number().nullable(),
    credits: z.number(),
    costUsdMicros: z.number(),
    skillVersion: z.string(),
    finishedAt: iso.nullable(),
  }),
);

export const chatsPageSchema = page(
  z.object({
    id: z.string(),
    createdAt: iso,
    updatedAt: iso,
    messageCount: z.number(),
    archived: z.boolean(),
  }),
);

export const notesPageSchema = page(
  z.object({
    id: z.string(),
    body: z.string(),
    pinned: z.boolean(),
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    createdAt: iso,
  }),
);

export const planChangePreviewSchema = z.object({
  plan: z.object({ key: z.string(), nameAr: z.string(), monthlyCredits: z.number() }),
  entitlements: z.array(
    z.object({ task: z.string(), allowed: z.boolean(), modes: z.array(z.string()) }).loose(),
  ),
  effect: z.enum(["replace", "extend", "schedule"]),
  blocked: z.string().nullable(),
  current: z
    .object({ planKey: z.string(), status: z.string(), source: z.string(), currentPeriodEnd: iso })
    .nullable(),
  effectiveAt: iso,
  newExpiry: iso,
  credits: z.object({ plan: z.number(), extra: z.number(), total: z.number() }),
  freshAuthRequired: z.boolean(),
});
export type PlanChangePreview = z.output<typeof planChangePreviewSchema>;
