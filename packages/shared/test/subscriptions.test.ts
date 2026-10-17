import { describe, expect, it } from "vitest";

import {
  addMonthsClamped,
  anniversaries,
  buildReceipt,
  maskEmail,
  maskPhone,
  monthKey,
  pendingChangeSchema,
  type ReceiptInput,
} from "../src/subscriptions.js";

const at = (iso: string) => new Date(iso);

describe("addMonthsClamped", () => {
  it.each([
    ["2026-01-15T10:00:00.000Z", 1, "2026-02-15T10:00:00.000Z"],
    ["2026-01-31T10:00:00.000Z", 1, "2026-02-28T10:00:00.000Z"],
    ["2028-01-31T10:00:00.000Z", 1, "2028-02-29T10:00:00.000Z"],
    ["2026-03-31T23:59:59.999Z", -1, "2026-02-28T23:59:59.999Z"],
    ["2026-12-31T00:00:00.000Z", 2, "2027-02-28T00:00:00.000Z"],
    ["2026-05-31T00:00:00.000Z", 12, "2027-05-31T00:00:00.000Z"],
    ["2026-08-31T08:00:00.000Z", -6, "2026-02-28T08:00:00.000Z"],
  ])("%s + %i months = %s", (from, months, expected) => {
    expect(addMonthsClamped(at(from), months).toISOString()).toBe(expected);
  });

  it("refuses a fractional month count", () => {
    expect(() => addMonthsClamped(at("2026-01-01T00:00:00.000Z"), 1.5)).toThrow();
  });
});

describe("anniversaries", () => {
  it("lists one per month from the start, clamped from the start each time (not chained)", () => {
    const start = at("2026-01-31T09:00:00.000Z");
    const end = addMonthsClamped(start, 12);
    const list = anniversaries(start, end).map((date) => date.toISOString());
    expect(list).toHaveLength(12);
    expect(list.slice(0, 4)).toEqual([
      "2026-01-31T09:00:00.000Z",
      "2026-02-28T09:00:00.000Z",
      "2026-03-31T09:00:00.000Z",
      "2026-04-30T09:00:00.000Z",
    ]);
    // Every anniversary falls in its own month, so the month is a safe part of the ledger key.
    expect(new Set(list.map((iso) => monthKey(new Date(iso)))).size).toBe(12);
  });

  it("is empty for an empty period and excludes the end itself", () => {
    const start = at("2026-02-10T00:00:00.000Z");
    expect(anniversaries(start, start)).toEqual([]);
    expect(anniversaries(start, addMonthsClamped(start, 1))).toHaveLength(1);
  });
});

describe("pendingChangeSchema", () => {
  it("accepts a scheduled downgrade and refuses junk", () => {
    const value = {
      planId: "0192d3a4-1111-7000-8000-000000000001",
      months: 3,
      orderId: "0192d3a4-1111-7000-8000-000000000002",
      effectiveAt: "2026-11-01T00:00:00.000Z",
    };
    expect(pendingChangeSchema.parse(value)).toEqual(value);
    expect(pendingChangeSchema.safeParse({ ...value, months: 0 }).success).toBe(false);
    expect(pendingChangeSchema.safeParse({ planId: "x" }).success).toBe(false);
  });
});

describe("buildReceipt", () => {
  const base: ReceiptInput = {
    order: {
      number: "WSO-2026-000123",
      kind: "subscription",
      planKey: "plus",
      packKey: null,
      months: 3,
      currency: "EGP",
      subtotalMinor: 24_000,
      discountMinor: 3_000,
      taxMinor: 3_360,
      feeMinor: 750,
      totalMinor: 28_110,
      status: "paid",
      createdAt: at("2026-10-01T10:00:00.000Z"),
      paidAt: at("2026-10-01T10:05:00.000Z"),
      lines: [
        { kind: "plan", labelKey: "billing.line.plan", amountMinor: 27_000, meta: { months: 3 } },
        { kind: "discount", labelKey: "billing.line.promotion", amountMinor: -3_000 },
        { kind: "tax", labelKey: "billing.line.tax", amountMinor: 3_360 },
        { kind: "fee", labelKey: "billing.line.fee", amountMinor: 750 },
      ],
      taxMode: "added",
    },
    buyer: { name: "Sara", email: "sara@example.com", phone: "+201012345678" },
    company: { legalName: "Wasfa LLC", address: "Cairo", taxId: "123-456-789" },
    payment: {
      methodKey: "instapay",
      methodNameAr: "إنستاباي",
      methodNameEn: "InstaPay",
      reference: "WSP-ABC234",
    },
    refunds: [],
  };

  it("itemises every line, keeps money in minor units and masks the buyer", () => {
    const receipt = buildReceipt(base);
    expect(receipt.lines.map((line) => line.kind)).toEqual(["plan", "discount", "tax", "fee"]);
    expect(receipt.lines[0]).toEqual({
      kind: "plan",
      labelKey: "billing.line.plan",
      amountMinor: 27_000,
    });
    expect(receipt.totals).toMatchObject({
      totalMinor: 28_110,
      refundedMinor: 0,
      netPaidMinor: 28_110,
    });
    expect(receipt.buyer).toEqual({
      name: "Sara",
      email: "s***@example.com",
      phone: "+20*******678",
    });
    expect(receipt.issuedAt).toBe("2026-10-01T10:05:00.000Z");
    expect(receipt.company.legalName).toBe("Wasfa LLC");
  });

  it("subtracts refunds and lists them", () => {
    const receipt = buildReceipt({
      ...base,
      order: { ...base.order, status: "partially_refunded" },
      refunds: [{ amountMinor: 10_000, createdAt: at("2026-10-03T12:00:00.000Z") }],
    });
    expect(receipt.totals).toMatchObject({ refundedMinor: 10_000, netPaidMinor: 18_110 });
    expect(receipt.refunds).toEqual([
      { amountMinor: 10_000, refundedAt: "2026-10-03T12:00:00.000Z" },
    ]);
  });

  it("works without company details, contact data or readable lines", () => {
    const receipt = buildReceipt({
      ...base,
      order: { ...base.order, lines: "not lines" },
      buyer: { name: "X", email: null, phone: null },
      company: { legalName: null, address: null, taxId: null },
      payment: null,
    });
    expect(receipt.lines).toEqual([]);
    expect(receipt.buyer).toEqual({ name: "X", email: null, phone: null });
    expect(receipt.company).toEqual({ legalName: null, address: null, taxId: null });
    expect(receipt.payment).toBeNull();
  });
});

describe("masks", () => {
  it("keeps only enough to recognise the contact", () => {
    expect(maskEmail("ahmed@wasfa.online")).toBe("a***@wasfa.online");
    expect(maskEmail("broken")).toBe("***");
    expect(maskPhone("+201012345678")).toBe("+20*******678");
    expect(maskPhone("123")).toBe("***");
  });
});
