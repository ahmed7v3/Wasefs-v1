import { createHash } from "node:crypto";

import { LIVE_SUBSCRIPTION_STATUSES, type SubscriptionEventType } from "@wasfa/shared/billing";
import { billingSettingsSchema } from "@wasfa/shared/settings";
import {
  addDays,
  addMonthsClamped,
  anniversaries,
  monthKey,
  pendingChangeSchema,
  type PendingChange,
  type SubscriptionReminderSlot,
} from "@wasfa/shared/subscriptions";
import { and, asc, desc, eq, gt, inArray, isNotNull, like, ne, or, sql } from "drizzle-orm";

import {
  expireGrantInTransaction,
  moveCreditsInTransaction,
  type Transaction,
  type WalletOwner,
} from "./credits-ledger.js";
import { raiseAdminAlert, type PaymentHooks } from "./payments.js";
import { auditLogs } from "./schema/audit-logs.js";
import { orders, outbox, type Order } from "./schema/billing.js";
import { creditLedger } from "./schema/credits.js";
import { planAssignments, plans, type Plan } from "./schema/plans.js";
import { siteSettings } from "./schema/site-settings.js";
import { subscriptionEvents, subscriptions, type Subscription } from "./schema/subscriptions.js";
import { users } from "./schema/users.js";

import type { Database } from "./client.js";

/*
 * Subscriptions as prepaid periods (BILLING §7, Decision 1). Plain functions over a `Database` or a
 * transaction, like the payments state machine, so the API (activation, /me endpoints, refunds)
 * and the worker (lifecycle, grants, backfill) run the same code. `plan_assignments` stays the
 * effective-plan record (Decision 10): each subscription keeps exactly one open assignment whose
 * `ends_at` is always the moment access stops if nothing else happens, so a stopped worker can
 * never give access past the grace window.
 *
 * Lock order: order -> payment (the caller) -> subscription -> wallet.
 */

export type SubscriptionsErrorReason =
  | "not_found"
  | "no_live_subscription"
  | "trial_unavailable"
  | "trial_used"
  | "phone_required"
  | "paid_subscription_live"
  | "invalid_period";

export class SubscriptionsError extends Error {
  constructor(readonly reason: SubscriptionsErrorReason) {
    super(`Subscriptions error: ${reason}`);
    this.name = "SubscriptionsError";
  }
}

type Handle = Database | Transaction;
const LIVE: readonly string[] = LIVE_SUBSCRIPTION_STATUSES;

/** What the lifecycle tells the conversion engine; bound to a no-op until that engine exists. */
export interface SubscriptionLifecycleHooks {
  onExpiring(
    tx: Transaction,
    input: { subscription: Subscription; slot: SubscriptionReminderSlot; now: Date },
  ): Promise<void>;
  onExpired(tx: Transaction, input: { subscription: Subscription; now: Date }): Promise<void>;
}

export const NO_LIFECYCLE_HOOKS: SubscriptionLifecycleHooks = {
  onExpiring: () => Promise.resolve(),
  onExpired: () => Promise.resolve(),
};

// --- Small helpers ------------------------------------------------------------------------------

export function subscriptionOwner(row: {
  ownerUserId: string | null;
  ownerOrgId: string | null;
}): WalletOwner {
  if (row.ownerUserId) return { type: "user", id: row.ownerUserId };
  if (row.ownerOrgId) return { type: "org", id: row.ownerOrgId };
  throw new Error("Row without owner");
}

function ownerColumnsOf(owner: WalletOwner) {
  return owner.type === "user"
    ? { ownerUserId: owner.id, ownerOrgId: null }
    : { ownerUserId: null, ownerOrgId: owner.id };
}

function subscriptionOf(owner: WalletOwner) {
  return owner.type === "user"
    ? eq(subscriptions.ownerUserId, owner.id)
    : eq(subscriptions.ownerOrgId, owner.id);
}

/** Billing settings read inside the caller's transaction (the worker has no settings cache). */
async function graceDaysOf(tx: Handle): Promise<number> {
  return (await billingSettingsOf(tx)).graceDays;
}

export async function billingSettingsOf(tx: Handle) {
  const [row] = await tx.select().from(siteSettings).where(eq(siteSettings.key, "billing"));
  const parsed = billingSettingsSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : billingSettingsSchema.parse({});
}

async function planById(tx: Handle, planId: string): Promise<Plan> {
  const [plan] = await tx.select().from(plans).where(eq(plans.id, planId));
  if (!plan) throw new SubscriptionsError("not_found");
  return plan;
}

async function lockLive(tx: Transaction, owner: WalletOwner): Promise<Subscription | undefined> {
  const [row] = await tx
    .select()
    .from(subscriptions)
    .where(
      and(subscriptionOf(owner), inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES])),
    )
    .for("update");
  return row;
}

async function lockById(tx: Transaction, id: string): Promise<Subscription> {
  const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
  if (!row) throw new SubscriptionsError("not_found");
  return row;
}

async function writeEvent(
  tx: Transaction,
  subscriptionId: string,
  type: SubscriptionEventType,
  data: Record<string, unknown> = {},
  actorId: string | null = null,
): Promise<void> {
  await tx.insert(subscriptionEvents).values({ subscriptionId, type, data, actorId });
}

async function update(
  tx: Transaction,
  id: string,
  patch: Partial<typeof subscriptions.$inferInsert>,
): Promise<Subscription> {
  const [row] = await tx
    .update(subscriptions)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(subscriptions.id, id))
    .returning();
  if (!row) throw new SubscriptionsError("not_found");
  return row;
}

/** When access stops if nothing else happens (see the module comment). */
export function accessEndsAt(subscription: Subscription, graceDays: number): Date {
  if (subscription.status === "grace" && subscription.graceUntil) return subscription.graceUntil;
  if (subscription.source !== "paid" || subscription.cancelAtPeriodEnd) {
    return subscription.currentPeriodEnd;
  }
  return addDays(subscription.currentPeriodEnd, graceDays);
}

async function openAssignmentId(tx: Transaction, subscriptionId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: planAssignments.id })
    .from(planAssignments)
    .where(eq(planAssignments.subscriptionId, subscriptionId))
    .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id))
    .limit(1);
  return row?.id ?? null;
}

/** Points the subscription's open assignment at the subscription's current access end. */
async function syncAssignment(
  tx: Transaction,
  subscription: Subscription,
  graceDays: number,
  endsAt: Date = accessEndsAt(subscription, graceDays),
): Promise<void> {
  const id = await openAssignmentId(tx, subscription.id);
  if (!id) return;
  await tx.update(planAssignments).set({ endsAt }).where(eq(planAssignments.id, id));
}

/** Ends the open assignment at `at` and opens one for the subscription's (new) plan from `startsAt`. */
async function reassign(
  tx: Transaction,
  subscription: Subscription,
  graceDays: number,
  at: Date,
  reason: string,
  actorId: string | null = null,
): Promise<void> {
  const previous = await openAssignmentId(tx, subscription.id);
  if (previous) {
    await tx.update(planAssignments).set({ endsAt: at }).where(eq(planAssignments.id, previous));
  }
  await tx.insert(planAssignments).values({
    ...ownerColumnsOf(subscriptionOwner(subscription)),
    planId: subscription.planId,
    startsAt: subscription.currentPeriodStart,
    endsAt: accessEndsAt(subscription, graceDays),
    subscriptionId: subscription.id,
    assignedBy: actorId,
    reason,
  });
}

async function enqueueOutbox(
  tx: Transaction,
  topic: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  await tx
    .insert(outbox)
    .values({ topic, payload, idempotencyKey })
    .onConflictDoNothing({
      target: outbox.idempotencyKey,
      where: sql`${outbox.idempotencyKey} is not null`,
    });
}

// --- Credits ------------------------------------------------------------------------------------

/**
 * Ledger key of the plan grant due at `anniversary`. The period start is part of it: a renewal
 * from grace, an upgrade or an applied downgrade starts a new period whose first grant may fall in
 * a month that already had one from the previous period.
 */
function grantKey(subscription: Subscription, anniversary: Date): string {
  const owner = subscriptionOwner(subscription);
  return `grant:${owner.type}:${owner.id}:${monthKey(anniversary)}:${subscription.id}:p${String(
    subscription.currentPeriodStart.getTime(),
  )}`;
}

/** The newest plan or trial grant of this subscription (for expiring its unused part). */
async function lastGrantKey(tx: Transaction, subscriptionId: string): Promise<string | null> {
  const [row] = await tx
    .select({ key: creditLedger.idempotencyKey })
    .from(creditLedger)
    .where(
      or(
        like(creditLedger.idempotencyKey, `grant:%:${subscriptionId}:p%`),
        eq(creditLedger.idempotencyKey, `trial:${subscriptionId}`),
      ),
    )
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(1);
  return row?.key ?? null;
}

/** Unused plan credits do not carry over (BILLING §7.2). */
async function expireLastGrant(tx: Transaction, subscription: Subscription): Promise<void> {
  const key = await lastGrantKey(tx, subscription.id);
  if (key) await expireGrantInTransaction(tx, subscriptionOwner(subscription), key);
}

/**
 * Grants every anniversary of the current period that is due by `now` and not granted yet; before
 * each new grant the previous one's unused part expires. Idempotent: the ledger keys repeat.
 */
export async function grantDueCredits(
  tx: Transaction,
  subscription: Subscription,
  now: Date,
): Promise<number> {
  if (subscription.status !== "active" || subscription.source === "trial") return 0;
  const plan = await planById(tx, subscription.planId);
  if (plan.monthlyCredits <= 0) return 0;
  const owner = subscriptionOwner(subscription);
  let granted = 0;
  for (const at of anniversaries(subscription.currentPeriodStart, subscription.currentPeriodEnd)) {
    if (at.getTime() > now.getTime()) break;
    const key = grantKey(subscription, at);
    const [exists] = await tx
      .select({ id: creditLedger.id })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, key));
    if (exists) continue;
    await expireLastGrant(tx, subscription);
    const write = await moveCreditsInTransaction(tx, owner, {
      kind: "grant",
      amount: plan.monthlyCredits,
      idempotencyKey: key,
      reason: `subscription:${monthKey(at)}`,
    });
    if (write && !write.replayed) granted++;
  }
  return granted;
}

// --- Activation ---------------------------------------------------------------------------------

async function activatedForOrder(tx: Transaction, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: subscriptionEvents.id })
    .from(subscriptionEvents)
    .where(sql`${subscriptionEvents.data}->>'orderId' = ${orderId}`)
    .limit(1);
  return row !== undefined;
}

function monthsBought(order: Order): number {
  const extra = (order.quote as { grants?: { extraMonths?: number } }).grants?.extraMonths ?? 0;
  return (order.months ?? 0) + (Number.isInteger(extra) && extra > 0 ? extra : 0);
}

function priceSnapshot(order: Order, plan: Plan): Record<string, unknown> {
  return {
    planKey: plan.key,
    months: order.months,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    taxMinor: order.taxMinor,
    feeMinor: order.feeMinor,
    totalMinor: order.totalMinor,
  };
}

function prorationOf(order: Order): number {
  const lines = (order.quote as { lines?: Array<{ kind?: string; amountMinor?: number }> }).lines;
  const line = lines?.find((entry) => entry.kind === "proration");
  return typeof line?.amountMinor === "number" ? Math.abs(line.amountMinor) : 0;
}

/**
 * Turns a paid subscription or upgrade order into access (BILLING §5.3 step 4, §7.2). Runs inside
 * the activation transaction, after the order and payment locks. Idempotent per order.
 */
export async function activateSubscriptionForOrder(
  tx: Transaction,
  order: Order,
  now: Date,
): Promise<void> {
  if (order.kind === "credit_pack" || !order.planId || !order.months) return;
  if (await activatedForOrder(tx, order.id)) return;
  const owner = subscriptionOwner(order);
  const graceDays = await graceDaysOf(tx);
  const plan = await planById(tx, order.planId);
  const months = monthsBought(order);
  const live = await lockLive(tx, owner);

  if (!live || live.source !== "paid") {
    if (live) {
      // A trial or a grant turning into a paid plan keeps what is left of its credits.
      const closed = await update(tx, live.id, { status: "canceled", canceledAt: now });
      await syncAssignment(tx, closed, graceDays, now);
      await writeEvent(tx, live.id, "canceled", { replacedByOrderId: order.id });
    }
    const [created] = await tx
      .insert(subscriptions)
      .values({
        ...ownerColumnsOf(owner),
        planId: plan.id,
        status: "active",
        source: "paid",
        currentPeriodStart: now,
        currentPeriodEnd: addMonthsClamped(now, months),
        monthsPaid: months,
        lastOrderId: order.id,
        priceSnapshot: priceSnapshot(order, plan),
      })
      .returning();
    if (!created) throw new Error("Subscription was not stored");
    await reassign(tx, created, graceDays, now, `order:${order.number}`);
    await writeEvent(tx, created.id, "created", { orderId: order.id, months, planId: plan.id });
    await grantDueCredits(tx, created, now);
    return;
  }

  if (live.planId === plan.id) {
    const restart = live.status === "grace" || live.currentPeriodEnd.getTime() <= now.getTime();
    const start = restart ? now : live.currentPeriodStart;
    const from = restart ? now : live.currentPeriodEnd;
    const extended = await update(tx, live.id, {
      status: "active",
      graceUntil: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      currentPeriodStart: start,
      currentPeriodEnd: addMonthsClamped(from, months),
      monthsPaid: live.monthsPaid + months,
      lastOrderId: order.id,
      priceSnapshot: priceSnapshot(order, plan),
    });
    if (restart) {
      await expireLastGrant(tx, extended);
      await reassign(tx, extended, graceDays, now, `order:${order.number}`);
    } else {
      await syncAssignment(tx, extended, graceDays);
    }
    await writeEvent(tx, live.id, "renewed", {
      orderId: order.id,
      months,
      from: from.toISOString(),
      to: extended.currentPeriodEnd.toISOString(),
    });
    await grantDueCredits(tx, extended, now);
    return;
  }

  const current = await planById(tx, live.planId);
  const higher = order.kind === "upgrade" || plan.monthlyCredits > current.monthlyCredits;
  // A lower plan bought after the period ended (grace) cannot wait for a period end that passed.
  if (higher || live.status === "grace") {
    await expireLastGrant(tx, live);
    const switched = await update(tx, live.id, {
      planId: plan.id,
      status: "active",
      graceUntil: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      pendingChange: null,
      currentPeriodStart: now,
      currentPeriodEnd: addMonthsClamped(now, months),
      monthsPaid: live.monthsPaid + months,
      lastOrderId: order.id,
      priceSnapshot: priceSnapshot(order, plan),
    });
    await reassign(tx, switched, graceDays, now, `order:${order.number}`);
    await writeEvent(tx, live.id, higher ? "upgraded" : "renewed", {
      orderId: order.id,
      months,
      fromPlanId: current.id,
      toPlanId: plan.id,
      prorationMinor: prorationOf(order),
    });
    await grantDueCredits(tx, switched, now);
    return;
  }

  const pending = live.pendingChange ? pendingChangeSchema.safeParse(live.pendingChange) : null;
  if (pending?.success && pending.data.planId !== plan.id) {
    // Two different downgrades: keep the first, an admin refunds or re-targets the second.
    await writeEvent(tx, live.id, "downgraded_scheduled", {
      orderId: order.id,
      conflict: true,
      keptOrderId: pending.data.orderId,
    });
    await raiseAdminAlert(tx, {
      kind: "payment.review_needed",
      severity: "warning",
      refType: "order",
      refId: order.id,
      summary: `Order ${order.number} bought a second, different downgrade; the first one is kept. Refund or re-target it.`,
      link: `/admin/billing/orders/${order.id}`,
    });
    return;
  }
  const change: PendingChange = {
    planId: plan.id,
    months: pending?.success ? pending.data.months + months : months,
    orderId: pending?.success ? pending.data.orderId : order.id,
    effectiveAt: live.currentPeriodEnd.toISOString(),
  };
  const scheduled = await update(tx, live.id, {
    pendingChange: change,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  });
  await syncAssignment(tx, scheduled, graceDays);
  await writeEvent(tx, live.id, "downgraded_scheduled", {
    orderId: order.id,
    planId: plan.id,
    months,
    effectiveAt: change.effectiveAt,
  });
}

// --- Refunds ------------------------------------------------------------------------------------

/**
 * A full refund takes back the months the order bought (BILLING §7.4); a partial refund changes no
 * access. Credits are clawed back by the refund itself (the admin's number), not here.
 */
export async function applyRefundToSubscription(
  tx: Transaction,
  input: { order: Order; full: boolean; refundId: string; now: Date },
): Promise<void> {
  const { order, full, refundId, now } = input;
  if (order.kind === "credit_pack") return;
  const [event] = await tx
    .select({ subscriptionId: subscriptionEvents.subscriptionId, data: subscriptionEvents.data })
    .from(subscriptionEvents)
    .where(sql`${subscriptionEvents.data}->>'orderId' = ${order.id}`)
    .orderBy(asc(subscriptionEvents.createdAt))
    .limit(1);
  if (!event) return;
  const subscription = await lockById(tx, event.subscriptionId);
  await writeEvent(tx, subscription.id, "refund_applied", { refundId, orderId: order.id, full });
  // A conflicting downgrade order never changed access, so its refund changes nothing either.
  if (!full || event.data.conflict === true || !LIVE.includes(subscription.status)) return;
  const graceDays = await graceDaysOf(tx);

  const pending = subscription.pendingChange
    ? pendingChangeSchema.safeParse(subscription.pendingChange)
    : null;
  if (pending?.success && pending.data.orderId === order.id) {
    const cleared = await update(tx, subscription.id, { pendingChange: null });
    await syncAssignment(tx, cleared, graceDays);
    return;
  }

  const months = monthsBought(order);
  const shortened = addMonthsClamped(subscription.currentPeriodEnd, -months);
  if (
    shortened.getTime() <= now.getTime() ||
    shortened.getTime() <= subscription.currentPeriodStart.getTime()
  ) {
    await endNow(tx, subscription, now, graceDays, { refundId });
    return;
  }
  const kept = await update(tx, subscription.id, {
    currentPeriodEnd: shortened,
    monthsPaid: Math.max(0, subscription.monthsPaid - months),
  });
  await syncAssignment(tx, kept, graceDays);
}

async function endNow(
  tx: Transaction,
  subscription: Subscription,
  now: Date,
  graceDays: number,
  data: Record<string, unknown>,
  actorId: string | null = null,
): Promise<Subscription> {
  // Both CHECKs need an end after the start, also when the period started this very moment.
  const end = new Date(Math.max(now.getTime(), subscription.currentPeriodStart.getTime() + 1));
  const ended = await update(tx, subscription.id, {
    status: "expired",
    graceUntil: null,
    pendingChange: null,
    currentPeriodEnd:
      subscription.currentPeriodEnd.getTime() > end.getTime() ? end : subscription.currentPeriodEnd,
  });
  await syncAssignment(tx, ended, graceDays, end);
  await expireLastGrant(tx, ended);
  await writeEvent(tx, subscription.id, "expired", data, actorId);
  return ended;
}

/** The hooks payments call (bound in the API's `PAYMENT_HOOKS` and the worker's payments runtime). */
export const SUBSCRIPTION_HOOKS: PaymentHooks = {
  activateSubscription: (tx, { order, now }) => activateSubscriptionForOrder(tx, order, now),
  onRefund: async (tx, { order, payment, refund, now }) =>
    applyRefundToSubscription(tx, {
      order,
      full: payment.status === "refunded",
      refundId: refund.id,
      now,
    }),
};

// --- Customer actions ---------------------------------------------------------------------------

export async function cancelAtPeriodEnd(
  db: Database,
  owner: WalletOwner,
  now: Date,
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const live = await lockLive(tx, owner);
    if (!live) throw new SubscriptionsError("no_live_subscription");
    if (live.cancelAtPeriodEnd) return live;
    const canceled = await update(tx, live.id, { cancelAtPeriodEnd: true, canceledAt: now });
    await syncAssignment(tx, canceled, await graceDaysOf(tx));
    await writeEvent(tx, live.id, "canceled", { atPeriodEnd: true });
    return canceled;
  });
}

export async function resume(db: Database, owner: WalletOwner, now: Date): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const live = await lockLive(tx, owner);
    if (!live) throw new SubscriptionsError("no_live_subscription");
    if (!live.cancelAtPeriodEnd) return live;
    if (live.currentPeriodEnd.getTime() <= now.getTime()) {
      throw new SubscriptionsError("no_live_subscription");
    }
    const resumed = await update(tx, live.id, { cancelAtPeriodEnd: false, canceledAt: null });
    await syncAssignment(tx, resumed, await graceDaysOf(tx));
    await writeEvent(tx, live.id, "resumed", {});
    return resumed;
  });
}

/** A trial phone is remembered as a hash: the event log must not hold phone numbers. */
function phoneHash(phone: string): string {
  return createHash("sha256").update(`trial-phone:${phone}`).digest("hex");
}

/**
 * Starts the plan's trial (BILLING §7.2): once per owner and, when `trial.oncePerPhone`, once per
 * verified phone across all accounts. A transaction lock on the phone serialises two accounts
 * that share it.
 */
export async function startTrial(
  db: Database,
  input: { userId: string; planKey: string; now: Date },
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const settings = await billingSettingsOf(tx);
    const [plan] = await tx.select().from(plans).where(eq(plans.key, input.planKey));
    if (!plan || plan.visibility !== "public" || plan.isDefault || plan.trialDays <= 0) {
      throw new SubscriptionsError("trial_unavailable");
    }
    if (settings.trial.credits <= 0) throw new SubscriptionsError("trial_unavailable");
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (!user) throw new SubscriptionsError("not_found");
    const owner: WalletOwner = { type: "user", id: user.id };
    const hash = user.phone && user.phoneVerifiedAt ? phoneHash(user.phone) : null;
    if (settings.trial.oncePerPhone && !hash) throw new SubscriptionsError("phone_required");
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${hash ? `trial:${hash}` : `trial:user:${user.id}`}))`,
    );

    const [earlier] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.ownerUserId, user.id), eq(subscriptions.source, "trial")))
      .limit(1);
    if (earlier) throw new SubscriptionsError("trial_used");
    if (settings.trial.oncePerPhone && hash) {
      const [samePhone] = await tx
        .select({ id: subscriptionEvents.id })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.type, "created"),
            sql`${subscriptionEvents.data}->>'trialPhone' = ${hash}`,
          ),
        )
        .limit(1);
      if (samePhone) throw new SubscriptionsError("trial_used");
    }
    if (await lockLive(tx, owner)) throw new SubscriptionsError("trial_unavailable");

    const [created] = await tx
      .insert(subscriptions)
      .values({
        ...ownerColumnsOf(owner),
        planId: plan.id,
        status: "trialing",
        source: "trial",
        currentPeriodStart: input.now,
        currentPeriodEnd: addDays(input.now, plan.trialDays),
        monthsPaid: 0,
        createdBy: user.id,
      })
      .returning();
    if (!created) throw new Error("Trial was not stored");
    await reassign(tx, created, settings.graceDays, input.now, "trial");
    await writeEvent(tx, created.id, "created", {
      trial: true,
      planId: plan.id,
      ...(hash ? { trialPhone: hash } : {}),
    });
    await moveCreditsInTransaction(tx, owner, {
      kind: "trial_grant",
      amount: settings.trial.credits,
      idempotencyKey: `trial:${created.id}`,
      reason: `trial:${plan.key}`,
    });
    return created;
  });
}

/** Whether `startTrial` could succeed for this user and plan (no side effects, no phone leak). */
export async function trialAvailable(db: Database, userId: string): Promise<boolean> {
  const settings = await billingSettingsOf(db);
  if (settings.trial.credits <= 0) return false;
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return false;
  const [trialPlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.visibility, "public"), gt(plans.trialDays, 0), eq(plans.isDefault, false)))
    .limit(1);
  if (!trialPlan) return false;
  const [earlier] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.ownerUserId, userId),
        or(
          eq(subscriptions.source, "trial"),
          inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ),
      ),
    )
    .limit(1);
  if (earlier) return false;
  if (!settings.trial.oncePerPhone) return true;
  if (!user.phone || !user.phoneVerifiedAt) return false;
  const [samePhone] = await db
    .select({ id: subscriptionEvents.id })
    .from(subscriptionEvents)
    .where(
      and(
        eq(subscriptionEvents.type, "created"),
        sql`${subscriptionEvents.data}->>'trialPhone' = ${phoneHash(user.phone)}`,
      ),
    )
    .limit(1);
  return samePhone === undefined;
}

// --- Admin operations (routes arrive with the user 360 page) -------------------------------------

type Length = { months: number } | { days: number };

function extend(from: Date, length: Length): Date {
  if ("months" in length) return addMonthsClamped(from, length.months);
  return addDays(from, length.days);
}

function validLength(length: Length): void {
  const value = "months" in length ? length.months : length.days;
  if (!Number.isInteger(value) || value < 1 || value > ("months" in length ? 120 : 3_650)) {
    throw new SubscriptionsError("invalid_period");
  }
}

async function audit(
  tx: Transaction,
  action: string,
  subscriptionId: string,
  actorId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorId,
    action,
    targetType: "subscription",
    targetId: subscriptionId,
    after,
  });
}

/** Gives an owner a plan for a while without payment. Refuses over a paid subscription. */
export async function adminGrant(
  db: Database,
  input: {
    owner: WalletOwner;
    planId: string;
    length: Length;
    reason: string;
    actorId: string;
    now: Date;
  },
): Promise<Subscription> {
  validLength(input.length);
  return db.transaction(async (tx) => {
    const graceDays = await graceDaysOf(tx);
    const plan = await planById(tx, input.planId);
    const live = await lockLive(tx, input.owner);
    if (live?.source === "paid") throw new SubscriptionsError("paid_subscription_live");
    if (live) {
      const closed = await update(tx, live.id, { status: "canceled", canceledAt: input.now });
      await expireLastGrant(tx, closed);
      await syncAssignment(tx, closed, graceDays, input.now);
      await writeEvent(tx, live.id, "admin_changed", { replacedByGrant: true }, input.actorId);
    }
    const [created] = await tx
      .insert(subscriptions)
      .values({
        ...ownerColumnsOf(input.owner),
        planId: plan.id,
        status: "active",
        source: "admin_grant",
        currentPeriodStart: input.now,
        currentPeriodEnd: extend(input.now, input.length),
        createdBy: input.actorId,
      })
      .returning();
    if (!created) throw new Error("Grant was not stored");
    await reassign(tx, created, graceDays, input.now, `admin_grant`, input.actorId);
    await writeEvent(
      tx,
      created.id,
      "admin_changed",
      { action: "grant", planId: plan.id, ...input.length, reason: input.reason },
      input.actorId,
    );
    await audit(tx, "subscription.granted", created.id, input.actorId, {
      planKey: plan.key,
      ...input.length,
      reason: input.reason,
    });
    await grantDueCredits(tx, created, input.now);
    return created;
  });
}

export async function adminExtend(
  db: Database,
  input: { subscriptionId: string; length: Length; reason: string; actorId: string; now: Date },
): Promise<Subscription> {
  validLength(input.length);
  return db.transaction(async (tx) => {
    const subscription = await lockById(tx, input.subscriptionId);
    if (!LIVE.includes(subscription.status)) throw new SubscriptionsError("no_live_subscription");
    const graceDays = await graceDaysOf(tx);
    const inGrace = subscription.status === "grace";
    const extended = await update(tx, subscription.id, {
      status: subscription.status === "trialing" ? "trialing" : "active",
      graceUntil: null,
      currentPeriodEnd: extend(inGrace ? input.now : subscription.currentPeriodEnd, input.length),
    });
    await syncAssignment(tx, extended, graceDays);
    await writeEvent(
      tx,
      subscription.id,
      "admin_changed",
      { action: "extend", ...input.length, reason: input.reason },
      input.actorId,
    );
    await audit(tx, "subscription.extended", subscription.id, input.actorId, {
      ...input.length,
      reason: input.reason,
      to: extended.currentPeriodEnd.toISOString(),
    });
    return extended;
  });
}

export async function adminEnd(
  db: Database,
  input: { subscriptionId: string; reason: string; actorId: string; now: Date },
): Promise<Subscription> {
  return db.transaction(async (tx) => {
    const subscription = await lockById(tx, input.subscriptionId);
    if (!LIVE.includes(subscription.status)) throw new SubscriptionsError("no_live_subscription");
    const ended = await endNow(
      tx,
      subscription,
      input.now,
      await graceDaysOf(tx),
      { action: "end", reason: input.reason },
      input.actorId,
    );
    await writeEvent(
      tx,
      subscription.id,
      "admin_changed",
      { action: "end", reason: input.reason },
      input.actorId,
    );
    await audit(tx, "subscription.ended", subscription.id, input.actorId, { reason: input.reason });
    return ended;
  });
}

// --- Lifecycle (worker) -------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function reminderSlot(subscription: Subscription, now: Date): SubscriptionReminderSlot | null {
  if (subscription.status === "grace") {
    const day = Math.floor((now.getTime() - subscription.currentPeriodEnd.getTime()) / DAY_MS) + 1;
    return day >= 1 && day <= 3 ? (`g${String(day)}` as SubscriptionReminderSlot) : null;
  }
  if (subscription.cancelAtPeriodEnd) return null;
  const left = subscription.currentPeriodEnd.getTime() - now.getTime();
  if (left <= 0) return null;
  const days = subscription.source === "trial" ? [1] : [1, 3, 7];
  const due = days.find((d) => left <= d * DAY_MS);
  return due === undefined ? null : (`d${String(due)}` as SubscriptionReminderSlot);
}

async function remind(
  tx: Transaction,
  subscription: Subscription,
  slot: SubscriptionReminderSlot,
  now: Date,
  hooks: SubscriptionLifecycleHooks,
): Promise<void> {
  await enqueueOutbox(
    tx,
    "subscriptions.reminder",
    { subscriptionId: subscription.id, slot },
    `sub_reminder:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}:${slot}`,
  );
  if (slot !== "expired") await hooks.onExpiring(tx, { subscription, slot, now });
}

async function expire(
  tx: Transaction,
  subscription: Subscription,
  now: Date,
  graceDays: number,
  hooks: SubscriptionLifecycleHooks,
): Promise<void> {
  const accessEnd = subscription.graceUntil ?? subscription.currentPeriodEnd;
  const expired = await update(tx, subscription.id, { status: "expired" });
  await syncAssignment(tx, expired, graceDays, accessEnd);
  await expireLastGrant(tx, expired);
  await writeEvent(tx, subscription.id, "expired", {});
  await remind(tx, expired, "expired", now, hooks);
  await hooks.onExpired(tx, { subscription: expired, now });
}

/**
 * Moves one subscription forward to `now`: period end (scheduled downgrade, cancel, trial end,
 * grace), grace end, due credit grants and reminders. Each step is idempotent.
 */
export async function advanceSubscription(
  db: Database,
  subscriptionId: string,
  now: Date,
  hooks: SubscriptionLifecycleHooks = NO_LIFECYCLE_HOOKS,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, subscriptionId),
          inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        ),
      )
      .for("update", { skipLocked: true });
    if (!row) return;
    const graceDays = await graceDaysOf(tx);
    let subscription = row;

    if (
      subscription.status !== "grace" &&
      subscription.currentPeriodEnd.getTime() <= now.getTime()
    ) {
      const pending = subscription.pendingChange
        ? pendingChangeSchema.safeParse(subscription.pendingChange)
        : null;
      if (pending?.success && subscription.source === "paid") {
        await expireLastGrant(tx, subscription);
        const start = subscription.currentPeriodEnd;
        subscription = await update(tx, subscription.id, {
          planId: pending.data.planId,
          pendingChange: null,
          currentPeriodStart: start,
          currentPeriodEnd: addMonthsClamped(start, pending.data.months),
          monthsPaid: subscription.monthsPaid + pending.data.months,
          lastOrderId: pending.data.orderId,
        });
        await reassign(tx, subscription, graceDays, start, "downgrade");
        await writeEvent(tx, subscription.id, "renewed", {
          downgradeApplied: true,
          orderId: pending.data.orderId,
          planId: pending.data.planId,
        });
      } else if (subscription.cancelAtPeriodEnd) {
        subscription = await update(tx, subscription.id, { status: "canceled" });
        await syncAssignment(tx, subscription, graceDays, subscription.currentPeriodEnd);
        await expireLastGrant(tx, subscription);
        await writeEvent(tx, subscription.id, "canceled", { ended: true });
        await hooks.onExpired(tx, { subscription, now });
        return;
      } else if (subscription.source === "paid" && graceDays > 0) {
        subscription = await update(tx, subscription.id, {
          status: "grace",
          graceUntil: addDays(subscription.currentPeriodEnd, graceDays),
        });
        await syncAssignment(tx, subscription, graceDays);
        await writeEvent(tx, subscription.id, "grace_started", {
          graceUntil: subscription.graceUntil?.toISOString(),
        });
      } else {
        await expire(tx, subscription, now, graceDays, hooks);
        return;
      }
    }

    if (
      subscription.status === "grace" &&
      subscription.graceUntil &&
      subscription.graceUntil.getTime() <= now.getTime()
    ) {
      await expire(tx, subscription, now, graceDays, hooks);
      return;
    }

    await grantDueCredits(tx, subscription, now);
    const slot = reminderSlot(subscription, now);
    if (slot) await remind(tx, subscription, slot, now, hooks);
  });
}

/** Live subscriptions by id after `afterId` (the lifecycle job walks them in batches). */
export async function liveSubscriptionIds(
  db: Database,
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, [...LIVE_SUBSCRIPTION_STATUSES]),
        afterId ? gt(subscriptions.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(subscriptions.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

/**
 * Activates paid subscription orders that have no subscription yet (paid before this code
 * existed, or while the hook was a no-op), at their `paid_at`, oldest first. Idempotent.
 */
export async function backfillPaidSubscriptionOrders(db: Database): Promise<number> {
  const due = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["paid", "partially_refunded"]),
        ne(orders.kind, "credit_pack"),
        isNotNull(orders.paidAt),
        sql`not exists (
          select 1 from ${subscriptionEvents}
          where ${subscriptionEvents.data}->>'orderId' = ${orders.id}::text
        )`,
      ),
    )
    .orderBy(asc(orders.paidAt), asc(orders.id));
  let activated = 0;
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (!order?.paidAt || (await activatedForOrder(tx, order.id))) return;
      await activateSubscriptionForOrder(tx, order, order.paidAt);
      activated++;
    });
  }
  return activated;
}
