import { describe, expect, it } from "vitest";

import { refundSubscriptionEffect, type Order, type Subscription } from "../src/index.js";

/*
 * The pure decision shared by the admin refund preview and the refund transaction: what a refund
 * does to the subscription the order bought. The transaction itself is covered in
 * subscriptions.int.test.ts; this pins the decision table.
 */

const ORDER_ID = "00000000-0000-7000-8000-0000000000a1";
const OTHER_ORDER_ID = "00000000-0000-7000-8000-0000000000b2";
const now = new Date("2026-03-15T12:00:00.000Z");

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    status: "active",
    currentPeriodStart: new Date("2026-01-15T12:00:00.000Z"),
    currentPeriodEnd: new Date("2026-05-15T12:00:00.000Z"),
    pendingChange: null,
    ...overrides,
  } as Subscription;
}

function order(overrides: Partial<Order> = {}): Order {
  return { id: ORDER_ID, months: 1, quote: {}, ...overrides } as Order;
}

describe("refundSubscriptionEffect", () => {
  it("leaves access alone for a partial refund", () => {
    const sub = subscription();
    expect(refundSubscriptionEffect(sub, order(), false, now)).toEqual({
      effect: "unchanged",
      newPeriodEnd: sub.currentPeriodEnd,
    });
  });

  it("leaves access alone when the order was a conflicting downgrade", () => {
    expect(
      refundSubscriptionEffect(subscription(), order(), true, now, { conflictingDowngrade: true }),
    ).toMatchObject({ effect: "unchanged" });
  });

  it.each(["expired", "canceled"] as const)("changes nothing on a %s subscription", (status) => {
    expect(refundSubscriptionEffect(subscription({ status }), order(), true, now)).toMatchObject({
      effect: "unchanged",
    });
  });

  it("takes the months of the order off the end of the period", () => {
    expect(refundSubscriptionEffect(subscription(), order({ months: 1 }), true, now)).toEqual({
      effect: "shortened",
      newPeriodEnd: new Date("2026-04-15T12:00:00.000Z"),
    });
  });

  it("counts bonus months granted by the quote", () => {
    // 1 paid + 1 free month: the end moves back two months to 2026-03-15, which is not after now.
    const result = refundSubscriptionEffect(
      subscription(),
      order({ months: 1, quote: { grants: { extraMonths: 1 } } }),
      true,
      now,
    );
    expect(result.effect).toBe("ends_now");
    const bonusKept = refundSubscriptionEffect(
      subscription({ currentPeriodEnd: new Date("2026-08-15T12:00:00.000Z") }),
      order({ months: 1, quote: { grants: { extraMonths: 1 } } }),
      true,
      now,
    );
    expect(bonusKept).toEqual({
      effect: "shortened",
      newPeriodEnd: new Date("2026-06-15T12:00:00.000Z"),
    });
  });

  it("ends the subscription now when nothing of the period would remain", () => {
    const sub = subscription({ currentPeriodEnd: new Date("2026-02-15T12:00:00.000Z") });
    expect(refundSubscriptionEffect(sub, order(), true, now)).toEqual({
      effect: "ends_now",
      newPeriodEnd: sub.currentPeriodEnd,
    });
    const long = subscription();
    expect(refundSubscriptionEffect(long, order({ months: 4 }), true, now)).toEqual({
      effect: "ends_now",
      newPeriodEnd: now,
    });
  });

  it("never ends a period at or before its own start", () => {
    const fresh = subscription({
      currentPeriodStart: new Date("2026-03-15T12:00:00.000Z"),
      currentPeriodEnd: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(refundSubscriptionEffect(fresh, order(), true, now)).toEqual({
      effect: "ends_now",
      newPeriodEnd: new Date(now.getTime() + 1),
    });
  });

  it("only removes the scheduled downgrade when the refunded order bought it", () => {
    const pending = {
      planId: "00000000-0000-7000-8000-0000000000c3",
      months: 1,
      orderId: ORDER_ID,
      effectiveAt: "2026-05-15T12:00:00.000Z",
    };
    const sub = subscription({ pendingChange: pending });
    expect(refundSubscriptionEffect(sub, order(), true, now)).toEqual({
      effect: "downgrade_removed",
      newPeriodEnd: sub.currentPeriodEnd,
    });
    // A different order's downgrade is not this refund's business: the months come off instead.
    const other = subscription({ pendingChange: { ...pending, orderId: OTHER_ORDER_ID } });
    expect(refundSubscriptionEffect(other, order(), true, now)).toMatchObject({
      effect: "shortened",
    });
  });
});
