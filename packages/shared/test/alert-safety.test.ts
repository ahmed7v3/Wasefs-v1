import { describe, expect, it } from "vitest";

import { isSafeAlertSummary, redactAlertSummary } from "../src/alert-safety.js";

describe("admin alert summary safety", () => {
  it("allows masked phone numbers and relative links", () => {
    expect(
      isSafeAlertSummary("Order WSO-2026-000001: 120 EGP, sender 010*****678 /admin/payments/1"),
    ).toBe(true);
  });

  it("redacts phone shapes and private R2 URLs while preserving identifiers and amounts", () => {
    expect(isSafeAlertSummary("Paid by 01012345678")).toBe(false);
    expect(isSafeAlertSummary("Paid by +201012345678")).toBe(false);
    expect(redactAlertSummary("Paid by 01012345678")).toBe("Paid by 010*****678");
    expect(redactAlertSummary("Paid by 01112345678")).toBe("Paid by 011*****678");
    expect(redactAlertSummary("Paid by 01212345678")).toBe("Paid by 012*****678");
    expect(redactAlertSummary("Paid by 01512345678")).toBe("Paid by 015*****678");
    expect(redactAlertSummary("Paid by +201012345678")).toBe("Paid by 010*****678");
    expect(redactAlertSummary("Paid by 0020 101 234 5678")).toBe("Paid by 010*****678");
    expect(redactAlertSummary("Paid by +44123456789")).toBe("Paid by +44*****789");
    expect(redactAlertSummary("Paid by 0044123456789")).toBe("Paid by +44*****789");
    expect(redactAlertSummary("Proof https://bucket.r2.dev/proof.jpg")).toBe("Proof [file]");
    expect(redactAlertSummary("10000000 minor units and 123456789012 minor units")).toBe(
      "10000000 minor units and 123456789012 minor units",
    );
    expect(
      redactAlertSummary(
        "Order WSO-2026-000123 payment PAY-12345678 UUID 12345678-1234-1234-1234-123456789abc",
      ),
    ).toBe("Order WSO-2026-000123 payment PAY-12345678 UUID 12345678-1234-1234-1234-123456789abc");
  });
});
