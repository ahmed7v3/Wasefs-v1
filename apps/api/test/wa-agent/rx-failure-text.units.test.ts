import { WA_RX_FAILURE_REASONS } from "@wasfa/shared/schemas/wa-agent";
import { describe, expect, it } from "vitest";

import { rxFailureText } from "../../src/wa-agent/commerce/agent-event-messages.js";

describe("rxFailureText", () => {
  it("has a text for every reason, in both languages, all different", () => {
    for (const locale of ["ar", "en"] as const) {
      const texts = WA_RX_FAILURE_REASONS.map((reason) => rxFailureText(reason, true, locale));
      expect(texts.every((text) => text.trim() !== "")).toBe(true);
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it("claims the credits came back only when the worker observed it", () => {
    for (const reason of [
      "unreadable_image",
      "not_a_prescription",
      "model_unavailable",
      "internal",
    ] as const) {
      expect(rxFailureText(reason, true, "ar")).toContain("ورجّعنا لك الرصيد");
      const not = rxFailureText(reason, false, "ar");
      expect(not).not.toContain("ورجّعنا");
      expect(not).not.toContain("أعدنا");
      expect(rxFailureText(reason, false, "en")).not.toContain("returned.");
    }
  });
});
