import { describe, expect, it } from "vitest";

import { ENDING_SOON_DAYS, planTimeline } from "../src/components/billing/plan-details";

import type { SubscriptionView } from "@wasfa/shared/schemas/subscriptions";

const subscription = (overrides: Partial<SubscriptionView> = {}): SubscriptionView => ({
  id: "00000000-0000-4000-8000-000000000001",
  plan: { key: "plus", nameAr: "بلس", nameEn: "Plus" },
  status: "active",
  source: "paid",
  currentPeriodStart: "2026-10-01T00:00:00.000Z",
  currentPeriodEnd: "2026-10-31T00:00:00.000Z",
  monthsPaid: 1,
  cancelAtPeriodEnd: false,
  graceUntil: null,
  pendingChange: null,
  nextCreditGrantAt: null,
  ...overrides,
});

describe("planTimeline", () => {
  it("counts whole days left (rounded up) and the share of the period used", () => {
    const timeline = planTimeline(subscription(), new Date("2026-10-16T00:00:00.000Z"));
    expect(timeline.daysLeft).toBe(15);
    expect(timeline.elapsedPercent).toBe(50);
    expect(timeline.endingSoon).toBe(false);
    expect(planTimeline(subscription(), new Date("2026-10-30T23:00:00.000Z")).daysLeft).toBe(1);
  });

  it(`says the plan is ending in its last ${String(ENDING_SOON_DAYS)} days and stops at zero`, () => {
    expect(planTimeline(subscription(), new Date("2026-10-24T00:00:00.000Z")).endingSoon).toBe(
      true,
    );
    const after = planTimeline(subscription(), new Date("2026-11-05T00:00:00.000Z"));
    expect(after.daysLeft).toBe(0);
    expect(after.elapsedPercent).toBe(100);
  });

  it("counts to the grace deadline while in grace", () => {
    const timeline = planTimeline(
      subscription({ status: "grace", graceUntil: "2026-11-03T00:00:00.000Z" }),
      new Date("2026-11-01T00:00:00.000Z"),
    );
    expect(timeline.endsAt.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(timeline.daysLeft).toBe(2);
    expect(timeline.endingSoon).toBe(true);
  });
});
