import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  quote,
  type DiscountDef,
  type PaymentMethodInput,
  type QuoteInput,
} from "../src/price-engine.js";

const NOW = "2026-06-15T12:00:00.000Z";
const CURRENCIES = ["EGP", "SAR", "JOD"] as const;

const discountArb = (index: number, exclusiveOnly: boolean): fc.Arbitrary<DiscountDef> =>
  fc.record({
    id: fc.constant(`d${index}`),
    source: fc.constantFrom("promotion", "coupon", "personal_offer"),
    kind: fc.constantFrom("percent", "fixed", "bonus_credits", "extra_months"),
    valueBps: fc.integer({ min: 0, max: 10000 }),
    amountsMinor: fc.record({
      EGP: fc.integer({ min: 0, max: 200_000 }),
      SAR: fc.integer({ min: 0, max: 200_000 }),
      JOD: fc.integer({ min: 0, max: 200_000 }),
    }),
    credits: fc.integer({ min: 0, max: 500 }),
    months: fc.integer({ min: 0, max: 6 }),
    scope: fc.record(
      {
        planKeys: fc.constantFrom(["plus"], ["pro"], ["plus", "pro"]),
        months: fc.constantFrom([1], [12], [1, 3, 12]),
        countries: fc.constantFrom(["EG"], ["SA"]),
        newCustomersOnly: fc.boolean(),
        minAmountMinor: fc.integer({ min: 0, max: 300_000 }),
      },
      { requiredKeys: [] },
    ),
    startsAt: fc.option(fc.constantFrom("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"), {
      nil: undefined,
    }),
    endsAt: fc.option(fc.constantFrom("2026-03-01T00:00:00Z", "2027-01-01T00:00:00Z"), {
      nil: undefined,
    }),
    stacking: exclusiveOnly
      ? fc.constant("exclusive" as const)
      : fc.constantFrom("exclusive", "stack_with_other"),
    priority: fc.integer({ min: 0, max: 5 }),
  }) as fc.Arbitrary<DiscountDef>;

const methodArb = (index: number): fc.Arbitrary<PaymentMethodInput> =>
  fc.record(
    {
      key: fc.constant(`m${index}`),
      feeBps: fc.integer({ min: 0, max: 900 }),
      feeFixedMinor: fc.integer({ min: 0, max: 1000 }),
      minAmountMinor: fc.integer({ min: 0, max: 5000 }),
      maxAmountMinor: fc.integer({ min: 100_000, max: 2_000_000 }),
      currencies: fc.constantFrom(["EGP", "SAR"], ["EGP", "SAR", "JOD"]),
    },
    { requiredKeys: ["key", "feeBps", "feeFixedMinor"] },
  );

const upgradeArb = fc.record({
  periodStart: fc.constant("2026-06-01T00:00:00Z"),
  periodEnd: fc.constantFrom(
    "2026-06-10T00:00:00Z",
    "2026-06-20T00:00:00Z",
    "2026-07-01T00:00:00Z",
  ),
  lastPaidNetMinor: fc.integer({ min: 0, max: 500_000 }),
  currency: fc.constantFrom(...CURRENCIES),
});

const inputArb = (exclusiveOnly = false): fc.Arbitrary<QuoteInput> =>
  fc
    .record({
      currency: fc.constantFrom(...CURRENCIES),
      planKey: fc.constantFrom("plus", "pro"),
      months: fc.constantFrom(1, 3, 12),
      amountMinor: fc.integer({ min: 0, max: 1_000_000 }),
      discounts: fc
        .array(fc.nat(), { maxLength: 5 })
        .chain((slots) => fc.tuple(...slots.map((_, i) => discountArb(i, exclusiveOnly)))),
      deal: fc.option(
        fc.record({
          id: fc.constant("deal"),
          pricing: fc.oneof(
            fc.record({
              mode: fc.constant("fixed" as const),
              amountMinor: fc.integer({ min: 0, max: 1_000_000 }),
              currency: fc.constantFrom(...CURRENCIES),
            }),
            fc.record({
              mode: fc.constant("percent_off" as const),
              bps: fc.integer({ min: 0, max: 10000 }),
            }),
          ),
          stackWithPromotions: fc.boolean(),
          stackWithCoupons: fc.boolean(),
        }),
        { nil: undefined },
      ),
      taxRule: fc.option(
        fc.record({
          id: fc.constant("tax"),
          rateBps: fc.integer({ min: 0, max: 3000 }),
          mode: fc.constantFrom("added" as const, "inclusive" as const),
        }),
        { nil: undefined },
      ),
      methods: fc
        .array(fc.nat(), { maxLength: 3 })
        .chain((slots) => fc.tuple(...slots.map((_, i) => methodArb(i)))),
      pick: fc.nat({ max: 3 }),
      first: fc.boolean(),
      upgrade: fc.option(upgradeArb, { nil: undefined }),
      settings: fc.record({
        maxTotalDiscountBps: fc.integer({ min: 0, max: 10000 }),
        minChargeMinor: fc.integer({ min: 0, max: 3000 }),
        minChargeMode: fc.constantFrom("raise" as const, "refuse" as const),
        allowFreeOrders: fc.boolean(),
        quoteTtlMinutes: fc.integer({ min: 1, max: 60 }),
        creditValueMinor: fc.integer({ min: 0, max: 100 }),
      }),
      country: fc.constantFrom("EG", "SA", undefined),
    })
    .map((r) => {
      const methods = r.methods as PaymentMethodInput[];
      const chosen = methods[r.pick];
      return {
        price: {
          planKey: r.planKey,
          months: r.months,
          currency: r.currency,
          amountMinor: r.amountMinor,
        },
        discounts: r.discounts as DiscountDef[],
        deal: r.deal,
        taxRule: r.taxRule,
        methods,
        methodKey: chosen?.key ?? null,
        history: { isFirstPurchase: r.first, upgradeFrom: r.upgrade },
        settings: r.settings,
        now: NOW,
        country: r.country,
      } satisfies QuoteInput;
    });

const RUNS = { numRuns: 10_000 };

describe("price engine properties (10,000 baskets)", () => {
  it("holds the BILLING §4 invariants and is deterministic", () => {
    fc.assert(
      fc.property(inputArb(), (i) => {
        const first = quote(i);
        const second = quote(structuredClone(i));
        expect(second).toEqual(first);
        expect(canonicalJson(second)).toBe(canonicalJson(first));
        if (!first.ok) return;
        const q = first.quote;

        for (const n of [
          q.listPriceMinor,
          q.subtotalMinor,
          q.taxMinor,
          q.taxAddedMinor,
          q.taxIncludedMinor,
          q.feeMinor,
          q.totalMinor,
          ...q.lines.map((l) => l.amountMinor),
          ...q.methodOptions.flatMap((o) => [o.feeMinor, o.totalMinor]),
        ]) {
          expect(Number.isSafeInteger(n)).toBe(true);
        }
        expect(q.totalMinor).toBeGreaterThanOrEqual(0);
        expect(q.subtotalMinor).toBeGreaterThanOrEqual(0);
        expect(q.feeMinor).toBeGreaterThanOrEqual(0);
        expect(q.totalMinor).toBe(q.subtotalMinor + q.taxAddedMinor + q.feeMinor);
        expect(q.lines.reduce((s, l) => s + l.amountMinor, 0)).toBe(q.totalMinor);
        expect(q.isFreeOrder).toBe(q.totalMinor === 0);
        expect(q.display.buttonTotalMinor).toBe(q.totalMinor);

        const method = i.methods.find((m) => m.key === i.methodKey);
        if (!method || (method.feeBps === 0 && method.feeFixedMinor === 0)) {
          expect(q.feeMinor).toBe(0);
        }
        if (q.subtotalMinor + q.taxAddedMinor === 0) expect(q.feeMinor).toBe(0);

        // Stacked monetary discounts from promotions/coupons/offers never exceed the cap
        // (a single discount may reach 100%, BILLING §3 and §5.4).
        const base =
          q.listPriceMinor +
          (q.lines.find((l) => l.labelKey === "billing.line.deal")?.amountMinor ?? 0);
        const capped = q.lines
          .filter((l) => l.kind === "discount" && l.labelKey !== "billing.line.deal")
          .reduce((s, l) => s - l.amountMinor, 0);
        const discountLines = q.lines.filter(
          (l) => l.kind === "discount" && l.labelKey !== "billing.line.deal",
        ).length;
        expect(capped).toBeLessThanOrEqual(
          discountLines > 1 ? Math.floor((base * i.settings.maxTotalDiscountBps) / 10000) : base,
        );

        // A fee gross-up never leaves the merchant short: fee covers the percentage and fixed parts.
        if (method && q.feeMinor > 0) {
          const preFee = q.subtotalMinor + q.taxAddedMinor;
          expect(q.totalMinor * (10000 - method.feeBps)).toBeGreaterThanOrEqual(
            (preFee + method.feeFixedMinor) * 10000,
          );
        }
      }),
      RUNS,
    );
  });

  it("best-of never picks a smaller saving than an eligible exclusive alternative", () => {
    const monetary = fc.array(
      fc.oneof(
        fc.record({
          kind: fc.constant("percent" as const),
          bps: fc.integer({ min: 0, max: 10000 }),
        }),
        fc.record({
          kind: fc.constant("fixed" as const),
          amount: fc.integer({ min: 0, max: 200_000 }),
        }),
      ),
      { minLength: 1, maxLength: 6 },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        monetary,
        fc.integer({ min: 0, max: 10000 }),
        (amountMinor, specs, capBps) => {
          const discounts: DiscountDef[] = specs.map((s, idx) => ({
            id: `d${idx}`,
            source: (["promotion", "coupon", "personal_offer"] as const)[idx % 3] ?? "promotion",
            kind: s.kind,
            valueBps: s.kind === "percent" ? s.bps : undefined,
            amountsMinor: s.kind === "fixed" ? { EGP: s.amount } : undefined,
            scope: {},
            stacking: "exclusive",
            priority: 0,
          }));
          const result = quote({
            price: { planKey: "plus", months: 1, currency: "EGP", amountMinor },
            discounts,
            methods: [],
            history: { isFirstPurchase: false },
            settings: {
              maxTotalDiscountBps: capBps,
              minChargeMinor: 0,
              minChargeMode: "raise",
              allowFreeOrders: true,
              quoteTtlMinutes: 15,
            },
            now: NOW,
          });
          if (!result.ok) return;
          const best = Math.max(
            ...specs.map((s) =>
              s.kind === "percent"
                ? Math.min(
                    amountMinor,
                    Number((BigInt(amountMinor) * BigInt(s.bps) * 2n + 10000n) / 20000n),
                  )
                : Math.min(amountMinor, s.amount),
            ),
          );
          // Exclusive discounts never stack, so the cap does not apply.
          void capBps;
          expect(amountMinor - result.quote.subtotalMinor).toBe(best);
        },
      ),
      RUNS,
    );
  });
});
