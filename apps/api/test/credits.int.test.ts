import { randomUUID } from "node:crypto";

import { creditLedger, creditReservations, creditWallets, type WalletOwner } from "@wasfa/db";
import { AppError } from "@wasfa/shared/errors";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CreditsRepo } from "../src/credits/credits.repo.js";
import { CreditsService } from "../src/credits/credits.service.js";
import { PlansService } from "../src/plans/plans.service.js";
import { QuotaService } from "../src/quota/quota.service.js";

import { AdminTestContext } from "./support/admin-context.js";
import { insertOrg } from "./support/identity-fixtures.js";

import type { PinoLogger } from "nestjs-pino";

/*
 * The credit state machine against a real Postgres 18, as the restricted `wasfa_api` role: the
 * concurrency guarantees are the point, so they are tested with real parallel connections.
 */

const ctx = new AdminTestContext();
let credits: CreditsService;
let warnings: ReturnType<typeof vi.fn>;
let metered: CreditsService;
let counter = 0;

beforeAll(async () => {
  await ctx.start();
  credits = ctx.app.get(CreditsService);
  // A second service with a spy logger, to see the overage warning without parsing log lines.
  warnings = vi.fn();
  const logger = { setContext: vi.fn(), warn: warnings } as unknown as PinoLogger;
  metered = new CreditsService(
    ctx.app.get(CreditsRepo),
    ctx.app.get(PlansService),
    ctx.app.get(QuotaService),
    logger,
  );
}, 180_000);

afterAll(async () => {
  await ctx.stop();
});

async function newUser(): Promise<WalletOwner> {
  const n = ++counter;
  const id = await ctx.insertUser({
    name: `Wallet User ${String(n)}`,
    email: `wallet${String(n)}-${randomUUID().slice(0, 6)}@example.com`,
  });
  return { type: "user", id };
}

const key = () => randomUUID();
const PERIOD = "2026-10";

/** A user whose wallet holds `balance` credits, funded through the real grant path. */
async function fundedUser(balance: number): Promise<{ owner: WalletOwner; walletId: string }> {
  const owner = await newUser();
  const wallet = await credits.ensureWallet(owner);
  if (balance > 0) await credits.grant(owner, balance, PERIOD);
  return { owner, walletId: wallet.id };
}

async function ledgerOf(walletId: string) {
  return ctx.owner.db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.walletId, walletId))
    .orderBy(asc(creditLedger.id));
}

async function balanceOf(walletId: string): Promise<number> {
  const [row] = await ctx.owner.db
    .select({ balance: creditWallets.balance })
    .from(creditWallets)
    .where(eq(creditWallets.id, walletId));
  return row?.balance ?? Number.NaN;
}

/** The reconciliation the nightly job will run: the ledger adds up to the stored balance, row by row. */
async function expectReconciled(walletId: string): Promise<void> {
  const rows = await ledgerOf(walletId);
  let running = 0;
  for (const row of rows) {
    running += row.amount;
    expect(row.balanceAfter, `balance_after of ${row.kind}`).toBe(running);
  }
  expect(await balanceOf(walletId)).toBe(running);
}

async function reservationOf(id: string) {
  const [row] = await ctx.owner.db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, id));
  if (!row) throw new Error("reservation missing");
  return row;
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected the call to be refused");
}

describe("reserve", () => {
  it("lets exactly 10 of 50 concurrent reserves of 1 credit through on a wallet of 10", async () => {
    const { owner, walletId } = await fundedUser(10);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        credits.reserve(owner, 1, {
          idempotencyKey: `race-${String(index)}-${walletId}`,
          purpose: "test",
        }),
      ),
    );
    const accepted = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(accepted).toHaveLength(10);
    expect(refused).toHaveLength(40);
    for (const { reason } of refused) {
      expect(reason).toBeInstanceOf(AppError);
      expect(reason).toMatchObject({
        code: "QUOTA_EXCEEDED",
        details: { reason: "insufficient_credits" },
      });
    }
    expect(await balanceOf(walletId)).toBe(0);
    const open = await ctx.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditReservations)
      .where(and(eq(creditReservations.walletId, walletId), eq(creditReservations.status, "open")));
    expect(open[0]?.n).toBe(10);
    await expectReconciled(walletId);
  });

  it("never lets the balance go below zero when concurrent callers want different amounts", async () => {
    const { owner, walletId } = await fundedUser(20);
    const amounts = [7, 5, 9, 3, 6, 4, 8, 2];
    await Promise.allSettled(
      amounts.map((amount, index) =>
        credits.reserve(owner, amount, {
          idempotencyKey: `mixed-${String(index)}-${walletId}`,
          purpose: "test",
        }),
      ),
    );
    expect(await balanceOf(walletId)).toBeGreaterThanOrEqual(0);
    await expectReconciled(walletId);
  });

  it("is idempotent: the same key returns the same reservation and holds credits once", async () => {
    const { owner, walletId } = await fundedUser(10);
    const idempotencyKey = key();
    const first = await credits.reserve(owner, 4, { idempotencyKey, purpose: "rx" });
    const again = await credits.reserve(owner, 4, { idempotencyKey, purpose: "rx" });
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.reservation.id).toBe(first.reservation.id);
    expect(await balanceOf(walletId)).toBe(6);
    expect((await ledgerOf(walletId)).filter((row) => row.kind === "usage_reserve")).toHaveLength(
      1,
    );
  });

  it("returns the original reservation for a retry even after the wallet can no longer afford it", async () => {
    const { owner } = await fundedUser(4);
    const idempotencyKey = key();
    const first = await credits.reserve(owner, 4, { idempotencyKey, purpose: "rx" });
    const again = await credits.reserve(owner, 4, { idempotencyKey, purpose: "rx" });
    expect(again.reservation.id).toBe(first.reservation.id);
  });

  it("refuses a key that already belongs to another wallet", async () => {
    const a = await fundedUser(5);
    const b = await fundedUser(5);
    const idempotencyKey = key();
    await credits.reserve(a.owner, 1, { idempotencyKey, purpose: "rx" });
    const error = await refusal(credits.reserve(b.owner, 1, { idempotencyKey, purpose: "rx" }));
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "idempotency_key_reused" },
    });
    expect(await balanceOf(b.walletId)).toBe(5);
  });

  it("refuses an amount that is not a positive integer", async () => {
    const { owner } = await fundedUser(5);
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      const error = await refusal(
        credits.reserve(owner, amount, { idempotencyKey: key(), purpose: "x" }),
      );
      expect(error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("works on an organization's wallet and creates it on first use", async () => {
    const creator = await newUser();
    const orgId = await insertOrg(ctx.owner.db, {
      createdBy: creator.id,
      members: [{ userId: creator.id, role: "org_admin" }],
    });
    const owner: WalletOwner = { type: "org", id: orgId };
    await credits.grant(owner, 12, PERIOD);
    const { reservation } = await credits.reserve(owner, 5, {
      idempotencyKey: key(),
      purpose: "rx",
    });
    const wallet = await ctx.owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.id, reservation.walletId));
    expect(wallet[0]).toMatchObject({ ownerOrgId: orgId, ownerUserId: null, balance: 7 });
  });
});

describe("settle", () => {
  it("charges the actual cost and returns the rest", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 6, {
      idempotencyKey: key(),
      purpose: "chat",
    });
    expect(await balanceOf(walletId)).toBe(4);

    const settled = await credits.settle(reservation.id, 2);
    expect(settled).toMatchObject({ changed: true, charged: 2, overage: 0 });
    expect(settled.reservation).toMatchObject({ status: "settled", settledAmount: 2 });
    expect(await balanceOf(walletId)).toBe(8);
    const kinds = (await ledgerOf(walletId)).map((row) => [row.kind, row.amount]);
    expect(kinds).toEqual([
      ["grant", 10],
      ["usage_reserve", -6],
      ["release", 6],
      ["usage_settle", -2],
    ]);
    await expectReconciled(walletId);
  });

  it("caps an actual above the reservation at the reservation and logs a warning", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await metered.reserve(owner, 3, {
      idempotencyKey: key(),
      purpose: "chat",
    });
    warnings.mockClear();

    const settled = await metered.settle(reservation.id, 8);
    expect(settled).toMatchObject({ charged: 3, overage: 5 });
    expect(settled.reservation.settledAmount).toBe(3);
    expect(await balanceOf(walletId)).toBe(7);
    expect(warnings).toHaveBeenCalledTimes(1);
    // Ids and numbers only.
    expect(JSON.stringify(warnings.mock.calls[0])).not.toMatch(/prompt|content|text/i);
    await expectReconciled(walletId);
  });

  it("settling with 0 returns the whole hold and writes no usage row", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 4, {
      idempotencyKey: key(),
      purpose: "rx",
    });
    await credits.settle(reservation.id, 0);
    expect(await balanceOf(walletId)).toBe(10);
    expect((await ledgerOf(walletId)).some((row) => row.kind === "usage_settle")).toBe(false);
    await expectReconciled(walletId);
  });

  it("is a no-op the second time", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 5, {
      idempotencyKey: key(),
      purpose: "rx",
    });
    await credits.settle(reservation.id, 3);
    const rowsBefore = (await ledgerOf(walletId)).length;
    const again = await credits.settle(reservation.id, 5);
    expect(again.changed).toBe(false);
    expect(again.charged).toBe(3);
    expect((await ledgerOf(walletId)).length).toBe(rowsBefore);
    expect(await balanceOf(walletId)).toBe(7);
  });

  it("charges once when 20 retries race", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 5, {
      idempotencyKey: key(),
      purpose: "rx",
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => credits.settle(reservation.id, 4)),
    );
    expect(results.filter((result) => result.changed)).toHaveLength(1);
    expect(await balanceOf(walletId)).toBe(6);
    await expectReconciled(walletId);
  });

  it("answers NOT_FOUND for a reservation that does not exist", async () => {
    const error = await refusal(credits.settle(randomUUID(), 1));
    expect(error.code).toBe("NOT_FOUND");
  });
});

describe("release", () => {
  it("returns the whole hold of an open reservation", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 7, {
      idempotencyKey: key(),
      purpose: "rx",
    });
    const released = await credits.release(reservation.id, "provider_error");
    expect(released.changed).toBe(true);
    expect(released.reservation.status).toBe("released");
    expect(await balanceOf(walletId)).toBe(10);
    await expectReconciled(walletId);
  });

  it("is a no-op after settle, and settle is a no-op after release", async () => {
    const { owner, walletId } = await fundedUser(10);
    const settledOne = await credits.reserve(owner, 4, { idempotencyKey: key(), purpose: "rx" });
    await credits.settle(settledOne.reservation.id, 4);
    const afterSettle = await credits.release(settledOne.reservation.id);
    expect(afterSettle.changed).toBe(false);
    expect(afterSettle.reservation.status).toBe("settled");
    expect(await balanceOf(walletId)).toBe(6);

    const releasedOne = await credits.reserve(owner, 2, { idempotencyKey: key(), purpose: "rx" });
    await credits.release(releasedOne.reservation.id);
    const afterRelease = await credits.settle(releasedOne.reservation.id, 2);
    expect(afterRelease.changed).toBe(false);
    expect(await balanceOf(walletId)).toBe(6);
    await expectReconciled(walletId);
  });
});

describe("sweepExpired", () => {
  it("releases a reservation past its expiry and leaves a live one alone", async () => {
    const { owner, walletId } = await fundedUser(10);
    const crashed = await credits.reserve(owner, 4, {
      idempotencyKey: key(),
      purpose: "rx",
      ttlSeconds: 60,
    });
    const live = await credits.reserve(owner, 3, {
      idempotencyKey: key(),
      purpose: "chat",
      ttlSeconds: 7_200,
    });
    expect(await balanceOf(walletId)).toBe(3);

    const swept = await credits.sweepExpired(new Date(Date.now() + 10 * 60_000));
    expect(swept.failed).toBe(0);
    expect(swept.released).toBeGreaterThanOrEqual(1);
    expect((await reservationOf(crashed.reservation.id)).status).toBe("expired");
    expect((await reservationOf(live.reservation.id)).status).toBe("open");
    expect(await balanceOf(walletId)).toBe(7);
    await expectReconciled(walletId);

    // A second run finds nothing more for this wallet.
    await credits.sweepExpired(new Date(Date.now() + 10 * 60_000));
    expect(await balanceOf(walletId)).toBe(7);
  });

  it("does not touch a reservation that was settled before it expired", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 4, {
      idempotencyKey: key(),
      purpose: "rx",
      ttlSeconds: 60,
    });
    await credits.settle(reservation.id, 4);
    await credits.sweepExpired(new Date(Date.now() + 10 * 60_000));
    expect((await reservationOf(reservation.id)).status).toBe("settled");
    expect(await balanceOf(walletId)).toBe(6);
    await expectReconciled(walletId);
  });

  it("stays consistent when the sweeper and a settle race for the same reservation", async () => {
    const { owner, walletId } = await fundedUser(10);
    const { reservation } = await credits.reserve(owner, 5, {
      idempotencyKey: key(),
      purpose: "rx",
      ttlSeconds: 60,
    });
    await Promise.all([
      credits.settle(reservation.id, 5),
      credits.sweepExpired(new Date(Date.now() + 10 * 60_000)),
    ]);
    expect(["settled", "expired"]).toContain((await reservationOf(reservation.id)).status);
    await expectReconciled(walletId);
  });
});

describe("adjust", () => {
  it("adds and removes credits, and a retry with the same key changes nothing", async () => {
    const owner = await newUser();
    const admin = await newUser();
    const idempotencyKey = key();
    const options = { reason: "Support gift", actorId: admin.id, idempotencyKey };

    const first = await credits.adjust(owner, 25, options);
    expect(first).toMatchObject({ replayed: false, balanceBefore: 0, balanceAfter: 25 });
    const again = await credits.adjust(owner, 25, options);
    expect(again.replayed).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect(await balanceOf(first.walletId)).toBe(25);

    await credits.adjust(owner, -10, { ...options, idempotencyKey: key() });
    expect(await balanceOf(first.walletId)).toBe(15);
    const rows = await ledgerOf(first.walletId);
    expect(rows.map((row) => [row.kind, row.amount, row.actorId])).toEqual([
      ["admin_adjust", 25, admin.id],
      ["admin_adjust", -10, admin.id],
    ]);
    await expectReconciled(first.walletId);
  });

  it("refuses to take a wallet below zero and records nothing", async () => {
    const { owner, walletId } = await fundedUser(5);
    const admin = await newUser();
    const error = await refusal(
      credits.adjust(owner, -6, { reason: "Chargeback", actorId: admin.id, idempotencyKey: key() }),
    );
    expect(error).toMatchObject({ code: "CONFLICT", details: { reason: "insufficient_balance" } });
    expect(await balanceOf(walletId)).toBe(5);
    expect(await ledgerOf(walletId)).toHaveLength(1);
  });

  it("answers NOT_FOUND for an owner that does not exist, without creating a wallet", async () => {
    const admin = await newUser();
    const ghost: WalletOwner = { type: "user", id: randomUUID() };
    const error = await refusal(
      credits.adjust(ghost, 5, { reason: "Nobody", actorId: admin.id, idempotencyKey: key() }),
    );
    expect(error.code).toBe("NOT_FOUND");
    const wallets = await ctx.owner.db
      .select()
      .from(creditWallets)
      .where(eq(creditWallets.ownerUserId, ghost.id));
    expect(wallets).toHaveLength(0);
  });

  it("applies 20 concurrent debits of the same wallet one at a time", async () => {
    const { owner, walletId } = await fundedUser(10);
    const admin = await newUser();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        credits.adjust(owner, -1, { reason: "Race", actorId: admin.id, idempotencyKey: key() }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(10);
    expect(await balanceOf(walletId)).toBe(0);
    await expectReconciled(walletId);
  });
});

describe("grant", () => {
  it("is idempotent per owner and period", async () => {
    const owner = await newUser();
    const first = await credits.grant(owner, 30, "2026-11");
    const again = await credits.grant(owner, 30, "2026-11");
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(await balanceOf(first.walletId)).toBe(30);

    const next = await credits.grant(owner, 30, "2026-12");
    expect(next.replayed).toBe(false);
    expect(await balanceOf(first.walletId)).toBe(60);
    expect((await ledgerOf(first.walletId)).map((row) => row.idempotencyKey)).toEqual([
      `grant:user:${owner.id}:2026-11`,
      `grant:user:${owner.id}:2026-12`,
    ]);
    await expectReconciled(first.walletId);
  });

  it("gives one grant when 10 callers race", async () => {
    const owner = await newUser();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => credits.grant(owner, 30, "2027-01")),
    );
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await balanceOf(results[0]?.walletId ?? "")).toBe(30);
  });

  it("rejects a malformed period", async () => {
    const owner = await newUser();
    await expect(credits.grant(owner, 30, "2026-13")).rejects.toThrow("YYYY-MM");
  });
});

describe("refund", () => {
  it("gives credits back once per key", async () => {
    const { owner, walletId } = await fundedUser(10);
    const idempotencyKey = key();
    await credits.refund(owner, 3, { reason: "no_result", idempotencyKey });
    const again = await credits.refund(owner, 3, { reason: "no_result", idempotencyKey });
    expect(again.replayed).toBe(true);
    expect(await balanceOf(walletId)).toBe(13);
    expect((await ledgerOf(walletId)).at(-1)).toMatchObject({ kind: "refund", amount: 3 });
    await expectReconciled(walletId);
  });
});
