import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  mulBpsHalfUp,
  quote,
  type DiscountDef,
  type PriceQuote,
  type QuoteInput,
} from "../src/price-engine.js";

const NOW = "2026-06-15T12:00:00.000Z";

function input(overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    price: { planKey: "plus", months: 1, currency: "EGP", amountMinor: 10000 },
    discounts: [],
    methods: [],
    history: { isFirstPurchase: false },
    settings: {
      maxTotalDiscountBps: 7000,
      minChargeMinor: 0,
      minChargeMode: "raise",
      allowFreeOrders: true,
      quoteTtlMinutes: 15,
      creditValueMinor: 50,
    },
    now: NOW,
    ...overrides,
  };
}

function discount(overrides: Partial<DiscountDef> & Pick<DiscountDef, "id">): DiscountDef {
  return {
    source: "promotion",
    kind: "percent",
    valueBps: 1000,
    scope: {},
    stacking: "exclusive",
    priority: 0,
    ...overrides,
  };
}

function ok(i: QuoteInput): PriceQuote {
  const result = quote(i);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result.quote;
}

function code(i: QuoteInput): string | undefined {
  const result = quote(i);
  return result.ok ? undefined : result.code;
}

describe("mulBpsHalfUp", () => {
  it("rounds half-up at the 0.5 boundary", () => {
    expect(mulBpsHalfUp(5, 1000)).toBe(1); // 0.5
    expect(mulBpsHalfUp(4, 1000)).toBe(0); // 0.4
    expect(mulBpsHalfUp(15, 1000)).toBe(2); // 1.5
    expect(mulBpsHalfUp(14, 1000)).toBe(1); // 1.4
    expect(mulBpsHalfUp(0, 5000)).toBe(0);
  });
  it("does not overflow on large amounts", () => {
    expect(mulBpsHalfUp(Number.MAX_SAFE_INTEGER, 10000)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("list price", () => {
  it("returns the list price as a single plan line", () => {
    const q = ok(input());
    expect(q.listPriceMinor).toBe(10000);
    expect(q.subtotalMinor).toBe(10000);
    expect(q.totalMinor).toBe(10000);
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({
      kind: "plan",
      labelKey: "billing.line.plan",
      amountMinor: 10000,
    });
    expect(q.display.struckMinor).toBeNull();
    expect(q.methodKey).toBeNull();
    expect(q.quoteVersion).toBe(1);
  });
  it("fails when the price is missing", () => {
    expect(code(input({ price: null }))).toBe("PRICE_NOT_AVAILABLE");
  });
  it("sets expiresAt from the TTL and now", () => {
    expect(ok(input()).expiresAt).toBe("2026-06-15T12:15:00.000Z");
  });
  it("computes perMonthMinor", () => {
    const q = ok(
      input({ price: { planKey: "plus", months: 3, currency: "EGP", amountMinor: 10000 } }),
    );
    expect(q.display.perMonthMinor).toBe(3333);
  });
});

describe("deal", () => {
  it("a fixed deal replaces the base", () => {
    const q = ok(
      input({
        deal: {
          id: "d1",
          pricing: { mode: "fixed", amountMinor: 6000, currency: "EGP" },
          stackWithPromotions: true,
          stackWithCoupons: true,
        },
      }),
    );
    expect(q.subtotalMinor).toBe(6000);
    expect(q.applied.dealId).toBe("d1");
    expect(q.lines[1]).toMatchObject({
      kind: "discount",
      labelKey: "billing.line.deal",
      amountMinor: -4000,
    });
    expect(q.display.struckMinor).toBe(10000);
    expect(q.display.savingsMinor).toBe(4000);
    expect(q.display.savingsBps).toBe(4000);
  });
  it("ignores a fixed deal in another currency", () => {
    const q = ok(
      input({
        deal: {
          id: "d1",
          pricing: { mode: "fixed", amountMinor: 6000, currency: "SAR" },
          stackWithPromotions: true,
          stackWithCoupons: true,
        },
      }),
    );
    expect(q.subtotalMinor).toBe(10000);
    expect(q.applied.dealId).toBeUndefined();
  });
  it("a percent_off deal reduces the base", () => {
    const q = ok(
      input({
        deal: {
          id: "d2",
          pricing: { mode: "percent_off", bps: 2500 },
          stackWithPromotions: true,
          stackWithCoupons: true,
        },
      }),
    );
    expect(q.subtotalMinor).toBe(7500);
  });
  it("never goes below min(list, minCharge)", () => {
    const base = input();
    const q = ok({
      ...base,
      settings: { ...base.settings, minChargeMinor: 2000 },
      deal: {
        id: "d3",
        pricing: { mode: "percent_off", bps: 10000 },
        stackWithPromotions: true,
        stackWithCoupons: true,
      },
    });
    expect(q.subtotalMinor).toBe(2000);
    const cheap = ok({
      ...base,
      price: { planKey: "plus", months: 1, currency: "EGP", amountMinor: 1500 },
      settings: { ...base.settings, minChargeMinor: 2000 },
      deal: {
        id: "d3",
        pricing: { mode: "percent_off", bps: 10000 },
        stackWithPromotions: true,
        stackWithCoupons: true,
      },
    });
    expect(cheap.applied.dealId).toBeUndefined(); // floor = min(list, minCharge) = list
  });
  it("excludes promotions and coupons the deal disallows", () => {
    const deal = {
      id: "d4",
      pricing: { mode: "percent_off" as const, bps: 1000 },
      stackWithPromotions: false,
      stackWithCoupons: true,
    };
    const discounts = [
      discount({ id: "p", source: "promotion", valueBps: 5000 }),
      discount({ id: "c", source: "coupon", valueBps: 2000 }),
    ];
    const q = ok(input({ deal, discounts }));
    expect(q.applied.promotionId).toBeUndefined();
    expect(q.applied.couponId).toBe("c");
    expect(q.subtotalMinor).toBe(7200); // 9000 - 20%
    const blocked = ok(input({ deal: { ...deal, stackWithCoupons: false }, discounts }));
    expect(blocked.subtotalMinor).toBe(9000);
  });
});

describe("discount kinds", () => {
  it("percent", () => {
    const q = ok(input({ discounts: [discount({ id: "a", valueBps: 2000 })] }));
    expect(q.subtotalMinor).toBe(8000);
    expect(q.lines[1]).toMatchObject({
      kind: "discount",
      labelKey: "billing.line.promotion",
      amountMinor: -2000,
    });
    expect(q.applied.promotionId).toBe("a");
  });
  it("fixed uses the currency amount and is capped at the base", () => {
    const d = discount({
      id: "f",
      kind: "fixed",
      valueBps: undefined,
      amountsMinor: { EGP: 3000, SAR: 100 },
    });
    expect(ok(input({ discounts: [d] })).subtotalMinor).toBe(7000);
    const big = discount({
      id: "f",
      kind: "fixed",
      valueBps: undefined,
      amountsMinor: { EGP: 99999 },
    });
    // A lone discount is not capped by maxTotalDiscountBps: it stops at the base (free order).
    expect(ok(input({ discounts: [big] })).subtotalMinor).toBe(0);
  });
  it("fixed without an amount in the currency is ineligible", () => {
    const d = discount({ id: "f", kind: "fixed", valueBps: undefined, amountsMinor: { SAR: 100 } });
    expect(ok(input({ discounts: [d] })).subtotalMinor).toBe(10000);
  });
  it("bonus_credits goes to grants with a zero bonus line", () => {
    const d = discount({ id: "b", kind: "bonus_credits", valueBps: undefined, credits: 30 });
    const q = ok(input({ discounts: [d] }));
    expect(q.grants).toEqual({ bonusCredits: 30, extraMonths: 0 });
    expect(q.subtotalMinor).toBe(10000);
    expect(q.lines[1]).toMatchObject({
      kind: "bonus",
      labelKey: "billing.line.bonusCredits",
      amountMinor: 0,
    });
  });
  it("bonus_credits has no saving without a credit value", () => {
    const base = input();
    const d = discount({ id: "b", kind: "bonus_credits", valueBps: undefined, credits: 30 });
    const q = ok({
      ...base,
      discounts: [d],
      settings: { ...base.settings, creditValueMinor: undefined },
    });
    expect(q.grants.bonusCredits).toBe(0);
    expect(q.lines).toHaveLength(1);
  });
  it("extra_months goes to grants", () => {
    const d = discount({ id: "e", kind: "extra_months", valueBps: undefined, months: 2 });
    const q = ok(input({ discounts: [d] }));
    expect(q.grants).toEqual({ bonusCredits: 0, extraMonths: 2 });
    expect(q.lines[1]).toMatchObject({
      kind: "bonus",
      labelKey: "billing.line.extraMonths",
      amountMinor: 0,
    });
  });
  it("a zero-saving discount is not applied", () => {
    const q = ok(input({ discounts: [discount({ id: "z", valueBps: 0 })] }));
    expect(q.applied).toEqual({});
    expect(q.lines).toHaveLength(1);
  });
  it("labels by source", () => {
    const c = ok(input({ discounts: [discount({ id: "c", source: "coupon" })] }));
    expect(c.lines[1]?.labelKey).toBe("billing.line.coupon");
    expect(c.applied.couponId).toBe("c");
    const p = ok(input({ discounts: [discount({ id: "o", source: "personal_offer" })] }));
    expect(p.lines[1]?.labelKey).toBe("billing.line.personalOffer");
    expect(p.applied.personalOfferId).toBe("o");
  });
});

describe("eligibility", () => {
  const d = (scope: DiscountDef["scope"], extra: Partial<DiscountDef> = {}) =>
    discount({ id: "x", valueBps: 5000, scope, ...extra });
  const subtotal = (i: QuoteInput) => ok(i).subtotalMinor;

  it("dates: before start, at start, before end, at end", () => {
    expect(subtotal(input({ discounts: [d({}, { startsAt: "2026-06-16T00:00:00Z" })] }))).toBe(
      10000,
    );
    expect(subtotal(input({ discounts: [d({}, { startsAt: NOW })] }))).toBe(5000);
    expect(subtotal(input({ discounts: [d({}, { endsAt: "2026-06-15T12:00:01Z" })] }))).toBe(5000);
    expect(subtotal(input({ discounts: [d({}, { endsAt: NOW })] }))).toBe(10000);
  });
  it("plan keys", () => {
    expect(subtotal(input({ discounts: [d({ planKeys: ["pro"] })] }))).toBe(10000);
    expect(subtotal(input({ discounts: [d({ planKeys: ["plus"] })] }))).toBe(5000);
  });
  it("months", () => {
    expect(subtotal(input({ discounts: [d({ months: [12] })] }))).toBe(10000);
    expect(subtotal(input({ discounts: [d({ months: [1, 12] })] }))).toBe(5000);
  });
  it("countries (case-insensitive; required when scoped)", () => {
    expect(subtotal(input({ discounts: [d({ countries: ["EG"] })] }))).toBe(10000);
    expect(subtotal(input({ discounts: [d({ countries: ["EG"] })], country: "SA" }))).toBe(10000);
    expect(subtotal(input({ discounts: [d({ countries: ["EG"] })], country: "eg" }))).toBe(5000);
  });
  it("new customers only", () => {
    const scoped = [d({ newCustomersOnly: true })];
    expect(subtotal(input({ discounts: scoped }))).toBe(10000);
    expect(subtotal(input({ discounts: scoped, history: { isFirstPurchase: true } }))).toBe(5000);
  });
  it("min amount is checked against the base", () => {
    expect(subtotal(input({ discounts: [d({ minAmountMinor: 10001 })] }))).toBe(10000);
    expect(subtotal(input({ discounts: [d({ minAmountMinor: 10000 })] }))).toBe(5000);
  });
});

describe("best-of and tie-breaks", () => {
  it("picks the single largest saving", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "small", valueBps: 1000 }),
          discount({ id: "big", valueBps: 3000, source: "coupon" }),
          discount({ id: "mid", valueBps: 2000 }),
        ],
      }),
    );
    expect(q.subtotalMinor).toBe(7000);
    expect(q.applied).toEqual({ couponId: "big" });
  });
  it("a fixed discount can beat a percentage", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "pct", valueBps: 1000 }),
          discount({ id: "fix", kind: "fixed", valueBps: undefined, amountsMinor: { EGP: 2500 } }),
        ],
      }),
    );
    expect(q.applied.promotionId).toBe("fix");
    expect(q.subtotalMinor).toBe(7500);
  });
  it("tie: coupon, then personal offer, then promotion", () => {
    const all = [
      discount({ id: "a", source: "promotion" }),
      discount({ id: "b", source: "personal_offer" }),
      discount({ id: "c", source: "coupon" }),
    ];
    expect(ok(input({ discounts: all })).applied).toEqual({ couponId: "c" });
    expect(ok(input({ discounts: all.slice(0, 2) })).applied).toEqual({ personalOfferId: "b" });
  });
  it("tie: higher priority, then smaller id", () => {
    const byPriority = ok(
      input({
        discounts: [discount({ id: "a", priority: 1 }), discount({ id: "b", priority: 5 })],
      }),
    );
    expect(byPriority.applied.promotionId).toBe("b");
    const byId = ok(input({ discounts: [discount({ id: "b" }), discount({ id: "a" })] }));
    expect(byId.applied.promotionId).toBe("a");
  });
  it("is independent of input order", () => {
    const list = [
      discount({ id: "a" }),
      discount({ id: "b" }),
      discount({ id: "c", source: "coupon" }),
    ];
    const forward = canonicalJson(ok(input({ discounts: list })));
    const backward = canonicalJson(ok(input({ discounts: [...list].reverse() })));
    expect(forward).toBe(backward);
  });
});

describe("stacking and cap", () => {
  it("combines two stackable discounts sequentially (promotion + coupon)", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "p", valueBps: 2000, stacking: "stack_with_other" }),
          discount({ id: "c", source: "coupon", valueBps: 1000, stacking: "stack_with_other" }),
        ],
      }),
    );
    // Coupon ranks first on a tie only; here promo saves more: 2000 then 10% of 8000 = 800.
    expect(q.subtotalMinor).toBe(7200);
    expect(q.applied).toEqual({ promotionId: "p", couponId: "c" });
  });
  it("an exclusive winner does not combine", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "p", valueBps: 3000, stacking: "exclusive" }),
          discount({ id: "c", source: "coupon", valueBps: 1000, stacking: "stack_with_other" }),
        ],
      }),
    );
    expect(q.subtotalMinor).toBe(7000);
    expect(q.applied).toEqual({ promotionId: "p" });
  });
  it("an exclusive loser is left out of the stack", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "p", valueBps: 3000, stacking: "stack_with_other" }),
          discount({ id: "x", valueBps: 2000, stacking: "exclusive" }),
          discount({ id: "c", source: "coupon", valueBps: 1000, stacking: "stack_with_other" }),
        ],
      }),
    );
    expect(q.subtotalMinor).toBe(6300); // 10000 -3000 -700
  });
  it("at most one coupon in a stack", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "c1", source: "coupon", valueBps: 1000, stacking: "stack_with_other" }),
          discount({ id: "c2", source: "coupon", valueBps: 500, stacking: "stack_with_other" }),
        ],
      }),
    );
    expect(q.applied.couponId).toBe("c1");
    expect(q.subtotalMinor).toBe(9000);
  });
  it("caps the total monetary discount at maxTotalDiscountBps of the base", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "p", valueBps: 5000, stacking: "stack_with_other" }),
          discount({ id: "c", source: "coupon", valueBps: 5000, stacking: "stack_with_other" }),
        ],
      }),
    );
    // 5000 + 2500 = 7500 > cap 7000.
    expect(q.subtotalMinor).toBe(3000);
    expect(
      q.lines.filter((l) => l.kind === "discount").reduce((s, l) => s + l.amountMinor, 0),
    ).toBe(-7000);
  });
  it("stacks non-monetary benefits with a monetary one", () => {
    const q = ok(
      input({
        discounts: [
          discount({ id: "p", valueBps: 2000, stacking: "stack_with_other" }),
          discount({
            id: "b",
            kind: "bonus_credits",
            valueBps: undefined,
            credits: 10,
            stacking: "stack_with_other",
          }),
        ],
      }),
    );
    expect(q.subtotalMinor).toBe(8000);
    expect(q.grants.bonusCredits).toBe(10);
  });
});

describe("proration", () => {
  const upgrade = (overrides: Partial<NonNullable<QuoteInput["history"]["upgradeFrom"]>> = {}) =>
    input({
      history: {
        isFirstPurchase: false,
        upgradeFrom: {
          periodStart: "2026-06-01T12:00:00.000Z",
          periodEnd: "2026-07-01T12:00:00.000Z",
          lastPaidNetMinor: 3000,
          currency: "EGP",
          ...overrides,
        },
      },
    });
  it("credits daily value times remaining days", () => {
    // 30 total days, 16 remaining, daily 100 -> 1600
    const q = ok(upgrade());
    expect(q.lines.find((l) => l.kind === "proration")).toMatchObject({
      labelKey: "billing.line.proration",
      amountMinor: -1600,
    });
    expect(q.subtotalMinor).toBe(8400);
  });
  it("floors the daily value and rounds remaining days up", () => {
    const q = ok(upgrade({ lastPaidNetMinor: 3010, periodEnd: "2026-07-01T12:00:01.000Z" }));
    // total ceil(30.00001)=31 -> daily floor(97.09)=97; remaining ceil(16.00001)=17 -> 1649
    expect(q.subtotalMinor).toBe(10000 - 1649);
  });
  it("is capped at the discounted price", () => {
    const q = ok(upgrade({ lastPaidNetMinor: 3_000_000 }));
    expect(q.subtotalMinor).toBe(0);
    expect(q.isFreeOrder).toBe(true);
  });
  it("gives nothing when the period has ended", () => {
    const q = ok(upgrade({ periodEnd: "2026-06-15T12:00:00.000Z" }));
    expect(q.subtotalMinor).toBe(10000);
    expect(q.lines.some((l) => l.kind === "proration")).toBe(false);
  });
  it("ignores a different currency", () => {
    expect(ok(upgrade({ currency: "SAR" })).subtotalMinor).toBe(10000);
  });
  it("caps against the discounted price", () => {
    const base = upgrade({ lastPaidNetMinor: 3_000_000 });
    const q = ok({ ...base, discounts: [discount({ id: "p", valueBps: 2000 })] });
    expect(q.lines.find((l) => l.kind === "proration")?.amountMinor).toBe(-8000);
  });
});

describe("minimum charge and free orders", () => {
  const withMin = (mode: "raise" | "refuse", amountMinor: number, allowFree = true) => {
    const base = input();
    return {
      ...base,
      price: { planKey: "plus", months: 1, currency: "EGP", amountMinor },
      settings: {
        ...base.settings,
        minChargeMinor: 1000,
        minChargeMode: mode,
        allowFreeOrders: allowFree,
      },
    };
  };
  it("raises with an adjustment line", () => {
    const q = ok(withMin("raise", 400));
    expect(q.subtotalMinor).toBe(1000);
    expect(q.lines.find((l) => l.kind === "adjustment")).toMatchObject({
      labelKey: "billing.line.minimumCharge",
      amountMinor: 600,
    });
    expect(q.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(q.totalMinor);
  });
  it("refuses", () => {
    expect(code(withMin("refuse", 400))).toBe("BELOW_MINIMUM");
  });
  it("leaves an amount at the minimum alone", () => {
    expect(ok(withMin("refuse", 1000)).subtotalMinor).toBe(1000);
  });
  it("allows a free order", () => {
    const q = ok(withMin("refuse", 0));
    expect(q.isFreeOrder).toBe(true);
    expect(q.totalMinor).toBe(0);
  });
  it("refuses a free order when not allowed", () => {
    expect(code(withMin("raise", 0, false))).toBe("FREE_ORDER_NOT_ALLOWED");
  });
  it("a free order has no fee even with a method", () => {
    const i = withMin("raise", 0);
    const q = ok({
      ...i,
      methodKey: "k",
      methods: [{ key: "k", feeBps: 300, feeFixedMinor: 200 }],
    });
    expect(q.feeMinor).toBe(0);
    expect(q.totalMinor).toBe(0);
    expect(q.methodOptions[0]).toMatchObject({ feeMinor: 0, totalMinor: 0, available: true });
  });
});

describe("tax", () => {
  it("added tax is rounded half-up and charged on top", () => {
    const q = ok(
      input({
        price: { planKey: "plus", months: 1, currency: "EGP", amountMinor: 1710 },
        taxRule: { id: "t", rateBps: 1500, mode: "added" },
      }),
    ); // 256.5 -> 257
    expect(q.taxAddedMinor).toBe(257);
    expect(q.taxMinor).toBe(257);
    expect(q.taxMode).toBe("added");
    expect(q.totalMinor).toBe(1967);
    expect(q.lines.find((l) => l.kind === "tax")?.amountMinor).toBe(257);
    expect(q.display.feeLine).toEqual({
      amountMinor: 257,
      show: true,
      items: [
        { kind: "tax", amountMinor: 257 },
        { kind: "fee", amountMinor: 0 },
      ],
    });
  });
  it("inclusive tax is extracted for display only", () => {
    const q = ok(input({ taxRule: { id: "t", rateBps: 1400, mode: "inclusive" } }));
    // 10000*14/114 = 1228.07
    expect(q.taxMinor).toBe(1228);
    expect(q.taxIncludedMinor).toBe(1228);
    expect(q.taxAddedMinor).toBe(0);
    expect(q.totalMinor).toBe(10000);
    expect(q.lines.find((l) => l.kind === "tax")).toMatchObject({
      amountMinor: 0,
      meta: { inclusive: true, includedMinor: 1228 },
    });
    expect(q.display.feeLine.show).toBe(false);
  });
  it("inclusive tax rounds half-up", () => {
    // 115 * 1500 / 11500 = 15 exactly; 23 * 1500/11500 = 3.0; use 1 * 5000/15000 = 0.333 -> 0, 3*5000/15000=1
    const q = ok(
      input({
        price: { planKey: "plus", months: 1, currency: "EGP", amountMinor: 3 },
        taxRule: { id: "t", rateBps: 5000, mode: "inclusive" },
      }),
    );
    expect(q.taxIncludedMinor).toBe(1);
  });
  it("no rule means no tax", () => {
    const q = ok(input());
    expect(q.taxMode).toBeNull();
    expect(q.taxMinor).toBe(0);
  });
});

describe("processing fee gross-up", () => {
  const methods = [
    { key: "pct", feeBps: 275, feeFixedMinor: 0 },
    { key: "mixed", feeBps: 275, feeFixedMinor: 300 },
    { key: "flat", feeBps: 0, feeFixedMinor: 500 },
    { key: "free", feeBps: 0, feeFixedMinor: 0 },
  ];
  it("percentage only: ceil(10000/0.9725) = 10283", () => {
    const q = ok(input({ methods, methodKey: "pct" }));
    expect(q.totalMinor).toBe(10283);
    expect(q.feeMinor).toBe(283);
    expect(q.lines.find((l) => l.kind === "fee")).toMatchObject({
      labelKey: "billing.line.fee",
      amountMinor: 283,
    });
  });
  it("percentage with a fixed part: ceil(10300/0.9725) = 10592", () => {
    const q = ok(input({ methods, methodKey: "mixed" }));
    expect(q.totalMinor).toBe(10592);
    expect(q.feeMinor).toBe(592);
  });
  it("fixed part only", () => {
    const q = ok(input({ methods, methodKey: "flat" }));
    expect(q.feeMinor).toBe(500);
    expect(q.totalMinor).toBe(10500);
  });
  it("fee-free method", () => {
    const q = ok(input({ methods, methodKey: "free" }));
    expect(q.feeMinor).toBe(0);
    expect(q.lines.some((l) => l.kind === "fee")).toBe(false);
  });
  it("computes options for every method and no fee without a selection", () => {
    const q = ok(input({ methods }));
    expect(q.feeMinor).toBe(0);
    expect(q.methodKey).toBeNull();
    expect(q.totalMinor).toBe(10000);
    expect(q.methodOptions).toEqual([
      { key: "pct", feeMinor: 283, totalMinor: 10283, available: true },
      { key: "mixed", feeMinor: 592, totalMinor: 10592, available: true },
      { key: "flat", feeMinor: 500, totalMinor: 10500, available: true },
      { key: "free", feeMinor: 0, totalMinor: 10000, available: true },
    ]);
  });
  it("the fee is grossed up over the added tax too", () => {
    const q = ok(
      input({ methods, methodKey: "pct", taxRule: { id: "t", rateBps: 1400, mode: "added" } }),
    ); // pre 11400 -> ceil(11400/0.9725) = 11723
    expect(q.totalMinor).toBe(11723);
    expect(q.feeMinor).toBe(323);
    expect(q.display.feeLine.amountMinor).toBe(1400 + 323);
    expect(q.display.buttonTotalMinor).toBe(q.totalMinor);
  });
  it("min and max amounts and currencies make a method unavailable", () => {
    const limited = [
      { key: "min", feeBps: 0, feeFixedMinor: 0, minAmountMinor: 10001 },
      { key: "max", feeBps: 0, feeFixedMinor: 0, maxAmountMinor: 9999 },
      { key: "edge", feeBps: 0, feeFixedMinor: 0, minAmountMinor: 10000, maxAmountMinor: 10000 },
      { key: "sar", feeBps: 0, feeFixedMinor: 0, currencies: ["SAR"] },
      { key: "egp", feeBps: 0, feeFixedMinor: 0, currencies: ["EGP"] },
    ];
    const q = ok(input({ methods: limited }));
    expect(q.methodOptions.map((o) => o.available)).toEqual([false, false, true, false, true]);
    expect(code(input({ methods: limited, methodKey: "min" }))).toBe("METHOD_NOT_AVAILABLE");
    expect(code(input({ methods: limited, methodKey: "nope" }))).toBe("METHOD_NOT_AVAILABLE");
  });
});

describe("currencies with 3 decimals and rounding", () => {
  it("JOD amounts stay integer minor units", () => {
    const q = ok(
      input({
        price: { planKey: "plus", months: 1, currency: "JOD", amountMinor: 7500 }, // 7.500 JOD
        discounts: [discount({ id: "p", valueBps: 1250, amountsMinor: { JOD: 1 } })],
        taxRule: { id: "t", rateBps: 1600, mode: "added" },
        methods: [{ key: "k", feeBps: 250, feeFixedMinor: 250 }],
        methodKey: "k",
      }),
    );
    // discount 937.5 -> 938; subtotal 6562; tax 1049.92 -> 1050; pre 7612; +250 = 7862; /0.975 = 8063.59 -> 8064
    expect(q.subtotalMinor).toBe(6562);
    expect(q.taxAddedMinor).toBe(1050);
    expect(q.totalMinor).toBe(8064);
    expect(q.feeMinor).toBe(452);
    expect(q.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(q.totalMinor);
  });
  it("extra_months saving is floor(base * n / months)", () => {
    const q = ok(
      input({
        price: { planKey: "plus", months: 3, currency: "EGP", amountMinor: 10000 },
        discounts: [
          discount({
            id: "e",
            kind: "extra_months",
            valueBps: undefined,
            months: 1,
            source: "coupon",
          }),
          discount({ id: "p", valueBps: 3333 }), // saving 3333, beats floor(10000/3) = 3333 only on the tie rules
        ],
      }),
    );
    // equal savings (3333): coupon wins the tie
    expect(q.applied.couponId).toBe("e");
    expect(q.grants.extraMonths).toBe(1);
  });
});

describe("determinism and display", () => {
  it("accepts Date and ISO now identically", () => {
    expect(canonicalJson(ok(input({ now: new Date(NOW) })))).toBe(canonicalJson(ok(input())));
  });
  it("savings display", () => {
    const q = ok(input({ discounts: [discount({ id: "p", valueBps: 2500 })] }));
    expect(q.display).toMatchObject({
      struckMinor: 10000,
      savingsMinor: 2500,
      savingsBps: 2500,
      headlineMinor: 7500,
    });
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively and drops whitespace and undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"z":1}]},"b":1}',
    );
  });
  it("keeps array order and encodes Dates as ISO", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson({ at: new Date("2026-01-02T03:04:05Z") })).toBe(
      '{"at":"2026-01-02T03:04:05.000Z"}',
    );
  });
  it("is independent of key insertion order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(RangeError);
  });
});

interface GoldenCase {
  name: string;
  plan: string;
  months: number;
  promo: boolean;
  coupon: boolean;
  tax: "none" | "inclusive" | "added";
  method: string | null;
  expected: { subtotal: number; taxAdded: number; taxIncluded: number; fee: number; total: number };
}
interface Golden {
  currency: string;
  settings: QuoteInput["settings"];
  prices: Record<string, number>;
  promotion: DiscountDef;
  coupon: DiscountDef;
  taxes: {
    inclusive: NonNullable<QuoteInput["taxRule"]>;
    added: NonNullable<QuoteInput["taxRule"]>;
  };
  methods: QuoteInput["methods"];
  cases: GoldenCase[];
}

describe.each(["egp", "sar"])("golden fixture %s", (name) => {
  const golden = JSON.parse(
    readFileSync(new URL(`./fixtures/price-engine/${name}.json`, import.meta.url), "utf8"),
  ) as Golden;
  it.each(golden.cases)("$name", (c) => {
    const amountMinor = golden.prices[`${c.plan}:${c.months}`];
    if (amountMinor === undefined) throw new Error("fixture price missing");
    const discounts = [
      ...(c.promo ? [golden.promotion] : []),
      ...(c.coupon ? [golden.coupon] : []),
    ];
    const q = ok({
      price: { planKey: c.plan, months: c.months, currency: golden.currency, amountMinor },
      discounts,
      taxRule: c.tax === "none" ? null : golden.taxes[c.tax],
      methods: golden.methods,
      methodKey: c.method,
      history: { isFirstPurchase: false },
      settings: golden.settings,
      now: NOW,
    });
    expect({
      subtotal: q.subtotalMinor,
      taxAdded: q.taxAddedMinor,
      taxIncluded: q.taxIncludedMinor,
      fee: q.feeMinor,
      total: q.totalMinor,
    }).toEqual(c.expected);
  });
});
