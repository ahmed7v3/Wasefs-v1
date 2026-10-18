import { describe, expect, it } from "vitest";

import { previewForMethod, summaryFromQuote } from "../src/lib/checkout-summary";
import { checkoutHref, quoteCall, targetFromParams } from "../src/lib/checkout-target";

import type { QuoteResponse } from "@wasfa/shared/schemas/billing";

type Quote = QuoteResponse["quote"];

/** A quote priced with the card: 100.00 plan, 10.00 off, 3.00 card fee on top of 90.00. */
function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    quoteVersion: 1,
    planKey: "plus",
    months: 1,
    currency: "EGP",
    lines: [
      { kind: "plan", labelKey: "billing.line.plan", amountMinor: 10_000 },
      { kind: "discount", labelKey: "billing.line.coupon", amountMinor: -1_000 },
    ],
    listPriceMinor: 10_000,
    subtotalMinor: 9_000,
    taxMinor: 0,
    taxAddedMinor: 0,
    taxIncludedMinor: 0,
    taxMode: null,
    feeMinor: 300,
    totalMinor: 9_300,
    methodKey: "card",
    methodOptions: [
      { key: "card", feeMinor: 300, totalMinor: 9_300, available: true },
      { key: "instapay", feeMinor: 0, totalMinor: 9_000, available: true },
    ],
    isFreeOrder: false,
    grants: { bonusCredits: 0, extraMonths: 0 },
    applied: {},
    display: {
      headlineMinor: 9_000,
      struckMinor: 10_000,
      savingsMinor: 1_000,
      savingsBps: 1_000,
      perMonthMinor: 9_000,
      feeLine: { amountMinor: 300, show: true, items: [{ kind: "fee", amountMinor: 300 }] },
      buttonTotalMinor: 9_300,
    },
    expiresAt: "2026-10-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("summaryFromQuote", () => {
  it("lists the plan then the discount in success tone, one fee line, and a button total equal to the total", () => {
    const summary = summaryFromQuote(quote(), "بلس · شهر واحد");
    expect(summary.lines.map((line) => [line.label, line.amountMinor, line.tone])).toEqual([
      ["بلس · شهر واحد", 10_000, undefined],
      ["خصم الكود", -1_000, "discount"],
    ]);
    expect(summary.fee).toMatchObject({ show: true, amountMinor: 300 });
    expect(summary.totalMinor).toBe(9_300);
    expect(summary.buttonTotalMinor).toBe(summary.totalMinor);
  });

  it("explains the proration line and keeps tax and fee lines out of the list", () => {
    const summary = summaryFromQuote(
      quote({
        lines: [
          { kind: "plan", labelKey: "billing.line.plan", amountMinor: 29_900 },
          { kind: "proration", labelKey: "billing.line.proration", amountMinor: -5_000 },
          { kind: "tax", labelKey: "billing.line.tax", amountMinor: 3_000 },
          { kind: "fee", labelKey: "billing.line.fee", amountMinor: 300 },
        ],
      }),
      "برو",
    );
    expect(summary.lines).toHaveLength(2);
    expect(summary.lines[1]?.explanation).toMatch(/المدة المتبقية/);
  });

  it("turns grants into perk sentences", () => {
    const summary = summaryFromQuote(
      quote({ grants: { bonusCredits: 30, extraMonths: 1 } }),
      "حزمة",
    );
    expect(summary.perks).toEqual(["+30 كريدت هدية", "+1 شهر هدية"]);
  });
});

describe("previewForMethod", () => {
  it("moves the total and the fee to the chosen method's own numbers", () => {
    const preview = previewForMethod(quote(), "بلس", "instapay");
    expect(preview?.totalMinor).toBe(9_000);
    expect(preview?.buttonTotalMinor).toBe(9_000);
    expect(preview?.fee).toMatchObject({ show: false, amountMinor: 0 });
  });

  it("keeps the tax part and swaps only the fee part", () => {
    const withTax = quote({
      display: {
        ...quote().display,
        feeLine: {
          amountMinor: 1_700,
          show: true,
          items: [
            { kind: "tax", amountMinor: 1_400 },
            { kind: "fee", amountMinor: 300 },
          ],
        },
      },
    });
    const preview = previewForMethod(withTax, "بلس", "instapay");
    expect(preview?.fee.amountMinor).toBe(1_400);
    expect(preview?.fee.items.map((item) => item.key)).toEqual(["tax"]);
  });

  it("is null for a method that is not in the quote", () => {
    expect(previewForMethod(quote(), "بلس", "ghost")).toBeNull();
  });
});

describe("checkout target", () => {
  it("reads a plan, a pack and a renewal from the query", () => {
    expect(targetFromParams({ plan: "plus", months: "12" })).toEqual({
      kind: "plan",
      planKey: "plus",
      months: 12,
    });
    expect(targetFromParams({ plan: "plus" })).toEqual({
      kind: "plan",
      planKey: "plus",
      months: 1,
    });
    expect(targetFromParams({ pack: "pack_300" })).toEqual({ kind: "pack", packKey: "pack_300" });
    expect(targetFromParams({ renew: "1" })).toEqual({ kind: "renew", months: undefined });
  });

  it("refuses nonsense", () => {
    expect(targetFromParams({})).toBeNull();
    expect(targetFromParams({ plan: "Plus!" })).toBeNull();
    expect(targetFromParams({ plan: "plus", months: "0" })).toBeNull();
    expect(targetFromParams({ pack: "../x" })).toBeNull();
  });

  it("builds the quote call without ever sending a price", () => {
    const plan = quoteCall(
      { kind: "plan", planKey: "plus", months: 3 },
      { methodKey: "card", couponCode: "SAVE10", currency: "EGP" },
    );
    expect(plan.path).toBe("/billing/quote?currency=EGP");
    expect(plan.body).toEqual({
      planKey: "plus",
      months: 3,
      methodKey: "card",
      couponCode: "SAVE10",
    });
    expect(quoteCall({ kind: "pack", packKey: "pack_100" }, { couponCode: "X" }).body).toEqual({
      packKey: "pack_100",
    });
    expect(quoteCall({ kind: "renew", months: undefined }, { methodKey: "card" }).path).toBe(
      "/me/subscription/renew-quote",
    );
  });

  it("round-trips a link", () => {
    expect(checkoutHref({ kind: "plan", planKey: "pro", months: 12 }, "EGP")).toBe(
      "/checkout?plan=pro&months=12&currency=EGP",
    );
    expect(checkoutHref({ kind: "renew", months: undefined })).toBe("/checkout?renew=1");
  });
});
