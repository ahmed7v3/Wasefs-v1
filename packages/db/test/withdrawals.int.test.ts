import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { pointsMove, ensurePointsWallet } from "../src/points-ledger.js";
import { adminAlerts } from "../src/schema/alerts.js";
import {
  payoutDestinations,
  payoutMethods,
  pointsLedger,
  pointsWallets,
  rewardDebts,
  siteSettings,
  users,
  withdrawalRequests,
} from "../src/schema/index.js";
import { seedDefaults } from "../src/seed-data.js";
import {
  WithdrawalError,
  addPayoutDestination,
  approveWithdrawal,
  cancelWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
  removePayoutDestination,
  requestWithdrawal,
  withdrawalEligibility,
  withdrawalReconcile,
} from "../src/withdrawals.js";

import { startTestDb, type TestDb } from "./db-fixture.js";
import { unique } from "./schema-kit.js";

/*
 * Withdrawals against a real PostgreSQL 18 (REFERRALS-REWARDS §8.2, Task 3.12): eligibility from
 * settings, the points hold under real concurrency, destinations (cooldown, shared hash), the admin
 * steps with four eyes, idempotency and the reconciliation of paid-out against the ledger.
 */

vi.setConfig({ testTimeout: 60_000 });

let testDb: TestDb;
const db = () => testDb.handle.db;
const DAY = 86_400_000;
const NOW = new Date();
let methodId: string;
let seq = 0;

async function setRewards(patch: Record<string, unknown> = {}): Promise<void> {
  const value = {
    enabled: true,
    cashOutEnabled: true,
    destinationCooldownHours: 0,
    fourEyesThresholdPoints: 1_000_000,
    ...patch,
  };
  await db()
    .insert(siteSettings)
    .values({ key: "rewards", value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value } });
}

beforeAll(async () => {
  testDb = await startTestDb();
  await seedDefaults(db());
  await setRewards();
  const [method] = await db()
    .insert(payoutMethods)
    .values({
      key: "test_wallet",
      nameAr: "محفظة",
      nameEn: "Wallet",
      enabled: true,
      fieldSchema: {
        fields: [{ key: "number", labelKey: "k", kind: "egypt_mobile", required: true }],
      },
    })
    .returning({ id: payoutMethods.id });
  if (!method) throw new Error("method insert failed");
  methodId = method.id;
}, 180_000);

afterAll(async () => {
  await testDb?.stop();
});

async function newUser(values: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  seq += 1;
  const [row] = await db()
    .insert(users)
    .values({
      name: "Mona Ahmed",
      email: `${unique("wd")}@example.com`,
      phone: `+2010${String(seq).padStart(8, "0")}`,
      phoneVerified: true,
      phoneVerifiedAt: NOW,
      createdAt: new Date(NOW.getTime() - 30 * DAY),
      ...values,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("user insert failed");
  return row.id;
}

async function fund(userId: string, points: number): Promise<void> {
  await db().transaction(async (tx) => {
    await pointsMove(tx, {
      userId,
      kind: "admin_adjust",
      rows: [{ bucket: "cash", amount: points, idempotencyKey: `test:${randomUUID()}` }],
      referenceType: "admin",
      referenceId: randomUUID(),
      lifetimeDelta: points,
    });
  });
}

async function destination(userId: string, now = NOW) {
  const { destination: saved } = await addPayoutDestination(db(), {
    id: randomUUID(),
    userId,
    methodId,
    valueEnc: "sealed",
    masked: "010••••7026",
    destinationHash: randomUUID().replaceAll("-", "").repeat(2),
    now,
  });
  return saved;
}

/** A funded, verified, old-enough user with a usable destination. */
async function ready(points = 5_000) {
  const userId = await newUser();
  await fund(userId, points);
  const saved = await destination(userId);
  return { userId, destinationId: saved.id };
}

const ask = (
  who: { userId: string; destinationId: string },
  points = 1_000,
  extra: { requestId?: string; now?: Date } = {},
) =>
  requestWithdrawal(db(), {
    userId: who.userId,
    destinationId: who.destinationId,
    points,
    requestId: extra.requestId ?? randomUUID(),
    now: extra.now ?? NOW,
  });

async function reasonOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof WithdrawalError) return error.reason;
    throw error;
  }
  return "none";
}

const wallet = async (userId: string) =>
  (await db().select().from(pointsWallets).where(eq(pointsWallets.userId, userId)))[0];

const ledgerOf = async (userId: string) => {
  const w = await wallet(userId);
  return db().select().from(pointsLedger).where(eq(pointsLedger.walletId, w?.id ?? ""));
};

describe("eligibility from settings", () => {
  it("refuses everything while cash-out is off, even with enabled rewards", async () => {
    await setRewards({ cashOutEnabled: false });
    const who = await ready();
    expect(await reasonOf(ask(who))).toBe("cash_out_off");
    expect((await withdrawalEligibility(db(), who.userId, NOW)).reasons).toContain("cash_out_off");
    await setRewards({ killSwitch: true });
    expect(await reasonOf(ask(who))).toBe("cash_out_off");
    await setRewards();
  });

  it("takes the minimum from settings", async () => {
    const who = await ready(2_000);
    expect(await reasonOf(ask(who, 999))).toBe("below_minimum");
    await setRewards({ minWithdrawalPoints: 500 });
    expect(await reasonOf(ask(who, 999))).toBe("none");
    await setRewards({ minWithdrawalPoints: 1_000 });
  });

  it("refuses on balance, unverified phone, new accounts, debt and the monthly cap", async () => {
    const poor = await ready(1_500);
    expect(await reasonOf(ask(poor, 2_000))).toBe("not_enough_points");

    const unverified = await newUser({ phoneVerified: false, phoneVerifiedAt: null });
    await fund(unverified, 2_000);
    const unverifiedDest = await destination(unverified);
    expect(
      await reasonOf(ask({ userId: unverified, destinationId: unverifiedDest.id })),
    ).toBe("phone_unverified");

    const fresh = await newUser({ createdAt: NOW });
    await fund(fresh, 2_000);
    const freshDest = await destination(fresh);
    expect(await reasonOf(ask({ userId: fresh, destinationId: freshDest.id }))).toBe(
      "account_too_new",
    );

    const indebted = await ready(2_000);
    await db().insert(rewardDebts).values({
      userId: indebted.userId,
      amount: 10,
      remaining: 10,
      reason: "refund",
    });
    expect(await reasonOf(ask(indebted))).toBe("reward_debt");

    await setRewards({ maxWithdrawalPointsPerMonth: 1_500 });
    const capped = await ready(5_000);
    expect(await reasonOf(ask(capped, 1_000))).toBe("none");
    await db()
      .update(withdrawalRequests)
      .set({ status: "paid", transferReference: unique("ref"), paidAt: NOW })
      .where(eq(withdrawalRequests.userId, capped.userId));
    expect(await reasonOf(ask(capped, 1_000))).toBe("monthly_cap");
    await setRewards();
  });

  it("a destination of someone else is NOT_FOUND, not a refusal", async () => {
    const a = await ready();
    const b = await ready();
    expect(await reasonOf(ask({ userId: a.userId, destinationId: b.destinationId }))).toBe(
      "not_found",
    );
  });
});

describe("the points hold", () => {
  it("snapshots the rate, holds cash in the ledger and keeps bucket = SUM(ledger)", async () => {
    const who = await ready(3_000);
    const { request, replayed } = await ask(who, 1_200);
    expect(replayed).toBe(false);
    expect(request).toMatchObject({
      points: 1_200,
      amountMinor: 12_000,
      rateMinorPerPoint: 10,
      currency: "EGP",
      status: "requested",
      flags: ["first_withdrawal"],
    });
    expect((await wallet(who.userId))?.cash).toBe(1_800);
    const rows = await ledgerOf(who.userId);
    expect(rows.filter((row) => row.kind === "withdraw_hold")).toMatchObject([
      { amount: -1_200, bucket: "cash", referenceType: "withdrawal", referenceId: request.id },
    ]);
    const result = await withdrawalReconcile(db());
    expect(result.drifted).toBe(0);
  });

  it("20 concurrent requests never exceed cash and leave one open request", async () => {
    const who = await ready(1_500);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => ask(who, 1_000)),
    );
    const accepted = outcomes.filter((outcome) => outcome.status === "fulfilled");
    expect(accepted).toHaveLength(1);
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect((outcome.reason as WithdrawalError).reason).toBe("open_request");
      }
    }
    expect((await wallet(who.userId))?.cash).toBe(500);
    const open = await db()
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, who.userId));
    expect(open).toHaveLength(1);
  });

  it("the same request id, even concurrently, withdraws once", async () => {
    const who = await ready(5_000);
    const requestId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ask(who, 1_000, { requestId })),
    );
    expect(new Set(results.map((result) => result.request.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect((await wallet(who.userId))?.cash).toBe(4_000);
    expect(await reasonOf(ask(who, 2_000, { requestId }))).toBe("request_id_reused");
  });

  it("cancel and reject return the points; both are idempotent and reconcile cleanly", async () => {
    const admin = await newUser();
    const canceled = await ready(2_000);
    const first = await ask(canceled, 1_000);
    const stranger = await newUser();
    expect(
      await reasonOf(cancelWithdrawal(db(), { userId: stranger, id: first.request.id })),
    ).toBe("not_found");
    await cancelWithdrawal(db(), { userId: canceled.userId, id: first.request.id });
    expect(
      (await cancelWithdrawal(db(), { userId: canceled.userId, id: first.request.id })).replayed,
    ).toBe(true);
    expect((await wallet(canceled.userId))?.cash).toBe(2_000);

    const rejected = await ready(2_000);
    const second = await ask(rejected, 1_000);
    await approveWithdrawal(db(), { id: second.request.id, adminId: admin, now: NOW });
    const done = await rejectWithdrawal(db(), {
      id: second.request.id,
      adminId: admin,
      reasonKey: "account_review",
    });
    expect(done.request).toMatchObject({ status: "rejected", rejectReason: "account_review" });
    expect((await wallet(rejected.userId))?.cash).toBe(2_000);
    expect(
      (await rejectWithdrawal(db(), { id: second.request.id, adminId: admin, reasonKey: "other" }))
        .replayed,
    ).toBe(true);
    // A paid or canceled request cannot be canceled by its owner any more.
    expect(
      await reasonOf(cancelWithdrawal(db(), { userId: rejected.userId, id: second.request.id })),
    ).toBe("illegal_state");
    expect((await withdrawalReconcile(db())).drifted).toBe(0);
  });
});

describe("destinations", () => {
  it("starts the cooldown and refuses the request until it ends", async () => {
    await setRewards({ destinationCooldownHours: 48 });
    const userId = await newUser();
    await fund(userId, 2_000);
    const saved = await destination(userId);
    expect(saved.usableAfter.getTime()).toBe(NOW.getTime() + 48 * 3_600_000);
    const who = { userId, destinationId: saved.id };
    expect(await reasonOf(ask(who))).toBe("destination_cooldown");
    const eligibility = await withdrawalEligibility(db(), userId, NOW);
    expect(eligibility.nextDestinationUsableAt?.getTime()).toBe(saved.usableAfter.getTime());
    expect(await reasonOf(ask(who, 1_000, { now: new Date(NOW.getTime() + 49 * 3_600_000) }))).toBe(
      "none",
    );
    await setRewards();
  });

  it("the same value on another account is refused, alerted and never names the owner", async () => {
    const hash = "ab".repeat(32);
    const owner = await newUser();
    const intruder = await newUser();
    const base = { methodId, valueEnc: "sealed", masked: "010••••7026", destinationHash: hash, now: NOW };
    const mine = await addPayoutDestination(db(), { ...base, id: randomUUID(), userId: owner });
    expect(
      await reasonOf(addPayoutDestination(db(), { ...base, id: randomUUID(), userId: intruder })),
    ).toBe("destination_in_use");
    const [alert] = await db()
      .select()
      .from(adminAlerts)
      .where(eq(adminAlerts.refId, intruder));
    expect(alert).toMatchObject({ kind: "reward.fraud_flag" });
    expect(alert?.summary).not.toContain(owner.slice(-8));

    // The owner can remove it, add it again (fresh cooldown, same row) and the hash still blocks the intruder.
    await removePayoutDestination(db(), owner, mine.destination.id, NOW);
    const again = await addPayoutDestination(db(), { ...base, id: randomUUID(), userId: owner });
    expect(again.destination.id).toBe(mine.destination.id);
    await removePayoutDestination(db(), owner, mine.destination.id, NOW);
    expect(
      await reasonOf(addPayoutDestination(db(), { ...base, id: randomUUID(), userId: intruder })),
    ).toBe("destination_in_use");
  });

  it("allows at most 5 saved destinations", async () => {
    const userId = await newUser();
    for (let i = 0; i < 5; i++) await destination(userId);
    expect(await reasonOf(destination(userId))).toBe("destination_limit");
  });
});

describe("admin steps", () => {
  it("flags the first withdrawal only; paid is idempotent and references are unique", async () => {
    const admin = await newUser();
    const payer = await newUser();
    const who = await ready(5_000);
    const first = await ask(who);
    expect(first.request.flags).toEqual(["first_withdrawal"]);
    await approveWithdrawal(db(), { id: first.request.id, adminId: admin, now: NOW });
    const ref = unique("ref");
    const paid = await markWithdrawalPaid(db(), {
      id: first.request.id,
      adminId: payer,
      transferReference: ref,
      now: NOW,
    });
    expect(paid.request.status).toBe("paid");
    const again = await markWithdrawalPaid(db(), {
      id: first.request.id,
      adminId: payer,
      transferReference: ref,
      now: NOW,
    });
    expect(again.replayed).toBe(true);
    expect(
      await reasonOf(
        markWithdrawalPaid(db(), {
          id: first.request.id,
          adminId: payer,
          transferReference: unique("other"),
          now: NOW,
        }),
      ),
    ).toBe("reference_mismatch");
    // Paid wrote no ledger row: the hold stays, so bucket = SUM(ledger) and the books reconcile.
    expect((await wallet(who.userId))?.cash).toBe(4_000);
    expect((await ledgerOf(who.userId)).map((row) => row.kind).sort()).toEqual([
      "admin_adjust",
      "withdraw_hold",
    ]);

    const second = await ask(who);
    expect(second.request.flags).toEqual([]);
    await approveWithdrawal(db(), { id: second.request.id, adminId: admin, now: NOW });
    expect(
      await reasonOf(
        markWithdrawalPaid(db(), {
          id: second.request.id,
          adminId: payer,
          transferReference: ref,
          now: NOW,
        }),
      ),
    ).toBe("reference_in_use");
    const result = await withdrawalReconcile(db());
    expect(result.drifted).toBe(0);
    expect(result.paid[0]).toMatchObject({ currency: "EGP" });
  });

  it("an admin cannot approve, reject or pay their own request; pay needs approval", async () => {
    const who = await ready(3_000);
    const mine = await ask(who);
    expect(await reasonOf(approveWithdrawal(db(), { id: mine.request.id, adminId: who.userId, now: NOW }))).toBe(
      "own_request",
    );
    expect(
      await reasonOf(rejectWithdrawal(db(), { id: mine.request.id, adminId: who.userId, reasonKey: "other" })),
    ).toBe("own_request");
    const other = await newUser();
    expect(
      await reasonOf(
        markWithdrawalPaid(db(), {
          id: mine.request.id,
          adminId: other,
          transferReference: unique("r"),
          now: NOW,
        }),
      ),
    ).toBe("illegal_state");
    await approveWithdrawal(db(), { id: mine.request.id, adminId: other, now: NOW });
    expect(
      await reasonOf(
        markWithdrawalPaid(db(), {
          id: mine.request.id,
          adminId: who.userId,
          transferReference: unique("r"),
          now: NOW,
        }),
      ),
    ).toBe("own_request");
  });

  it("four eyes: at the threshold the first approval waits for a different admin", async () => {
    await setRewards({ fourEyesThresholdPoints: 1_000 });
    const first = await newUser();
    const second = await newUser();
    const who = await ready(3_000);
    const { request } = await ask(who);
    const one = await approveWithdrawal(db(), { id: request.id, adminId: first, now: NOW });
    expect(one.stage).toBe("first");
    expect(one.request.status).toBe("requested");
    expect(one.request.approvedBy).toBe(first);
    const same = await approveWithdrawal(db(), { id: request.id, adminId: first, now: NOW });
    expect(same).toMatchObject({ stage: "first", replayed: true });
    expect(same.request.status).toBe("requested");
    const two = await approveWithdrawal(db(), { id: request.id, adminId: second, now: NOW });
    expect(two.stage).toBe("approved");
    expect(two.request).toMatchObject({ status: "approved", secondApprovedBy: second });
    await setRewards();
  });

  it("below the threshold one approval is enough", async () => {
    const admin = await newUser();
    const who = await ready(3_000);
    const { request } = await ask(who);
    const done = await approveWithdrawal(db(), { id: request.id, adminId: admin, now: NOW });
    expect(done).toMatchObject({ stage: "approved" });
    expect(done.request.status).toBe("approved");
  });
});

describe("reconciliation", () => {
  it("flags a request whose ledger does not match its status", async () => {
    const who = await ready(3_000);
    const { request } = await ask(who);
    expect((await withdrawalReconcile(db())).requestIds).not.toContain(request.id);
    // A manual edit: the request says rejected but the points never came back.
    await db()
      .update(withdrawalRequests)
      .set({ status: "rejected" })
      .where(eq(withdrawalRequests.id, request.id));
    const result = await withdrawalReconcile(db());
    expect(result.requestIds).toContain(request.id);
    expect(result.drifted).toBeGreaterThan(0);
    await db()
      .update(withdrawalRequests)
      .set({ status: "requested" })
      .where(eq(withdrawalRequests.id, request.id));
  });
});

describe("housekeeping", () => {
  it("keeps the wallet helper exported", async () => {
    const userId = await newUser();
    expect((await ensurePointsWallet(db(), userId)).cash).toBe(0);
    await db().delete(payoutDestinations).where(inArray(payoutDestinations.userId, [userId]));
  });
});
