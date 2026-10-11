import {
  createDb,
  creditLedger,
  creditReservations,
  creditWallets,
  planAssignments,
  plans,
  reserve,
  seedDefaults,
  settle,
  users,
} from "@wasfa/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GRANT_BATCH_SIZE, grantMonthlyJob } from "../src/jobs/credits.grant.job.js";
import { sweepReservationsJob } from "../src/jobs/credits.sweep.job.js";

import { startPostgres, type TestPostgres } from "./support/postgres.js";

/*
 * Seeds as the table owner and runs the jobs as the restricted `wasfa_api` role the worker uses in
 * production (it has no UPDATE/DELETE on credit_ledger).
 */

const lines: string[] = [];
const logger = pino(
  { level: "info" },
  {
    write: (line: string) => {
      lines.push(line);
    },
  },
);

let postgres: TestPostgres;
let owner: ReturnType<typeof createDb>;
let worker: ReturnType<typeof createDb>;

beforeAll(async () => {
  postgres = await startPostgres();
  owner = createDb({ url: postgres.ownerUrl, max: 2 });
  worker = createDb({ url: postgres.apiUrl, max: 4 });
  await seedDefaults(owner.db);
}, 180_000);

afterAll(async () => {
  await Promise.all([owner?.close(), worker?.close()]);
  await postgres?.stop();
});

let counter = 0;

interface SeedUser {
  emailVerified?: boolean;
  phoneVerified?: boolean;
  status?: "active" | "suspended";
}

async function createUser(options: SeedUser = {}): Promise<string> {
  const n = String(++counter);
  const phone = options.phoneVerified ? `+20100${n.padStart(7, "0")}` : null;
  const [row] = await owner.db
    .insert(users)
    .values({
      name: "Grant Person",
      email: `grant${n}@example.com`,
      emailVerified: options.emailVerified ?? true,
      phone,
      phoneVerified: options.phoneVerified ?? false,
      phoneVerifiedAt: options.phoneVerified ? new Date() : null,
      status: options.status ?? "active",
      suspendedReason: options.status === "suspended" ? "spam" : null,
    })
    .returning({ id: users.id });
  if (row === undefined) throw new Error("seed failed");
  return row.id;
}

const run = (now: Date) => grantMonthlyJob({}, { db: worker.db, logger }, now);

async function ledgerOf(userId: string) {
  const [wallet] = await owner.db
    .select()
    .from(creditWallets)
    .where(eq(creditWallets.ownerUserId, userId));
  if (!wallet) return { balance: null, rows: [] };
  const rows = await owner.db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.walletId, wallet.id))
    .orderBy(creditLedger.id);
  return { balance: wallet.balance, rows };
}

async function planByKey(key: string) {
  const [plan] = await owner.db.select().from(plans).where(eq(plans.key, key));
  if (!plan) throw new Error(`plan ${key} missing`);
  return plan;
}

const OCTOBER = new Date("2026-10-11T00:10:00Z");
const NOVEMBER = new Date("2026-11-01T00:10:00Z");

describe("credits.grant_monthly", () => {
  it("gives a verified user the default plan's credits once per month", async () => {
    const userId = await createUser();
    await run(OCTOBER);
    const first = await ledgerOf(userId);
    expect(first.balance).toBe(30);
    expect(first.rows.map((row) => [row.kind, row.amount, row.idempotencyKey])).toEqual([
      ["grant", 30, `grant:user:${userId}:2026-10`],
    ]);

    // A second run in the same month (the job runs daily) pays nobody again.
    await run(new Date("2026-10-20T00:10:00Z"));
    expect((await ledgerOf(userId)).balance).toBe(30);

    await run(NOVEMBER);
    const next = await ledgerOf(userId);
    expect(next.balance).toBe(60);
    expect(next.rows.map((row) => row.idempotencyKey)).toEqual([
      `grant:user:${userId}:2026-10`,
      `grant:user:${userId}:2026-11`,
    ]);
  });

  it("accepts a phone-verified user and skips unverified, suspended and zero-credit users", async () => {
    const phoneOnly = await createUser({ emailVerified: false, phoneVerified: true });
    const unverified = await createUser({ emailVerified: false });
    const suspended = await createUser({ status: "suspended" });
    const onZeroPlan = await createUser();
    const zero = await owner.db
      .insert(plans)
      .values({ key: "zero_credits", nameAr: "صفر", nameEn: "Zero", monthlyCredits: 0 })
      .returning();
    await owner.db.insert(planAssignments).values({
      ownerUserId: onZeroPlan,
      planId: zero[0]?.id ?? "",
      reason: "test",
      startsAt: new Date(OCTOBER.getTime() - 86_400_000),
    });

    await run(OCTOBER);

    expect((await ledgerOf(phoneOnly)).balance).toBe(30);
    expect((await ledgerOf(unverified)).balance).toBeNull();
    expect((await ledgerOf(suspended)).balance).toBeNull();
    expect((await ledgerOf(onZeroPlan)).balance).toBeNull();
  });

  it("uses the plan the user is assigned to right now", async () => {
    const pro = await planByKey("pro");
    const assigned = await createUser();
    const expired = await createUser();
    const day = 86_400_000;
    await owner.db.insert(planAssignments).values([
      {
        ownerUserId: assigned,
        planId: pro.id,
        reason: "pilot",
        startsAt: new Date(OCTOBER.getTime() - day),
      },
      {
        ownerUserId: expired,
        planId: pro.id,
        reason: "pilot",
        startsAt: new Date(OCTOBER.getTime() - 5 * day),
        endsAt: new Date(OCTOBER.getTime() - day),
      },
    ]);

    await run(OCTOBER);

    expect((await ledgerOf(assigned)).balance).toBe(pro.monthlyCredits);
    expect((await ledgerOf(expired)).balance).toBe(30);
  });

  it("covers more users than one batch", async () => {
    const total = GRANT_BATCH_SIZE * 2 + 37;
    const rows = await owner.db
      .insert(users)
      .values(
        Array.from({ length: total }, (_, index) => ({
          name: "Bulk Person",
          email: `bulk${String(index)}-${String(++counter)}@example.com`,
          emailVerified: true,
        })),
      )
      .returning({ id: users.id });
    const ids = rows.map((row) => row.id);

    await run(OCTOBER);

    const granted = await owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditWallets)
      .where(and(inArray(creditWallets.ownerUserId, ids), eq(creditWallets.balance, 30)));
    expect(granted[0]?.n).toBe(total);
  });

  it("logs counts only", async () => {
    lines.length = 0;
    await run(OCTOBER);
    const output = lines.join("");
    expect(output).toContain("Monthly credit grants finished");
    expect(output).not.toContain("@example.com");
  });
});

describe("credits.sweep_reservations", () => {
  it("releases a reservation whose job crashed and leaves a live one", async () => {
    const userId = await createUser();
    const owned = { type: "user", id: userId } as const;
    await run(OCTOBER);

    const crashed = await reserve(worker.db, owned, 4, {
      idempotencyKey: `crash-${userId}`,
      purpose: "rx",
      ttlSeconds: 60,
      now: new Date(Date.now() - 3_600_000),
    });
    const live = await reserve(worker.db, owned, 2, {
      idempotencyKey: `live-${userId}`,
      purpose: "chat",
      ttlSeconds: 900,
    });
    const finished = await reserve(worker.db, owned, 3, {
      idempotencyKey: `done-${userId}`,
      purpose: "rx",
      ttlSeconds: 60,
      now: new Date(Date.now() - 3_600_000),
    });
    await settle(worker.db, finished.reservation.id, 3);
    expect((await ledgerOf(userId)).balance).toBe(30 - 4 - 2 - 3);

    await sweepReservationsJob({}, { db: worker.db, logger });

    const status = async (id: string) => {
      const [row] = await owner.db
        .select({ status: creditReservations.status })
        .from(creditReservations)
        .where(eq(creditReservations.id, id));
      return row?.status;
    };
    expect(await status(crashed.reservation.id)).toBe("expired");
    expect(await status(live.reservation.id)).toBe("open");
    expect(await status(finished.reservation.id)).toBe("settled");

    const after = await ledgerOf(userId);
    // 30 granted, 2 still held for the live call, 3 spent on the settled one.
    expect(after.balance).toBe(30 - 2 - 3);
    expect(after.rows.reduce((sum, row) => sum + row.amount, 0)).toBe(after.balance);
  });
});
