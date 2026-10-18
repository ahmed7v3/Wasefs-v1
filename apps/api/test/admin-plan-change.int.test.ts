import { randomUUID } from "node:crypto";

import {
  creditLedger,
  orders,
  outbox,
  payments,
  planAssignments,
  plans,
  subscriptionEvents,
  subscriptions,
  userNotifications,
} from "@wasfa/db";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AdminTestContext, type Admin } from "./support/admin-context.js";

/*
 * The upgrade / change-plan dialog (ADMIN-CONSOLE-SPEC §8.3): preview equals the outcome, each kind
 * makes the right subscription, assignment, event and notice, paid-offline books real revenue
 * through the normal activation, and money-sized changes need a fresh sign-in.
 */

const ctx = new AdminTestContext();
const db = () => ctx.owner.db;
let boss: Admin;

beforeAll(async () => {
  await ctx.start();
  boss = await ctx.admin("super_admin");
}, 240_000);

afterAll(async () => {
  await ctx.stop();
});

const change = (userId: string, body: Record<string, unknown>, who: Admin = boss) =>
  ctx.harness.call("POST", `/admin/users/${userId}/plan-change`, {
    jar: who.jar,
    body: { requestId: randomUUID(), reason: "support compensation", ...body },
  });
const preview = (userId: string, body: Record<string, unknown>) =>
  ctx.harness.call("POST", `/admin/users/${userId}/plan-change/preview`, {
    jar: boss.jar,
    body: { reason: "support compensation", ...body },
  });

async function liveOf(userId: string) {
  const [row] = await db()
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ownerUserId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row;
}

describe("gift and compensation", () => {
  it("previews then applies: subscription, open assignment, event, bell notice and extra credits", async () => {
    const user = await ctx.harness.signedInUser();
    const body = { planKey: "pro", duration: { months: 3 }, kind: "gift", extraCredits: 40 };
    const shown = await preview(user.userId, body);
    expect(shown.statusCode, shown.body).toBe(200);
    expect(shown.json()).toMatchObject({ effect: "replace", blocked: null, credits: { extra: 40 } });

    const applied = await change(user.userId, body);
    expect(applied.statusCode, applied.body).toBe(200);
    const live = await liveOf(user.userId);
    expect(live).toMatchObject({ status: "active", source: "admin_grant" });
    // Preview and apply each read the clock: the same period, a few milliseconds apart.
    const previewed = Date.parse(shown.json().newExpiry as string);
    expect(Math.abs((live?.currentPeriodEnd.getTime() ?? 0) - previewed)).toBeLessThan(60_000);

    const [assignment] = await db()
      .select()
      .from(planAssignments)
      .where(eq(planAssignments.subscriptionId, live?.id ?? ""));
    expect(assignment?.endsAt?.toISOString()).toBe(live?.currentPeriodEnd.toISOString());
    const events = await db()
      .select()
      .from(subscriptionEvents)
      .where(eq(subscriptionEvents.subscriptionId, live?.id ?? ""));
    expect(events.length).toBeGreaterThan(0);
    const [notice] = await db()
      .select()
      .from(userNotifications)
      .where(and(eq(userNotifications.userId, user.userId), eq(userNotifications.kind, "subscription.admin_changed")));
    expect(notice).toBeDefined();
    const extra = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.reason, "plan_change:gift"));
    expect(extra.some((row) => row.amount === 40)).toBe(true);
    expect(await ctx.auditRowsFor("user.plan_change", user.userId)).toHaveLength(1);
  });

  it("never lets a gift replace something the customer paid for", async () => {
    const user = await ctx.harness.signedInUser();
    const [plus] = await db().select().from(plans).where(eq(plans.key, "plus"));
    if (!plus) throw new Error("plan missing");
    await db()
      .insert(subscriptions)
      .values({
        ownerUserId: user.userId,
        planId: plus.id,
        status: "active",
        source: "paid",
        currentPeriodStart: new Date(Date.now() - 86_400_000),
        currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000),
      });
    const refused = await change(user.userId, { planKey: "pro", duration: { months: 1 }, kind: "compensation" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().details).toMatchObject({ reason: "paid_subscription_live" });
  });

  it("is idempotent per request id", async () => {
    const user = await ctx.harness.signedInUser();
    const requestId = randomUUID();
    const body = { planKey: "plus", duration: { months: 1 }, kind: "gift", requestId };
    expect((await change(user.userId, body)).statusCode).toBe(200);
    const again = await change(user.userId, body);
    expect(again.json()).toMatchObject({ replayed: true });
    const rows = await db().select().from(subscriptions).where(eq(subscriptions.ownerUserId, user.userId));
    expect(rows).toHaveLength(1);
  });
});

describe("paid offline", () => {
  it("records a paid order and an approved manual payment through the normal activation", async () => {
    const user = await ctx.harness.signedInUser();
    const res = await change(user.userId, {
      planKey: "plus",
      duration: { months: 1 },
      kind: "paid_offline",
      paidOffline: { amountMinor: 9_900, currency: "EGP", methodKey: "instapay", reference: `TX-${randomUUID().slice(0, 8)}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const [order] = await db().select().from(orders).where(eq(orders.ownerUserId, user.userId));
    expect(order).toMatchObject({ status: "paid", totalMinor: 9_900, currency: "EGP" });
    expect(order?.paidAt).not.toBeNull();
    const [payment] = await db().select().from(payments).where(eq(payments.orderId, order?.id ?? ""));
    expect(payment).toMatchObject({ status: "succeeded", methodKey: "instapay", reviewedBy: boss.userId });
    expect((await liveOf(user.userId))?.source).toBe("paid");
    // The receipt rides the normal paid-order outbox entry.
    const [entry] = await db().select().from(outbox).where(eq(outbox.idempotencyKey, `order_paid:${order?.id}`));
    expect(entry).toBeDefined();
    // And the receipt shows the plan line.
    const receipt = await ctx.harness.call("GET", `/me/orders/${order?.id}/receipt`, { jar: user.jar });
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect(receipt.json().lines).toEqual([{ kind: "plan", labelKey: "billing.line.plan", amountMinor: 9_900 }]);
  });

  it("needs a fresh sign-in, and refuses a reused transfer reference", async () => {
    const user = await ctx.harness.signedInUser();
    const reference = `TX-${randomUUID().slice(0, 8)}`;
    const body = {
      planKey: "plus",
      duration: { months: 1 },
      kind: "paid_offline",
      paidOffline: { amountMinor: 9_900, currency: "EGP", methodKey: "instapay", reference },
    };
    const stale = await ctx.admin("super_admin");
    await ctx.makeSessionStale(stale.userId);
    const refused = await change(user.userId, body, stale);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().details).toMatchObject({ reason: "reauth" });

    expect((await change(user.userId, body)).statusCode).toBe(200);
    const other = await ctx.harness.signedInUser();
    const duplicate = await change(other.userId, body);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().details).toMatchObject({ reason: "duplicate_reference" });
  });
});

describe("permissions", () => {
  it("needs users.upgrade", async () => {
    const roleKey = await ctx.roleLacking("users.upgrade");
    const lacking = await ctx.admin(roleKey);
    const user = await ctx.harness.signedInUser();
    expect(
      (await change(user.userId, { planKey: "plus", duration: { months: 1 }, kind: "gift" }, lacking)).statusCode,
    ).toBe(403);
  });
});
