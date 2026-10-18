import { describe, expect, it } from "vitest";

import { planMargin, type PlanMarginInput } from "../src/margin.js";

describe("planMargin", () => {
  const cases: {
    name: string;
    input: PlanMarginInput;
    expected: { revenueMonthlyMinor: number; costFullMinor: number; marginFullMinor: number };
  }[] = [
    {
      name: "USD, no tax or fee",
      input: {
        amountMinor: 12_000,
        months: 12,
        currency: "USD",
        monthlyCredits: 100,
        costPerCreditUsdMicros: 10_000,
        fxUsdToEgp: 50,
        taxMode: null,
        taxRateBps: 0,
        feeBps: 0,
      },
      expected: { revenueMonthlyMinor: 1_000, costFullMinor: 1_200, marginFullMinor: 10_800 },
    },
    {
      name: "inclusive tax and fee",
      input: {
        amountMinor: 11_000,
        months: 1,
        currency: "EGP",
        monthlyCredits: 100,
        costPerCreditUsdMicros: 10_000,
        fxUsdToEgp: 50,
        taxMode: "inclusive",
        taxRateBps: 1_000,
        feeBps: 1_000,
      },
      expected: { revenueMonthlyMinor: 9_000, costFullMinor: 5_000, marginFullMinor: 4_000 },
    },
    {
      name: "added tax and gateway fee",
      input: {
        amountMinor: 10_000,
        months: 2,
        currency: "USD",
        monthlyCredits: 100,
        costPerCreditUsdMicros: 10_000,
        fxUsdToEgp: 50,
        taxMode: "added",
        taxRateBps: 1_000,
        feeBps: 1_000,
      },
      expected: { revenueMonthlyMinor: 4_500, costFullMinor: 200, marginFullMinor: 8_800 },
    },
  ];

  it.each(cases)("computes $name with integer amounts", ({ input, expected }) => {
    expect(planMargin(input)).toMatchObject(expected);
  });

  it("returns null for currencies without an exchange rate", () => {
    expect(
      planMargin({
        amountMinor: 1_000,
        months: 1,
        currency: "SAR",
        monthlyCredits: 1,
        costPerCreditUsdMicros: 1,
        fxUsdToEgp: 50,
        taxMode: null,
        taxRateBps: 0,
        feeBps: 0,
      }),
    ).toBeNull();
  });

  const base: PlanMarginInput = {
    amountMinor: 200,
    months: 1,
    currency: "USD",
    monthlyCredits: 100,
    costPerCreditUsdMicros: 10_000,
    fxUsdToEgp: 50,
    taxMode: null,
    taxRateBps: 0,
    feeBps: 0,
  };

  it("warns below a 50% margin and not at exactly 50%", () => {
    // 100 credits at 1 cent each cost 100 cents.
    expect(planMargin({ ...base, amountMinor: 200 })).toEqual({
      revenueMonthlyMinor: 200,
      costFullMinor: 100,
      marginFullMinor: 100,
      marginBps: 5_000,
      breakEvenBps: 5_000,
      warn: false,
    });
    expect(planMargin({ ...base, amountMinor: 199 })).toMatchObject({
      marginFullMinor: 99,
      marginBps: 4_974,
      warn: true,
    });
  });

  it("reports a loss as a negative margin", () => {
    expect(planMargin({ ...base, amountMinor: 50 })).toEqual({
      revenueMonthlyMinor: 50,
      costFullMinor: 100,
      marginFullMinor: -50,
      marginBps: -10_000,
      breakEvenBps: 20_000,
      warn: true,
    });
  });

  it("has no cost for a plan without credits", () => {
    expect(planMargin({ ...base, monthlyCredits: 0 })).toMatchObject({
      costFullMinor: 0,
      marginFullMinor: 200,
      marginBps: 10_000,
      breakEvenBps: 0,
      warn: false,
    });
  });

  it("rounds the extracted tax and the fee half up to whole minor units", () => {
    // 9,900 incl. 14% VAT: 9,900 x 1,400 / 11,400 = 1,215.79 -> 1,216 of tax, 8,684 net.
    expect(
      planMargin({
        ...base,
        amountMinor: 9_900,
        currency: "EGP",
        monthlyCredits: 0,
        taxMode: "inclusive",
        taxRateBps: 1_400,
      }),
    ).toMatchObject({ revenueMonthlyMinor: 8_684, marginFullMinor: 8_684 });
    // Added tax is on top of the price: it is not revenue and does not reduce it.
    expect(
      planMargin({
        ...base,
        amountMinor: 9_900,
        monthlyCredits: 0,
        taxMode: "added",
        taxRateBps: 1_400,
      }),
    ).toMatchObject({ revenueMonthlyMinor: 9_900 });
    // 8,684 x 98.5% = 8,553.74 -> 8,554.
    expect(
      planMargin({
        ...base,
        amountMinor: 9_900,
        monthlyCredits: 0,
        taxMode: "inclusive",
        taxRateBps: 1_400,
        feeBps: 150,
      }),
    ).toMatchObject({ revenueMonthlyMinor: 8_554 });
  });

  it("converts the cost with a fractional exchange rate exactly", () => {
    // 100 credits x $0.01 = $1 = 48.65 EGP = 4,865 piasters.
    expect(
      planMargin({ ...base, currency: "EGP", amountMinor: 10_000, fxUsdToEgp: 48.65 }),
    ).toMatchObject({ costFullMinor: 4_865, marginFullMinor: 5_135 });
  });

  it("stays exact where the products exceed 2^53", () => {
    // 1,000,000 credits x 24 months x $1 per credit = 2.4e13 micros; x the 5e7 scaled rate = 1.2e21,
    // far beyond 2^53. The cost is 1.2e11 piasters.
    const result = planMargin({
      amountMinor: 2_000_000_000,
      months: 24,
      currency: "EGP",
      monthlyCredits: 1_000_000,
      costPerCreditUsdMicros: 1_000_000,
      fxUsdToEgp: 50,
      taxMode: null,
      taxRateBps: 0,
      feeBps: 0,
    });
    expect(result).toMatchObject({
      costFullMinor: 120_000_000_000,
      marginFullMinor: 2_000_000_000 - 120_000_000_000,
    });
  });

  it("returns null for inputs it cannot judge", () => {
    const invalid: Array<Partial<PlanMarginInput>> = [
      { months: 0 },
      { amountMinor: 1.5 },
      { monthlyCredits: -1 },
      { costPerCreditUsdMicros: 0.5 },
      { fxUsdToEgp: 0 },
      { taxRateBps: 10_001 },
      { feeBps: 10_000 },
      { feeBps: -1 },
      { currency: "usd" },
    ];
    for (const override of invalid) {
      expect(planMargin({ ...base, ...override }), JSON.stringify(override)).toBeNull();
    }
  });
});
