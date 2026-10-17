import { describe, expect, it } from "vitest";

import { funnelSteps, moneyDelta } from "../src/components/admin/billing-overview-view";
import { groupResults, isPaletteShortcut } from "../src/components/admin/command-palette";
import { clockText, csvDataRows, deltaOf, previewCheckout } from "../src/lib/admin-revenue";
import {
  cellKey,
  fillYearFromMonthly,
  matrixFromPrices,
  pricesFromMatrix,
} from "../src/lib/price-matrix";
import { shortcutLetter } from "../src/lib/use-shortcuts";

describe("admin revenue helpers", () => {
  it("computes the change versus the prior period without dividing by zero", () => {
    expect(deltaOf(150, 100)).toEqual({ direction: "up", bps: 5_000 });
    expect(deltaOf(50, 100)).toEqual({ direction: "down", bps: -5_000 });
    expect(deltaOf(5, 0)).toEqual({ direction: "up", bps: null });
    expect(deltaOf(0, 0)).toEqual({ direction: "flat", bps: 0 });
  });

  it("compares money in the largest currency only", () => {
    expect(moneyDelta({ EGP: 200, USD: 5 }, { EGP: 100 }).bps).toBe(10_000);
  });

  it("formats the countdown and counts CSV data rows", () => {
    expect(clockText(125)).toBe("02:05");
    expect(clockText(-3)).toBe("00:00");
    expect(csvDataRows("code\nA\nB\n\n")).toEqual(["A", "B"]);
  });

  it("previews added and inclusive tax with the method fee", () => {
    expect(
      previewCheckout({
        amountMinor: 10_000,
        tax: { rateBps: 1_400, mode: "added" },
        method: { feeBps: 0, feeFixedMinor: 300 },
      }),
    ).toEqual({ taxMinor: 1_400, feeMinor: 300, totalMinor: 11_700 });
    expect(
      previewCheckout({
        amountMinor: 11_400,
        tax: { rateBps: 1_400, mode: "inclusive" },
        method: null,
      }),
    ).toEqual({ taxMinor: 1_400, feeMinor: 0, totalMinor: 11_400 });
  });

  it("sums the overall funnel rows, not the per-method ones", () => {
    expect(
      funnelSteps([
        { step: "pricing_viewed", methodKey: null, sessions: 10 },
        { step: "checkout_started", methodKey: null, sessions: 4 },
        { step: "checkout_started", methodKey: "instapay", sessions: 3 },
      ]),
    ).toEqual([
      { step: "pricing_viewed", sessions: 10 },
      { step: "checkout_started", sessions: 4 },
    ]);
  });
});

describe("price matrix", () => {
  const stored = [{ months: 1, currency: "EGP", amountMinor: 9_900 }];

  it("sends emptied stored cells as null and new filled cells, never empty new ones", () => {
    const draft = {
      ...matrixFromPrices(stored),
      [cellKey(1, "EGP")]: "",
      [cellKey(12, "EGP")]: "990",
    };
    const { prices, errors } = pricesFromMatrix({ ...draft, [cellKey(3, "USD")]: "" }, stored);
    expect(errors).toEqual({});
    expect(prices).toEqual([
      { months: 1, currency: "EGP", amountMinor: null },
      { months: 12, currency: "EGP", amountMinor: 99_000 },
    ]);
  });

  it("flags a cell that is not an amount and fills the year from monthly x 10", () => {
    expect(pricesFromMatrix({ [cellKey(1, "EGP")]: "9.999" }, []).errors).toEqual({
      [cellKey(1, "EGP")]: "invalid",
    });
    expect(fillYearFromMonthly({ [cellKey(1, "EGP")]: "99" }, "EGP")[cellKey(12, "EGP")]).toBe(
      "990.00",
    );
  });
});

describe("shortcuts and palette", () => {
  it("reads plain letters by physical key and ignores modified presses", () => {
    expect(shortcutLetter({ code: "KeyJ", ctrlKey: false, metaKey: false, altKey: false })).toBe(
      "j",
    );
    expect(
      shortcutLetter({ code: "KeyJ", ctrlKey: true, metaKey: false, altKey: false }),
    ).toBeNull();
    expect(
      shortcutLetter({ code: "Digit1", ctrlKey: false, metaKey: false, altKey: false }),
    ).toBeNull();
  });

  it("opens on Ctrl or Cmd + K and groups results in a fixed order", () => {
    expect(isPaletteShortcut({ key: "k", ctrlKey: true, metaKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: "K", ctrlKey: false, metaKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: "k", ctrlKey: false, metaKey: false })).toBe(false);
    const id = "00000000-0000-4000-8000-000000000000";
    const groups = groupResults([
      { type: "coupon", id, title: "A", subtitle: "", href: "/a" },
      { type: "user", id, title: "B", subtitle: "", href: "/b" },
    ]);
    expect(groups.map((group) => group.type)).toEqual(["user", "coupon"]);
  });
});
