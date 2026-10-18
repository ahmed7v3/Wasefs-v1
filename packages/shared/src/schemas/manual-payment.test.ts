import { describe, expect, it } from "vitest";

import { rejectManualPaymentSchema } from "./admin-manual-payments.js";
import { submitPaymentProofSchema } from "./manual-payment.js";

describe("manual payment boundary schemas", () => {
  it.each(["01012345678", "+201012345678", "00201012345678"])(
    "normalizes Egyptian phone %s",
    (senderPhone) => {
      expect(
        submitPaymentProofSchema.parse({
          txnId: " abcd-12 ",
          senderPhone,
          fileId: "00000000-0000-4000-8000-000000000000",
        }),
      ).toMatchObject({ txnId: "ABCD-12", senderPhone: "01012345678" });
    },
  );
  it("requires a reason note where it changes the financial decision", () => {
    expect(
      rejectManualPaymentSchema.safeParse({ reason: "amount_differs", override: false }).success,
    ).toBe(false);
    expect(
      rejectManualPaymentSchema.safeParse({ reason: "other", note: "Reviewed", override: false })
        .success,
    ).toBe(true);
  });
});
