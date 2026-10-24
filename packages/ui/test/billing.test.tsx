import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CheckoutSummary,
  ComparisonTable,
  Countdown,
  MethodPicker,
  PriceTag,
  ReceiptSheet,
  lineLabel,
  periodLabel,
  remainingText,
} from "../src";

const norm = (text: string | null | undefined): string =>
  (text ?? "").replace(/[‎‏؜\s]+/g, " ").trim();

describe("billing format helpers", () => {
  it("labels periods in words", () => {
    expect(periodLabel(1)).toBe("شهر واحد");
    expect(periodLabel(3)).toBe("3 أشهر");
    expect(periodLabel(12)).toBe("سنة كاملة");
    expect(periodLabel(18)).toBe("18 شهرًا");
  });

  it("knows every engine line label and never shows a raw key", () => {
    expect(lineLabel("billing.line.proration")).toBe("رصيد المدة المتبقية من باقتك الحالية");
    expect(lineLabel("billing.line.promotion")).not.toMatch(/billing\./);
    expect(lineLabel("billing.line.nonsense")).toBe("بند في الطلب");
  });
});

describe("PriceTag", () => {
  it("strikes the old price only when it is really higher", () => {
    const { container, rerender } = render(
      <PriceTag amountMinor={8000} struckMinor={10000} currency="EGP" />,
    );
    expect(container.querySelector("s")).not.toBeNull();
    rerender(<PriceTag amountMinor={8000} struckMinor={8000} currency="EGP" />);
    expect(container.querySelector("s")).toBeNull();
  });
});

describe("billing components in English", () => {
  it("formats the period and the price with Latin digits in English", () => {
    expect(periodLabel(3, "en")).toBe("3 months");
    const { container } = render(<PriceTag amountMinor={28_310} currency="EGP" locale="en" />);
    expect(container.textContent).toMatch(/283\.10/);
    expect(container.textContent).not.toMatch(/[\u0660-\u0669]/);
  });
});

describe("CheckoutSummary", () => {
  const base = {
    currency: "EGP",
    lines: [
      { key: "plan", label: "بلس · شهر واحد", amountMinor: 29_900 },
      { key: "discount", label: "خصم الكود", amountMinor: -3_000, tone: "discount" as const },
    ],
    totalMinor: 28_310,
  };

  it("shows the combined tax-and-fees line with its parts, and the total", () => {
    render(
      <CheckoutSummary
        {...base}
        fee={{
          show: true,
          amountMinor: 720,
          items: [{ key: "fee", label: "رسوم وسيلة الدفع", amountMinor: 720 }],
        }}
      />,
    );
    expect(screen.getByText("الضريبة والرسوم")).toBeTruthy();
    expect(norm(screen.getByTestId("summary-fee-amount").textContent)).toContain("7.20");
    expect(norm(screen.getByTestId("checkout-total").textContent)).toContain("283.10");
  });

  it("leaves the line out when there is neither tax nor fee", () => {
    render(<CheckoutSummary {...base} fee={{ show: false, amountMinor: 0, items: [] }} />);
    expect(screen.queryByText("الضريبة والرسوم")).toBeNull();
  });
});

describe("MethodPicker", () => {
  const options = [
    { key: "card", label: "بطاقة", feeText: "+ 7.20 ج.م." },
    { key: "instapay", label: "إنستاباي", feeText: "بدون رسوم" },
    { key: "wallet", label: "محفظة", feeText: "", disabled: true },
  ];

  it("is a labelled radio group that reports the choice and shows each fee", () => {
    const onChange = vi.fn();
    render(
      <MethodPicker
        legend="وسيلة الدفع"
        name="m"
        options={options}
        value="card"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("group", { name: "وسيلة الدفع" })).toBeTruthy();
    expect(screen.getByText("بدون رسوم")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /بطاقة/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /إنستاباي/ }));
    expect(onChange).toHaveBeenCalledWith("instapay");
    expect((screen.getByRole("radio", { name: /محفظة/ }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("Countdown", () => {
  it("renders nothing without a real end time", () => {
    const { container } = render(<Countdown endsAt={null} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing once the time is up", () => {
    const { container } = render(<Countdown endsAt={new Date(Date.now() - 1_000).toISOString()} />);
    expect(container.textContent).toBe("");
  });

  it("shows the time left from the server's end time", () => {
    render(
      <Countdown endsAt={new Date(Date.now() + 3 * 86_400_000 + 4 * 3_600_000).toISOString()} />,
    );
    expect(screen.getByText(/ينتهي العرض بعد 3 يومًا و/)).toBeTruthy();
  });

  it("words the remaining time by size", () => {
    expect(remainingText(5 * 3_600_000 + 12 * 60_000, false)).toBe("5 ساعة و12 دقيقة");
    expect(remainingText(12 * 60_000 + 5_000, true)).toBe("12 دقيقة و5 ثانية");
    expect(remainingText(30_000, false)).toBe("1 دقيقة");
  });
});

describe("ComparisonTable", () => {
  it("has a caption, column headers and row headers, and says yes/no in words", () => {
    render(
      <ComparisonTable
        caption="مقارنة الباقات"
        columns={[
          { key: "a", name: "أ" },
          { key: "b", name: "ب" },
        ]}
        rows={[{ key: "r", label: "ميزة", cells: [true, false] }]}
      />,
    );
    expect(screen.getByRole("table", { name: "مقارنة الباقات" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByRole("rowheader", { name: "ميزة" })).toBeTruthy();
    expect(screen.getByText("مشمول")).toBeTruthy();
    expect(screen.getByText("غير مشمول")).toBeTruthy();
  });
});

describe("ReceiptSheet", () => {
  it("lists every line and total with the receipt number", () => {
    render(
      <ReceiptSheet
        currency="EGP"
        title="إيصال دفع"
        number="WSF-0001"
        meta={[{ key: "s", label: "الحالة", value: "مدفوع" }]}
        parties={[{ heading: "العميل", lines: ["أحمد"] }]}
        itemLabel="بلس · شهر واحد"
        lines={[{ key: "p", label: "بلس · شهر واحد", amountMinor: 9_900 }]}
        totals={[{ key: "t", label: "الإجمالي المدفوع", amountMinor: 9_900, strong: true }]}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "إيصال دفع" })).toBeTruthy();
    expect(screen.getByText("WSF-0001")).toBeTruthy();
    expect(screen.getByText("الإجمالي المدفوع")).toBeTruthy();
  });
});
