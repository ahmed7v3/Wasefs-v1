import { AiProviderError } from "@wasfa/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import { failureReason, refundedReason } from "../src/rx/failure.js";
import { RxStepError } from "../src/rx/model-call.js";

import type { RxResult } from "@wasfa/shared/schemas/rx";

const result = (items: number, regions: number) =>
  ({
    items: Array.from({ length: items }, () => ({})),
    unreadableRegions: Array.from({ length: regions }, () => ({})),
  }) as unknown as RxResult;

describe("rx failure reasons", () => {
  it("maps a refunded reading to not_a_prescription or unreadable_image", () => {
    expect(refundedReason(result(0, 0))).toBe("not_a_prescription");
    expect(refundedReason(result(0, 2))).toBe("unreadable_image");
    expect(refundedReason(result(3, 0))).toBe("unreadable_image");
  });

  it("maps job failures to the customer's reason", () => {
    expect(failureReason(new RxStepError("no_answer"))).toBe("model_unavailable");
    expect(failureReason(new RxStepError("budget_exceeded"))).toBe("model_unavailable");
    expect(failureReason(new AiProviderError("unavailable"))).toBe("model_unavailable");
    expect(failureReason(new AppError(ErrorCode.UPSTREAM_UNAVAILABLE))).toBe("model_unavailable");
    expect(failureReason(new RxStepError("invalid_model_output"))).toBe("internal");
    expect(failureReason(new RxStepError("image_missing"))).toBe("internal");
    expect(failureReason(new Error("boom"))).toBe("internal");
  });
});
