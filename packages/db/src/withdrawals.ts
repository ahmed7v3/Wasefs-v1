import { t, type MessageKey } from "@wasfa/shared/i18n";
import { newId } from "@wasfa/shared/ids";
import { formatMoney } from "@wasfa/shared/money";
import { initialsOf, type WithdrawalStatus } from "@wasfa/shared/rewards";
import {
  MAX_PAYOUT_DESTINATIONS,
  type WithdrawalFlag,
  type WithdrawalRefusalReason,
} from "@wasfa/shared/withdrawals";
import { and, count, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";

import { enqueueOutbox } from "./outbox.js";
import { raiseAdminAlert } from "./payments.js";
import { isUniqueViolation } from "./pg-errors.js";
import { PointsLedgerError, lockPointsWallet, openDebtTotal, pointsMove } from "./points-ledger.js";
import { rewardsSettingsOf, type RewardsSettings } from "./rewards.js";
import {
  files,
  payoutDestinations,
  payoutMethods,
  pointsLedger,
  userNotifications,
  users,
  withdrawalRequests,
  type PayoutDestination,
  type PayoutMethod,
  type PointsWallet,
  type User,
  type WithdrawalRequest,
} from "./schema/index.js";

import type { Database } from "./client.js";
import type { Transaction } from "./credits-ledger.js";

/*
 * Withdrawals of cash points (REFERRALS-REWARDS §8.2, Task 3.12): plain functions over a transaction,
 * like the points ledger they sit on. Lock order: withdrawal request, then the points wallet (a
 * request being created has no row yet, so it takes the wallet first; nobody else can wait on a row
 * that does not exist, so the two orders cannot deadlock).
 *
 * Ledger model. The wallet has no "held" bucket, so the hold is a `cash` debit referenced to the
 * request: `withdraw_hold` (cash -x) at request time, `withdraw_release` (cash +x) on reject or
 * cancel. A paid request writes NO ledger row: the points already left the balance at the hold, and a
 * zero-amount row is forbidden. "Paid" is the request's status plus its audit, and the reconciliation
 * proves the books: every request's net ledger rows are -points while it is open or paid, and 0
 * once rejected or canceled. So `bucket = SUM(ledger)` stays true at every step.
 *
 * Four eyes. `WITHDRAWAL_STATUSES` has no "awaiting second approval", so the first approval of a
 * request at or above `fourEyesThresholdPoints` is recorded in `approved_by/approved_at` while the
 * status stays `requested`; a DIFFERENT admin's approval then fills `second_approved_*` and moves it
 * to `approved`. Below the threshold one approval moves it straight to `approved`.
 */

type Handle = Database | Transaction;

export type WithdrawalErrorReason =
  | WithdrawalRefusalReason
  | "not_found"
  | "illegal_state"
  | "own_request"
  | "same_reviewer"
  | "reference_in_use"
  | "reference_mismatch"
  | "invalid_proof"
  | "destination_in_use"
  | "destination_limit"
  | "invalid_destination";

/** An expected refusal; the API turns it into an `AppError`. */
export class WithdrawalError extends Error {
  constructor(readonly reason: WithdrawalErrorReason) {
    super(`Withdrawal refused: ${reason}`);
    this.name = "WithdrawalError";
  }
}

const OPEN_STATUSES = ["requested", "approved"] as const satisfies readonly WithdrawalStatus[];
/** Statuses that count toward the monthly cap: the points left, or are about to leave, the balance. */
const COUNTED_STATUSES = ["requested", "approved", "paid"] as const satisfies readonly WithdrawalStatus[];

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** `م. أ. #1a2b3c4d`: initials and a short id; never a name, email or phone. */
export function maskedUserLabel(name: string, userId: string): string {
  const initials = initialsOf(name);
  return `${initials === "" ? "-" : initials} #${userId.slice(-8)}`;
}

// --- Facts and refusals -------------------------------------------------------------------------------

export interface WithdrawalFacts {
  settings: RewardsSettings;
  user: User;
  wallet: PointsWallet;
  debt: number;
  openRequest: WithdrawalRequest | null;
  /** Points requested this UTC month in requests that left, or will leave, the balance. */
  monthUsed: number;
  paidBefore: number;
}

async function loadFacts(
  tx: Transaction,
  userId: string,
  wallet: PointsWallet,
  now: Date,
): Promise<WithdrawalFacts> {
  const [settings, [user], debt] = await Promise.all([
    rewardsSettingsOf(tx),
    tx.select().from(users).where(eq(users.id, userId)),
    openDebtTotal(tx, userId),
  ]);
  if (!user) throw new WithdrawalError("not_found");
  const [openRequest] = await tx
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.userId, userId), inArray(withdrawalRequests.status, OPEN_STATUSES)))
    .limit(1);
  return {
    settings,
    user,
    wallet,
    debt,
    openRequest: openRequest ?? null,
    ...(await historyOf(tx, userId, now)),
  };
}

async function historyOf(tx: Handle, userId: string, now: Date) {
  const [month] = await tx
    .select({ used: sql<number>`coalesce(sum(${withdrawalRequests.points}), 0)::int` })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.userId, userId),
        inArray(withdrawalRequests.status, COUNTED_STATUSES),
        gte(withdrawalRequests.createdAt, monthStart(now)),
      ),
    );
  const [paid] = await tx
    .select({ paid: count() })
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.userId, userId), eq(withdrawalRequests.status, "paid")));
  return { monthUsed: month?.used ?? 0, paidBefore: paid?.paid ?? 0 };
}

const accountAgeDays = (user: User, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - user.createdAt.getTime()) / 86_400_000));

/** The first refusal that applies to a request for `points`, or null. The order is the contract. */
function firstRefusal(
  facts: WithdrawalFacts,
  points: number,
  destination: { destination: PayoutDestination; method: PayoutMethod },
  amountMinor: number,
  now: Date,
): WithdrawalRefusalReason | null {
  const { settings, user, wallet } = facts;
  if (!settings.enabled || settings.killSwitch || !settings.cashOutEnabled) return "cash_out_off";
  if (!user.phoneVerified) return "phone_unverified";
  if (accountAgeDays(user, now) < settings.minAccountAgeDays) return "account_too_new";
  if (facts.openRequest !== null) return "open_request";
  if (facts.debt > 0) return "reward_debt";
  if (points < settings.minWithdrawalPoints) return "below_minimum";
  if (wallet.cash < points || wallet.cash < settings.minWithdrawalPoints) return "not_enough_points";
  if (facts.monthUsed + points > settings.maxWithdrawalPointsPerMonth) return "monthly_cap";
  const { method, destination: saved } = destination;
  if (!method.enabled) return "method_disabled";
  if (saved.usableAfter.getTime() > now.getTime()) return "destination_cooldown";
  if (
    (method.minAmountMinor !== null && amountMinor < method.minAmountMinor) ||
    (method.maxAmountMinor !== null && amountMinor > method.maxAmountMinor)
  ) {
    return "amount_out_of_range";
  }
  return null;
}

// --- In-app and customer notices -------------------------------------------------------------------------

export type WithdrawalNoticeEvent =
  | "requested"
  | "approved"
  | "rejected"
  | "paid"
  | "canceled"
  | "destination_added";

/**
 * The in-app notification (written here, in the money transaction) plus the outbox entry the worker
 * turns into a WhatsApp or email message after the commit. The text always comes from i18n keys.
 */
async function notifyCustomer(
  tx: Transaction,
  user: Pick<User, "id" | "locale">,
  event: WithdrawalNoticeEvent,
  params: Record<string, unknown>,
  ref: { requestId?: string; destinationId?: string; note?: string | null },
  key: string,
): Promise<void> {
  await tx.insert(userNotifications).values({
    userId: user.id,
    kind: `rewards.${event === "destination_added" ? "payout_destination_added" : `withdrawal_${event}`}`,
    params,
    link: "/rewards/withdraw",
  });
  await enqueueOutbox(
    tx,
    "withdrawals.notify",
    { event, userId: user.id, ...ref, ...("hours" in params ? { hours: params.hours } : {}) },
    key,
  );
}

function amountParams(request: WithdrawalRequest, locale: User["locale"]) {
  return {
    points: request.points,
    amountMinor: request.amountMinor,
    currency: request.currency,
    amount: formatMoney(request.amountMinor, request.currency, locale),
  };
}

// --- Destinations ---------------------------------------------------------------------------------------

export interface AddDestinationInput {
  /** Fixed by the caller before sealing: the sealed value is bound to it as AAD. */
  id: string;
  userId: string;
  methodId: string;
  valueEnc: string;
  masked: string;
  destinationHash: string;
  now: Date;
}

/** The saved row (live or removed) that carries `destinationHash`, whoever owns it. */
export async function destinationByHash(
  db: Handle,
  destinationHash: string,
): Promise<PayoutDestination | null> {
  const [row] = await db
    .select()
    .from(payoutDestinations)
    .where(eq(payoutDestinations.destinationHash, destinationHash));
  return row ?? null;
}

/**
 * Saves a destination and starts its cooldown. The same value on ANOTHER account is refused
 * (`destination_in_use`, `destination_hash` is unique) and raises a `reward.fraud_flag` alert that
 * never names the other account; the same user saving the same value again returns the row (a
 * removed one comes back with a fresh cooldown, under its own id and AAD).
 */
export async function addPayoutDestination(
  db: Database,
  input: AddDestinationInput,
): Promise<{ destination: PayoutDestination; replayed: boolean }> {
  const outcome = await db.transaction(async (tx) => {
    await lockPointsWallet(tx, input.userId);
    const [method] = await tx.select().from(payoutMethods).where(eq(payoutMethods.id, input.methodId));
    if (!method?.enabled) return { refused: "method_disabled" as const };
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
    if (!user) return { refused: "not_found" as const };
    const settings = await rewardsSettingsOf(tx);
    const usableAfter = new Date(input.now.getTime() + settings.destinationCooldownHours * 3_600_000);

    const existing = await destinationByHash(tx, input.destinationHash);
    if (existing && existing.userId !== input.userId) {
      await raiseAdminAlert(tx, {
        kind: "reward.fraud_flag",
        severity: "warning",
        refType: "payout_destination",
        refId: input.userId,
        summary: `Payout destination already saved on another account was tried by ${maskedUserLabel(user.name, user.id)}.`,
        link: "/admin/growth/fraud",
      });
      return { refused: "destination_in_use" as const };
    }
    if (existing && existing.removedAt === null) {
      return { destination: existing, replayed: true };
    }

    const [live] = await tx
      .select({ total: count() })
      .from(payoutDestinations)
      .where(and(eq(payoutDestinations.userId, input.userId), isNull(payoutDestinations.removedAt)));
    if ((live?.total ?? 0) >= MAX_PAYOUT_DESTINATIONS) return { refused: "destination_limit" as const };

    let saved: PayoutDestination | undefined;
    if (existing) {
      // The user's own removed destination: back, with the new sealed text (bound to the same id).
      [saved] = await tx
        .update(payoutDestinations)
        .set({
          methodId: input.methodId,
          valueEnc: input.valueEnc,
          masked: input.masked,
          usableAfter,
          removedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(payoutDestinations.id, existing.id))
        .returning();
    } else {
      [saved] = await tx
        .insert(payoutDestinations)
        .values({
          id: input.id,
          userId: input.userId,
          methodId: input.methodId,
          valueEnc: input.valueEnc,
          masked: input.masked,
          destinationHash: input.destinationHash,
          usableAfter,
        })
        .returning();
    }
    if (!saved) throw new Error("Payout destination was not saved");
    await notifyCustomer(
      tx,
      user,
      "destination_added",
      { hours: settings.destinationCooldownHours },
      { destinationId: saved.id },
      `withdrawal-notify:destination:${saved.id}:${String(usableAfter.getTime())}`,
    );
    return { destination: saved, replayed: false };
  });
  if ("refused" in outcome) throw new WithdrawalError(outcome.refused);
  return outcome;
}

/** Marks the caller's destination removed (the hash stays, so it still blocks reuse elsewhere). */
export async function removePayoutDestination(
  db: Database,
  userId: string,
  destinationId: string,
  now: Date,
): Promise<void> {
  const removed = await db
    .update(payoutDestinations)
    .set({ removedAt: now, updatedAt: sql`now()` })
    .where(
      and(
        eq(payoutDestinations.id, destinationId),
        eq(payoutDestinations.userId, userId),
        isNull(payoutDestinations.removedAt),
      ),
    )
    .returning({ id: payoutDestinations.id });
  if (removed.length === 0) throw new WithdrawalError("not_found");
}

// --- The caller's eligibility ---------------------------------------------------------------------------

export interface WithdrawalEligibilityFacts {
  settings: RewardsSettings;
  cash: number;
  accountAgeDays: number;
  phoneVerified: boolean;
  openRequestId: string | null;
  monthUsed: number;
  debt: number;
  usableDestinations: number;
  nextDestinationUsableAt: Date | null;
  reasons: WithdrawalRefusalReason[];
}

/** Every check that currently fails, for the eligibility explainer. Read only. */
export async function withdrawalEligibility(
  db: Database,
  userId: string,
  now: Date,
): Promise<WithdrawalEligibilityFacts> {
  const settings = await rewardsSettingsOf(db);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new WithdrawalError("not_found");
  const wallet = (
    await db.execute<{ cash: number }>(sql`select cash from points_wallets where user_id = ${userId}`)
  )[0];
  const cash = wallet?.cash ?? 0;
  const [open] = await db
    .select({ id: withdrawalRequests.id })
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.userId, userId), inArray(withdrawalRequests.status, OPEN_STATUSES)))
    .limit(1);
  const debt = await openDebtTotal(db, userId);
  const { monthUsed } = await historyOf(db, userId, now);
  const saved = await db
    .select({ usableAfter: payoutDestinations.usableAfter, enabled: payoutMethods.enabled })
    .from(payoutDestinations)
    .innerJoin(payoutMethods, eq(payoutMethods.id, payoutDestinations.methodId))
    .where(and(eq(payoutDestinations.userId, userId), isNull(payoutDestinations.removedAt)));
  const usable = saved.filter((row) => row.enabled && row.usableAfter.getTime() <= now.getTime());
  const waiting = saved
    .filter((row) => row.enabled && row.usableAfter.getTime() > now.getTime())
    .map((row) => row.usableAfter.getTime());
  const nextDestinationUsableAt =
    usable.length === 0 && waiting.length > 0 ? new Date(Math.min(...waiting)) : null;

  const age = accountAgeDays(user, now);
  const reasons: WithdrawalRefusalReason[] = [];
  if (!settings.enabled || settings.killSwitch || !settings.cashOutEnabled) reasons.push("cash_out_off");
  if (!user.phoneVerified) reasons.push("phone_unverified");
  if (age < settings.minAccountAgeDays) reasons.push("account_too_new");
  if (open) reasons.push("open_request");
  if (debt > 0) reasons.push("reward_debt");
  if (cash < settings.minWithdrawalPoints) reasons.push("not_enough_points");
  if (monthUsed + settings.minWithdrawalPoints > settings.maxWithdrawalPointsPerMonth) {
    reasons.push("monthly_cap");
  }
  if (usable.length === 0 && waiting.length > 0) reasons.push("destination_cooldown");

  return {
    settings,
    cash,
    accountAgeDays: age,
    phoneVerified: user.phoneVerified,
    openRequestId: open?.id ?? null,
    monthUsed,
    debt,
    usableDestinations: usable.length,
    nextDestinationUsableAt,
    reasons,
  };
}

// --- Request, cancel -------------------------------------------------------------------------------------

export interface RequestWithdrawalInput {
  userId: string;
  /** Client-chosen: a retry with the same id returns the first request. */
  requestId: string;
  destinationId: string;
  points: number;
  now: Date;
}

export interface WithdrawalResult {
  request: WithdrawalRequest;
  replayed: boolean;
}

/**
 * Holds `points` of the caller's `cash` and queues the request for review, in one transaction under
 * the wallet lock: 20 concurrent requests can never overdraw the balance, and only one stays open.
 * Every refusal is a `WithdrawalError` whose reason is in `WITHDRAWAL_REFUSAL_REASONS`.
 */
export async function requestWithdrawal(
  db: Database,
  input: RequestWithdrawalInput,
): Promise<WithdrawalResult> {
  const { userId, requestId, destinationId, points, now } = input;
  return db.transaction(async (tx) => {
    const wallet = await lockPointsWallet(tx, userId);

    const [earlier] = await tx
      .select()
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.userId, userId), eq(withdrawalRequests.requestId, requestId)));
    if (earlier) {
      if (earlier.points !== points || earlier.destinationId !== destinationId) {
        throw new WithdrawalError("request_id_reused");
      }
      return { request: earlier, replayed: true };
    }

    const [saved] = await tx
      .select({ destination: payoutDestinations, method: payoutMethods })
      .from(payoutDestinations)
      .innerJoin(payoutMethods, eq(payoutMethods.id, payoutDestinations.methodId))
      .where(
        and(
          eq(payoutDestinations.id, destinationId),
          eq(payoutDestinations.userId, userId),
          isNull(payoutDestinations.removedAt),
        ),
      );
    if (!saved) throw new WithdrawalError("not_found");

    const facts = await loadFacts(tx, userId, wallet, now);
    const amountMinor = points * facts.settings.pointValueMinor;
    const refusal = firstRefusal(facts, points, saved, amountMinor, now);
    if (refusal) throw new WithdrawalError(refusal);

    const flags: WithdrawalFlag[] = facts.paidBefore === 0 ? ["first_withdrawal"] : [];
    const id = newId();
    const [request] = await tx
      .insert(withdrawalRequests)
      .values({
        id,
        userId,
        requestId,
        destinationId,
        points,
        amountMinor,
        currency: facts.settings.currency,
        rateMinorPerPoint: facts.settings.pointValueMinor,
        feeMinor: saved.method.feeMinor,
        flags,
      })
      .returning();
    if (!request) throw new Error("Withdrawal request was not stored");

    try {
      await pointsMove(tx, {
        userId,
        kind: "withdraw_hold",
        rows: [{ bucket: "cash", amount: -points, idempotencyKey: `withdraw:${id}:hold` }],
        referenceType: "withdrawal",
        referenceId: id,
        reason: "withdraw_hold",
      });
    } catch (error) {
      if (error instanceof PointsLedgerError && error.reason === "insufficient_points") {
        throw new WithdrawalError("not_enough_points");
      }
      throw error;
    }

    await raiseAdminAlert(tx, {
      kind: "withdrawal.requested",
      severity: "warning",
      refType: "withdrawal",
      refId: id,
      summary:
        `Withdrawal request: ${points.toLocaleString("en-US")} points (${formatMoney(amountMinor, request.currency, "en")}) ` +
        `from ${maskedUserLabel(facts.user.name, userId)}, account age ${String(accountAgeDays(facts.user, now))} days, ` +
        `lifetime earned ${facts.wallet.lifetimeEarned.toLocaleString("en-US")} points` +
        (flags.length > 0 ? `, flags: ${flags.join(", ")}` : "") +
        ".",
      link: `/admin/growth/withdrawals?id=${id}`,
    });
    await notifyCustomer(
      tx,
      facts.user,
      "requested",
      amountParams(request, facts.user.locale),
      { requestId: id },
      `withdrawal-notify:${id}:requested`,
    );
    return { request, replayed: false };
  });
}

async function lockRequest(tx: Transaction, id: string): Promise<WithdrawalRequest> {
  const [row] = await tx
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.id, id))
    .for("update");
  if (!row) throw new WithdrawalError("not_found");
  return row;
}

async function customerOf(tx: Transaction, userId: string): Promise<User> {
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user) throw new WithdrawalError("not_found");
  return user;
}

async function releasePoints(tx: Transaction, request: WithdrawalRequest, actorId: string | null) {
  await pointsMove(tx, {
    userId: request.userId,
    kind: "withdraw_release",
    rows: [{ bucket: "cash", amount: request.points, idempotencyKey: `withdraw:${request.id}:release` }],
    referenceType: "withdrawal",
    referenceId: request.id,
    actorId,
    reason: "withdraw_release",
  });
}

/** The owner cancels while the request is still `requested`; the held points return to `cash`. */
export async function cancelWithdrawal(
  db: Database,
  input: { userId: string; id: string },
): Promise<WithdrawalResult> {
  return db.transaction(async (tx) => {
    const [mine] = await tx
      .select({ id: withdrawalRequests.id })
      .from(withdrawalRequests)
      .where(and(eq(withdrawalRequests.id, input.id), eq(withdrawalRequests.userId, input.userId)));
    // Someone else's request looks exactly like a missing one.
    if (!mine) throw new WithdrawalError("not_found");
    const request = await lockRequest(tx, input.id);
    if (request.status === "canceled") return { request, replayed: true };
    if (request.status !== "requested") throw new WithdrawalError("illegal_state");
    await releasePoints(tx, request, input.userId);
    const [updated] = await tx
      .update(withdrawalRequests)
      .set({ status: "canceled", updatedAt: sql`now()` })
      .where(eq(withdrawalRequests.id, request.id))
      .returning();
    if (!updated) throw new Error("Withdrawal request was not updated");
    const user = await customerOf(tx, request.userId);
    await notifyCustomer(
      tx,
      user,
      "canceled",
      amountParams(updated, user.locale),
      { requestId: updated.id },
      `withdrawal-notify:${updated.id}:canceled`,
    );
    return { request: updated, replayed: false };
  });
}

// --- Admin steps -------------------------------------------------------------------------------------------

export interface ApproveResult extends WithdrawalResult {
  /** `first`: one of two approvals recorded; `approved`: the request is approved. */
  stage: "first" | "approved";
}

/** Whether a request of this size needs two different admins. */
export const needsSecondApproval = (points: number, settings: Pick<RewardsSettings, "fourEyesThresholdPoints">) =>
  points >= settings.fourEyesThresholdPoints;

/**
 * Approves a `requested` request. Never the admin's own request. At or above the four-eyes threshold
 * the first call records `approved_by` and leaves the status; a different admin's call completes it.
 * The same admin calling again is a replay, not a second approval.
 */
export async function approveWithdrawal(
  db: Database,
  input: { id: string; adminId: string; now: Date },
): Promise<ApproveResult> {
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.id);
    if (request.userId === input.adminId) throw new WithdrawalError("own_request");
    if (request.status === "approved" || request.status === "paid") {
      const involved = [request.approvedBy, request.secondApprovedBy].includes(input.adminId);
      if (!involved) throw new WithdrawalError("illegal_state");
      return { request, replayed: true, stage: "approved" as const };
    }
    if (request.status !== "requested") throw new WithdrawalError("illegal_state");

    const settings = await rewardsSettingsOf(tx);
    if (needsSecondApproval(request.points, settings)) {
      if (request.approvedBy === null) {
        const [first] = await tx
          .update(withdrawalRequests)
          .set({ approvedBy: input.adminId, approvedAt: input.now, updatedAt: sql`now()` })
          .where(eq(withdrawalRequests.id, request.id))
          .returning();
        if (!first) throw new Error("Withdrawal request was not updated");
        return { request: first, replayed: false, stage: "first" as const };
      }
      // The same admin approving twice is a retry of the first approval, never the second.
      if (request.approvedBy === input.adminId) {
        return { request, replayed: true, stage: "first" as const };
      }
      const [done] = await tx
        .update(withdrawalRequests)
        .set({
          status: "approved",
          secondApprovedBy: input.adminId,
          secondApprovedAt: input.now,
          updatedAt: sql`now()`,
        })
        .where(eq(withdrawalRequests.id, request.id))
        .returning();
      if (!done) throw new Error("Withdrawal request was not updated");
      await notifyApproved(tx, done);
      return { request: done, replayed: false, stage: "approved" as const };
    }

    const [approved] = await tx
      .update(withdrawalRequests)
      .set({
        status: "approved",
        approvedBy: input.adminId,
        approvedAt: input.now,
        updatedAt: sql`now()`,
      })
      .where(eq(withdrawalRequests.id, request.id))
      .returning();
    if (!approved) throw new Error("Withdrawal request was not updated");
    await notifyApproved(tx, approved);
    return { request: approved, replayed: false, stage: "approved" as const };
  });
}

async function notifyApproved(tx: Transaction, request: WithdrawalRequest): Promise<void> {
  const user = await customerOf(tx, request.userId);
  await notifyCustomer(
    tx,
    user,
    "approved",
    amountParams(request, user.locale),
    { requestId: request.id },
    `withdrawal-notify:${request.id}:approved`,
  );
}

/** Rejects a `requested` or `approved` request and returns the points to `cash`, with the reason. */
export async function rejectWithdrawal(
  db: Database,
  input: { id: string; adminId: string; reasonKey: string; note?: string | undefined },
): Promise<WithdrawalResult> {
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.id);
    if (request.userId === input.adminId) throw new WithdrawalError("own_request");
    if (request.status === "rejected") return { request, replayed: true };
    if (!OPEN_STATUSES.includes(request.status as (typeof OPEN_STATUSES)[number])) {
      throw new WithdrawalError("illegal_state");
    }
    await releasePoints(tx, request, input.adminId);
    const [updated] = await tx
      .update(withdrawalRequests)
      .set({ status: "rejected", rejectReason: input.reasonKey, updatedAt: sql`now()` })
      .where(eq(withdrawalRequests.id, request.id))
      .returning();
    if (!updated) throw new Error("Withdrawal request was not updated");
    const user = await customerOf(tx, request.userId);
    const reason = t(`rewards.withdrawal.reject.${input.reasonKey}` as MessageKey, {}, user.locale);
    await notifyCustomer(
      tx,
      user,
      "rejected",
      { ...amountParams(updated, user.locale), reason, reasonKey: input.reasonKey },
      { requestId: updated.id, note: input.note ?? null },
      `withdrawal-notify:${updated.id}:rejected`,
    );
    return { request: updated, replayed: false };
  });
}

/**
 * Records that the admin paid an `approved` request outside the app. The transfer reference is
 * required and unique; the same reference again is the same result, a different one on a paid request
 * is a conflict. No ledger row: see the header.
 */
export async function markWithdrawalPaid(
  db: Database,
  input: {
    id: string;
    adminId: string;
    transferReference: string;
    proofFileId?: string | undefined;
    now: Date;
  },
): Promise<WithdrawalResult> {
  try {
    return await db.transaction(async (tx) => {
      const request = await lockRequest(tx, input.id);
      if (request.userId === input.adminId) throw new WithdrawalError("own_request");
      if (request.status === "paid") {
        if (request.transferReference === input.transferReference) return { request, replayed: true };
        throw new WithdrawalError("reference_mismatch");
      }
      if (request.status !== "approved") throw new WithdrawalError("illegal_state");

      const [clash] = await tx
        .select({ id: withdrawalRequests.id })
        .from(withdrawalRequests)
        .where(
          and(
            eq(withdrawalRequests.transferReference, input.transferReference),
            ne(withdrawalRequests.id, request.id),
          ),
        );
      if (clash) throw new WithdrawalError("reference_in_use");
      if (input.proofFileId !== undefined) {
        const [proof] = await tx
          .select({ id: files.id })
          .from(files)
          .where(
            and(
              eq(files.id, input.proofFileId),
              eq(files.ownerUserId, input.adminId),
              eq(files.purpose, "payment_proof"),
              eq(files.status, "processed"),
            ),
          );
        if (!proof) throw new WithdrawalError("invalid_proof");
      }

      const [paid] = await tx
        .update(withdrawalRequests)
        .set({
          status: "paid",
          paidBy: input.adminId,
          paidAt: input.now,
          transferReference: input.transferReference,
          proofFileId: input.proofFileId ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(withdrawalRequests.id, request.id))
        .returning();
      if (!paid) throw new Error("Withdrawal request was not updated");
      const user = await customerOf(tx, request.userId);
      await notifyCustomer(
        tx,
        user,
        "paid",
        { ...amountParams(paid, user.locale), reference: input.transferReference },
        { requestId: paid.id },
        `withdrawal-notify:${paid.id}:paid`,
      );
      return { request: paid, replayed: false };
    });
  } catch (error) {
    // Two requests marked paid with one reference at the same moment: the unique index decides.
    if (isUniqueViolation(error, "withdrawal_requests_transfer_reference_key")) {
      throw new WithdrawalError("reference_in_use");
    }
    throw error;
  }
}

// --- Reconciliation ---------------------------------------------------------------------------------------

export interface WithdrawalReconcileResult {
  requests: number;
  /** Requests whose ledger rows do not add up to what their status says, plus orphan ledger rows. */
  drifted: number;
  requestIds: string[];
  /** Ledger rows of kind `withdraw_*` pointing at a request that does not exist. */
  orphanRows: number;
  paid: { currency: string; requests: number; points: number; amountMinor: number }[];
}

/**
 * Paid-out against the ledger (REFERRALS §8.2.6). While a request is requested, approved or paid its
 * `withdraw_hold`/`withdraw_release` rows must net to `-points` (the points left the balance and did
 * not come back); once rejected or canceled they must net to 0. A mismatch means a bug or a manual
 * edit, never a race: each query is one statement.
 */
export async function withdrawalReconcile(
  db: Database,
  reportLimit = 50,
): Promise<WithdrawalReconcileResult> {
  const net = sql`
    from withdrawal_requests r
    left join (
      select reference_id, sum(amount) as net
      from points_ledger
      where reference_type = 'withdrawal' and kind in ('withdraw_hold', 'withdraw_release') and bucket = 'cash'
      group by reference_id
    ) l on l.reference_id = r.id
  `;
  const mismatch = sql`(
    coalesce(l.net, 0) <> case when r.status in ('requested', 'approved', 'paid') then -r.points else 0 end
  )`;
  const totals = await db.execute<{ requests: number; drifted: number }>(sql`
    select count(*)::int as requests, (count(*) filter (where ${mismatch}))::int as drifted ${net}
  `);
  const { requests = 0, drifted = 0 } = totals[0] ?? {};
  const requestIds =
    drifted > 0
      ? (
          await db.execute<{ id: string }>(
            sql`select r.id ${net} where ${mismatch} order by r.id limit ${reportLimit}`,
          )
        ).map((row) => row.id)
      : [];
  const [orphans] = await db
    .select({ rows: count() })
    .from(pointsLedger)
    .where(
      and(
        eq(pointsLedger.referenceType, "withdrawal"),
        sql`not exists (select 1 from withdrawal_requests r where r.id = points_ledger.reference_id)`,
      ),
    );
  const orphanRows = orphans?.rows ?? 0;
  const paid = await db
    .select({
      currency: withdrawalRequests.currency,
      requests: count(),
      points: sql<number>`coalesce(sum(${withdrawalRequests.points}), 0)::int`,
      amountMinor: sql<number>`coalesce(sum(${withdrawalRequests.amountMinor}), 0)::int`,
    })
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.status, "paid"))
    .groupBy(withdrawalRequests.currency);
  return { requests, drifted: drifted + orphanRows, requestIds, orphanRows, paid };
}

/** Everything the overdue reminder and the notify handler need to know about one request. */
export async function loadWithdrawal(
  db: Handle,
  id: string,
): Promise<{ request: WithdrawalRequest; user: User } | null> {
  const [row] = await db
    .select({ request: withdrawalRequests, user: users })
    .from(withdrawalRequests)
    .innerJoin(users, eq(users.id, withdrawalRequests.userId))
    .where(eq(withdrawalRequests.id, id));
  return row ?? null;
}
