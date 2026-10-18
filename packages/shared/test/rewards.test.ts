import { describe, expect, it } from "vitest";

import {
  REWARD_EVENTS,
  creditsForPoints,
  initialsOf,
  isReservedReferralCode,
  rewardEventOfReason,
} from "../src/rewards.js";
import { rewardsSettingsSchema } from "../src/settings.js";

describe("creditsForPoints", () => {
  it("is points / pointsPerCredit plus the bonus, rounded down, in integers", () => {
    // 5 points per credit and +20 percent: 500 points = 100 credits + 20.
    expect(creditsForPoints(500, 5, 2_000)).toBe(120);
    expect(creditsForPoints(5, 5, 2_000)).toBe(1);
    expect(creditsForPoints(4, 5, 2_000)).toBe(0);
    expect(creditsForPoints(7, 5, 0)).toBe(1);
    expect(creditsForPoints(1_000_000, 3, 10_000)).toBe(666_666);
  });

  it("gives nothing for amounts that are not positive integers", () => {
    expect(creditsForPoints(0, 5, 2_000)).toBe(0);
    expect(creditsForPoints(-5, 5, 2_000)).toBe(0);
    expect(creditsForPoints(2.5, 5, 2_000)).toBe(0);
  });
});

describe("initialsOf", () => {
  it("keeps the first letter of the first and last name only", () => {
    expect(initialsOf("محمد أحمد")).toBe("م. أ.");
    expect(initialsOf("Omar Friend")).toBe("O. F.");
    expect(initialsOf("  omar   ali   hassan ")).toBe("O. H.");
    expect(initialsOf("Mona")).toBe("M.");
    expect(initialsOf("   ")).toBe("");
  });
});

describe("isReservedReferralCode", () => {
  it("refuses brand, role and abusive words, whole or inside a longer code", () => {
    for (const code of ["WASFA", "wasfa2026", "ADMIN", "MYADMIN1", "SUPPORT", "support24"]) {
      expect(isReservedReferralCode(code), code).toBe(true);
    }
    for (const code of ["DRAHMED", "PHARMA7", "ABC", "KIND"]) {
      expect(isReservedReferralCode(code), code).toBe(false);
    }
  });
});

describe("rewardEventOfReason", () => {
  it("reads the event of pending, release and reversal reasons", () => {
    expect(rewardEventOfReason("first_payment:cash_or_credits")).toBe("first_payment");
    expect(rewardEventOfReason("refund:renewal:cash_or_credits")).toBe("renewal");
    expect(rewardEventOfReason("void:referee_verified:credits_only")).toBe("referee_verified");
    expect(rewardEventOfReason("points_conversion")).toBeNull();
    expect(rewardEventOfReason(null)).toBeNull();
    for (const event of REWARD_EVENTS) expect(rewardEventOfReason(`${event}:credits_only`)).toBe(event);
  });
});

describe("rewards settings", () => {
  it("defaults the referee coupon to 10 percent for 30 days", () => {
    const settings = rewardsSettingsSchema.parse({});
    expect(settings.refereeFirstPaymentDiscountBps).toBe(1_000);
    expect(settings.refereeCouponValidDays).toBe(30);
    expect(settings.enabled).toBe(false);
  });
});
