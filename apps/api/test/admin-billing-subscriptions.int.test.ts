import { randomUUID } from "node:crypto";

import { subscriptionEvents, subscriptions } from "@wasfa/db";
import {
  adminSubscriptionListResponseSchema,
  type SubscriptionListQuery,
} from "@wasfa/shared/schemas/admin-billing-console";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, MISSING_ID, type Admin } from "./support/admin-context.js";
import {
  buyer,
  enableFakeCard,
  insertOrder,
  payWithFakeCard,
  planIdOf,
} from "./support/billing-console-fixtures.js";

/*
 * Subscriptions in the admin billing console (Task 3.8): the filtered list with its derived next
 * action, the detail with its timeline, and the three admin actions that need fresh
 * authentication, a reason and leave an audit trail.
 */

const ctx = new AdminTestContext();
let boss: Admin;

const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
  await enableFakeCard(ctx);
}, 180_000);

afterAll(async () => ctx.stop());

const get = (path: string) => ctx.harness.call("GET", path, { jar: boss.jar });
const post = (path: string, body: Record<string, unknown>, who: { jar: Admin["jar"] } = boss) =>
  ctx.harness.call("POST", path, { jar: who.jar, body });

interface SubscriptionSeed {
  name: string;
  planKey: string;
  status: "active" | "grace" | "expired";
  source?: "paid" | "admin_grant";
  endsInDays: number;
  createdAt: Date;
  cancelAtPeriodEnd?: boolean;
  pending?: boolean;
}

async function seed(input: SubscriptionSeed): Promise<{ id: string; userId: string }> {
  const userId = await ctx.insertUser({
    name: input.name,
    email: `${randomUUID().slice(0, 8)}@example.com`,
  });
  const order = await insertOrder(ctx, { ownerUserId: userId, subtotalMinor: 10_000 });
  const [row] = await ctx.owner.db
    .insert(subscriptions)
    .values({
      ownerUserId: userId,
      planId: await planIdOf(ctx, input.planKey),
      status: input.status,
      source: input.source ?? "paid",
      currentPeriodStart: inDays(input.endsInDays - 30),
      currentPeriodEnd: inDays(input.endsInDays),
      graceUntil: input.status === "grace" ? inDays(1) : null,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      lastOrderId: order.id,
      pendingChange: input.pending
        ? {
            planId: await planIdOf(ctx, "plus"),
            months: 1,
            orderId: order.id,
            effectiveAt: inDays(input.endsInDays).toISOString(),
          }
        : null,
      createdAt: input.createdAt,
    })
    .returning({ id: subscriptions.id });
  if (!row) throw new Error("subscription insert failed");
  return { id: row.id, userId };
}

describe("subscription list", () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    const base = Date.now() - 10 * DAY;
    const rows: SubscriptionSeed[] = [
      {
        name: "Renewing Rita",
        planKey: "plus",
        status: "active",
        endsInDays: 2,
        createdAt: new Date(base + 1),
      },
      {
        name: "Grace Gina",
        planKey: "plus",
        status: "grace",
        endsInDays: -1,
        createdAt: new Date(base + 2),
      },
      {
        name: "Leaving Lena",
        planKey: "pro",
        status: "active",
        endsInDays: 60,
        cancelAtPeriodEnd: true,
        createdAt: new Date(base + 3),
      },
      {
        name: "Downgrading Dina",
        planKey: "pro",
        status: "active",
        endsInDays: 20,
        pending: true,
        createdAt: new Date(base + 4),
      },
      {
        name: "Granted Gail",
        planKey: "plus",
        status: "active",
        source: "admin_grant",
        endsInDays: 2.5,
        createdAt: new Date(base + 5),
      },
      {
        name: "Expired Ella",
        planKey: "plus",
        status: "expired",
        endsInDays: -30,
        createdAt: new Date(base + 6),
      },
      {
        name: "Quiet Quinn",
        planKey: "pro",
        status: "active",
        endsInDays: 90,
        createdAt: new Date(base + 7),
      },
    ];
    for (const row of rows) ids[row.name.split(" ")[0] ?? row.name] = (await seed(row)).id;
  });

  const list = async (query: string) => {
    const response = await get(`/admin/billing/subscriptions?${query}`);
    expect(response.statusCode, response.body).toBe(200);
    return adminSubscriptionListResponseSchema.parse(response.json());
  };
  const idsOf = (page: { items: Array<{ id: string }> }) => page.items.map((item) => item.id);

  it("lists newest first with a masked owner and the derived next action", async () => {
    const page = await list("limit=100");
    expect(idsOf(page)).toEqual([
      ids.Quiet,
      ids.Expired,
      ids.Granted,
      ids.Downgrading,
      ids.Leaving,
      ids.Grace,
      ids.Renewing,
    ]);
    const action = (id: string | undefined) =>
      page.items.find((item) => item.id === id)?.nextAction;
    expect(action(ids.Renewing)).toBe("renewal_due");
    expect(action(ids.Grace)).toBe("grace");
    expect(action(ids.Leaving)).toBe("ends");
    expect(action(ids.Downgrading)).toBe("downgrade_scheduled");
    expect(action(ids.Granted)).toBe("ends");
    expect(action(ids.Expired)).toBe("none");
    expect(action(ids.Quiet)).toBe("none");
    expect(page.items.find((item) => item.id === ids.Renewing)).toMatchObject({
      owner: { type: "user", label: "R***" },
      planKey: "plus",
      status: "active",
      source: "paid",
      cancelAtPeriodEnd: false,
    });
    expect(JSON.stringify(page)).not.toContain("Rita");
    expect(JSON.stringify(page)).not.toContain("@example.com");
  });

  it("filters by status, plan, source and the expiry horizon", async () => {
    expect(idsOf(await list("status=grace"))).toEqual([ids.Grace]);
    expect(idsOf(await list("status=expired"))).toEqual([ids.Expired]);
    expect(idsOf(await list("planKey=pro"))).toEqual([ids.Quiet, ids.Downgrading, ids.Leaving]);
    expect(idsOf(await list("source=admin_grant"))).toEqual([ids.Granted]);
    // Only subscriptions that still give access and end inside the horizon.
    expect(idsOf(await list("expiringWithinDays=3"))).toEqual([ids.Granted, ids.Renewing]);
    expect(idsOf(await list("expiringWithinDays=1"))).toEqual([]);
    expect(idsOf(await list("expiringWithinDays=30"))).toEqual([
      ids.Granted,
      ids.Downgrading,
      ids.Renewing,
    ]);
  });

  it("pages with a keyset cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page: ReturnType<typeof adminSubscriptionListResponseSchema.parse> = await list(
        `limit=3${cursor ? `&cursor=${cursor}` : ""}`,
      );
      seen.push(...idsOf(page));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it("rejects bad filters", async () => {
    const bad: Array<Partial<Record<keyof SubscriptionListQuery, string>>> = [
      { status: "nope" },
      { source: "nope" },
      { expiringWithinDays: "0" },
      { cursor: "garbage" },
    ];
    for (const query of bad) {
      const response = await get(`/admin/billing/subscriptions?${new URLSearchParams(query)}`);
      expect(response.statusCode, JSON.stringify(query)).toBe(400);
    }
  });
});

describe("subscription detail and actions", () => {
  it("shows the timeline, entitlements, balance and recent orders of a bought subscription", async () => {
    const who = await buyer(ctx);
    const paid = await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const [row] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    const response = await get(`/admin/billing/subscriptions/${row?.id}`);
    expect(response.statusCode, response.body).toBe(200);
    const detail = response.json();
    expect(detail.subscription).toMatchObject({
      id: row?.id,
      planKey: "plus",
      status: "active",
      source: "paid",
      monthsPaid: 1,
      cancelAtPeriodEnd: false,
      pendingChange: null,
    });
    expect(detail.plan).toMatchObject({ key: "plus", monthlyCredits: 150 });
    expect(detail.creditBalance).toBe(150);
    expect(detail.owner).toMatchObject({ type: "user", id: who.userId });
    expect(detail.events.map((event: { type: string }) => event.type)).toContain("created");
    expect(detail.events[0]).toMatchObject({
      id: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(detail.entitlements.length).toBeGreaterThan(0);
    expect(detail.orders).toEqual([
      expect.objectContaining({ id: paid.orderId, status: "paid", totalMinor: paid.totalMinor }),
    ]);
    expect(response.body).not.toContain(who.email);
    expect((await get(`/admin/billing/subscriptions/${MISSING_ID}`)).statusCode).toBe(404);
  });

  it("extends by months or to a date, with fresh auth, a reason and an audit trail", async () => {
    const who = await buyer(ctx);
    await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const [row] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    const id = row?.id ?? "";
    const path = `/admin/billing/subscriptions/${id}/extend`;
    const endBefore = row?.currentPeriodEnd.getTime() ?? 0;

    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const needsReauth = await post(path, { months: 1, reason: "goodwill extension" }, stale);
    expect(needsReauth.statusCode).toBe(401);
    expect(needsReauth.json()).toMatchObject({ details: { reason: "reauth" } });

    for (const bad of [
      { months: 1 },
      { months: 1, reason: "no" },
      { months: 25, reason: "too long an extension" },
      { reason: "neither months nor date" },
      { months: 1, until: "2099-01-01", reason: "both given" },
      { until: "2001-01-01", reason: "a date in the past" },
      { until: "01/02/2030", reason: "not an ISO date" },
    ]) {
      const response = await post(path, bad);
      expect(response.statusCode, JSON.stringify(bad)).toBe(400);
    }

    const byMonths = await post(path, { months: 2, reason: "goodwill extension" });
    expect(byMonths.statusCode, byMonths.body).toBe(201);
    const afterMonths = new Date(byMonths.json().currentPeriodEnd).getTime();
    expect(afterMonths - endBefore).toBeGreaterThanOrEqual(58 * DAY);
    expect(afterMonths - endBefore).toBeLessThanOrEqual(62 * DAY);

    const until = new Date(afterMonths + 10 * DAY).toISOString().slice(0, 10);
    const byDate = await post(path, { until, reason: "agreed with the customer" });
    expect(byDate.statusCode, byDate.body).toBe(201);
    const afterDate = new Date(byDate.json().currentPeriodEnd).getTime();
    expect(afterDate).toBeGreaterThanOrEqual(new Date(`${until}T00:00:00.000Z`).getTime());
    expect(afterDate - afterMonths).toBeLessThanOrEqual(11 * DAY);

    const audits = await ctx.auditRowsFor("subscription.admin_extend", id);
    expect(audits).toHaveLength(2);
    expect(audits[1]?.after).toMatchObject({ months: 2, reason: "goodwill extension" });
    expect(audits[0]?.after).toMatchObject({ reason: "agreed with the customer" });
    expect(audits[0]?.actorId).toBe(boss.userId);
    const events = await ctx.owner.db
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, id));
    expect(events.filter((event) => event.type === "admin_changed")).toHaveLength(2);
    expect(events.at(-1)?.actorId).toBe(boss.userId);

    expect(
      (
        await post(`/admin/billing/subscriptions/${MISSING_ID}/extend`, {
          months: 1,
          reason: "no such one",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("cancels at period end and ends a subscription, each once", async () => {
    const who = await buyer(ctx);
    await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const [row] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    const id = row?.id ?? "";
    const cancelPath = `/admin/billing/subscriptions/${id}/cancel-at-period-end`;

    expect((await post(cancelPath, {})).statusCode).toBe(400);
    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    expect((await post(cancelPath, { reason: "customer asked" }, stale)).statusCode).toBe(401);

    const canceled = await post(cancelPath, { reason: "customer asked to stop" });
    expect(canceled.statusCode, canceled.body).toBe(201);
    expect(canceled.json()).toEqual({ id, cancelAtPeriodEnd: true });
    const listed = adminSubscriptionListResponseSchema.parse(
      (await get("/admin/billing/subscriptions?planKey=plus&status=active&limit=100")).json(),
    );
    expect(listed.items.find((item) => item.id === id)).toMatchObject({
      cancelAtPeriodEnd: true,
      nextAction: "ends",
    });
    expect(await ctx.auditRowsFor("subscription.cancel_at_period_end", id)).toHaveLength(1);

    const endPath = `/admin/billing/subscriptions/${id}/end`;
    expect((await post(endPath, {})).statusCode).toBe(400);
    expect((await post(endPath, { reason: "ok" })).statusCode).toBe(400);
    expect((await post(endPath, { reason: "fraud suspected" }, stale)).statusCode).toBe(401);
    const ended = await post(endPath, { reason: "fraud suspected on the account" });
    expect(ended.statusCode, ended.body).toBe(201);
    expect(ended.json()).toMatchObject({ id, status: "expired" });
    const [after] = await ctx.owner.db.select().from(subscriptions).where(eq(subscriptions.id, id));
    expect(after?.status).toBe("expired");
    const endAudit = await ctx.auditRowsFor("subscription.admin_end", id);
    expect(endAudit).toHaveLength(1);
    expect(endAudit[0]?.after).toMatchObject({ reason: "fraud suspected on the account" });

    // Nothing live is left to end, extend or cancel.
    const again = await post(endPath, { reason: "ending it a second time" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ details: { reason: "no_live_subscription" } });
    expect((await post(cancelPath, { reason: "cancel after the end" })).statusCode).toBe(409);
    expect(
      (
        await post(`/admin/billing/subscriptions/${id}/extend`, {
          months: 1,
          reason: "after the end",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("needs users.upgrade, not just billing.write", async () => {
    const who = await buyer(ctx);
    await payWithFakeCard(ctx, who, { planKey: "plus", months: 1 });
    const [row] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.ownerUserId, who.userId));
    const biller = await ctx.admin(await ctx.customRole(["billing.read", "billing.write"]));
    const response = await post(
      `/admin/billing/subscriptions/${row?.id}/end`,
      { reason: "should not be allowed" },
      biller,
    );
    expect(response.statusCode).toBe(403);
    const [still] = await ctx.owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, row?.id ?? ""));
    expect(still?.status).toBe("active");
  });
});
