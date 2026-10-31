import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  FAILURE_CLASSES,
  FAILURE_TEXT_KEYS,
  JOB_RETRY_DELAYS_MS,
  STEP_RETRY_DELAYS_MS,
  actionFor,
  classify,
  terminalStateOf,
  type ActionContext,
  type FailureAction,
  type FailureClass,
  type FailureSignal,
  type ProviderErrorCode,
} from "../src/wa-agent/failure.js";

const base: ActionContext = {
  attempt: 1,
  jobRetries: 3,
  stepRetriesUsed: 0,
  reasked: false,
  customerTextAllowed: true,
  customerTextInMs: 0,
  rateDeferred: false,
};
const ctx = (over: Partial<ActionContext> = {}): ActionContext => ({ ...base, ...over });

const PROVIDER_CODES: ProviderErrorCode[] = [
  "auth",
  "rate_limited",
  "timeout",
  "unavailable",
  "bad_request",
  "content_blocked",
  "not_found",
  "unknown",
];

const signalArb: fc.Arbitrary<FailureSignal> = fc.oneof(
  fc.constantFrom(...PROVIDER_CODES).map((code) => ({ kind: "provider" as const, code })),
  fc.constantFrom<FailureSignal>(
    { kind: "step_timeout" },
    { kind: "turn_timeout" },
    { kind: "network" },
    { kind: "empty_answer" },
    { kind: "spend_cap" },
    { kind: "unknown" },
  ),
  fc
    .constantFrom("kill_switch", "global_cap", "no_model")
    .map((reason) => ({ kind: "ai_off" as const, reason })),
  fc
    .constantFrom("paused", "blocked", "disabled", "caps")
    .map((reason) => ({ kind: "policy" as const, reason })),
);

const ctxArb: fc.Arbitrary<ActionContext> = fc.record({
  attempt: fc.integer({ min: 1, max: 6 }),
  jobRetries: fc.integer({ min: 0, max: 3 }),
  stepRetriesUsed: fc.integer({ min: 0, max: 2 }),
  reasked: fc.boolean(),
  customerTextAllowed: fc.boolean(),
  customerTextInMs: fc.integer({ min: 0, max: 600_000 }),
  rateDeferred: fc.boolean(),
});

describe("classify", () => {
  it.each<[FailureSignal, boolean, FailureClass]>([
    [{ kind: "provider", code: "rate_limited" }, false, "transient"],
    [{ kind: "provider", code: "unavailable" }, false, "transient"],
    [{ kind: "provider", code: "timeout" }, false, "transient"],
    [{ kind: "step_timeout" }, false, "transient"],
    [{ kind: "turn_timeout" }, false, "transient"],
    [{ kind: "network" }, false, "transient"],
    [{ kind: "provider", code: "auth" }, false, "permanent"],
    [{ kind: "provider", code: "bad_request" }, false, "permanent"],
    [{ kind: "provider", code: "content_blocked" }, false, "permanent"],
    [{ kind: "provider", code: "not_found" }, false, "permanent"],
    [{ kind: "provider", code: "unknown" }, false, "permanent"],
    [{ kind: "unknown" }, false, "permanent"],
    [{ kind: "spend_cap" }, false, "spend_cap"],
    [{ kind: "ai_off", reason: "kill_switch" }, false, "ai_off"],
    [{ kind: "ai_off", reason: "global_cap" }, false, "ai_off"],
    [{ kind: "empty_answer" }, false, "empty_answer"],
    [{ kind: "empty_answer" }, true, "empty_answer"],
    [{ kind: "policy", reason: "paused" }, false, "policy"],
    [{ kind: "policy", reason: "blocked" }, true, "policy"],
    // After an effect, every non-policy failure must report what already happened.
    [{ kind: "provider", code: "rate_limited" }, true, "after_tools"],
    [{ kind: "step_timeout" }, true, "after_tools"],
    [{ kind: "unknown" }, true, "after_tools"],
    [{ kind: "spend_cap" }, true, "after_tools"],
    [{ kind: "ai_off", reason: "no_model" }, true, "after_tools"],
  ])("%j (effectsRan=%s) → %s", (signal, effectsRan, expected) => {
    expect(classify(signal, { effectsRan })).toBe(expected);
  });

  it("is total and only returns known classes", () => {
    fc.assert(
      fc.property(signalArb, fc.boolean(), (signal, effectsRan) => {
        expect(FAILURE_CLASSES).toContain(classify(signal, { effectsRan }));
      }),
    );
  });
});

describe("actionFor: transient (retry ladder)", () => {
  it("retries the step twice with 1.5 s and 4 s", () => {
    expect(actionFor("transient", ctx({ stepRetriesUsed: 0 }))).toEqual({
      type: "retry_step",
      delayMs: STEP_RETRY_DELAYS_MS[0],
    });
    expect(actionFor("transient", ctx({ stepRetriesUsed: 1 }))).toEqual({
      type: "retry_step",
      delayMs: STEP_RETRY_DELAYS_MS[1],
    });
  });

  it("then defers the job with 20/60/180 s, telling the customer only on the first deferral", () => {
    expect(actionFor("transient", ctx({ stepRetriesUsed: 2, attempt: 1 }))).toEqual({
      type: "defer",
      delayMs: JOB_RETRY_DELAYS_MS[0],
      text: FAILURE_TEXT_KEYS.deferred,
    });
    expect(actionFor("transient", ctx({ stepRetriesUsed: 2, attempt: 2 }))).toEqual({
      type: "defer",
      delayMs: JOB_RETRY_DELAYS_MS[1],
      text: null,
    });
    expect(actionFor("transient", ctx({ stepRetriesUsed: 2, attempt: 3 }))).toEqual({
      type: "defer",
      delayMs: JOB_RETRY_DELAYS_MS[2],
      text: null,
    });
  });

  it("does not tell the customer about the first deferral when the text limit is hit", () => {
    expect(
      actionFor("transient", ctx({ stepRetriesUsed: 2, customerTextAllowed: false })),
    ).toMatchObject({ type: "defer", text: null });
  });

  it("ends failed_replied with a reference after the last retry", () => {
    const action = actionFor("transient", ctx({ stepRetriesUsed: 2, attempt: 4 }));
    expect(action).toEqual({
      type: "fail",
      text: FAILURE_TEXT_KEYS.failed,
      withRef: true,
      errorEvent: true,
      ownerAlert: true,
    });
    expect(terminalStateOf(action)).toBe("failed_replied");
  });

  it("waits once for the customer-text limit instead of ending silently", () => {
    expect(
      actionFor(
        "transient",
        ctx({ stepRetriesUsed: 2, attempt: 4, customerTextAllowed: false, customerTextInMs: 90_000 }),
      ),
    ).toEqual({ type: "defer", delayMs: 90_000, text: null });
    expect(
      actionFor(
        "transient",
        ctx({ stepRetriesUsed: 2, attempt: 4, customerTextAllowed: false, rateDeferred: true }),
      ),
    ).toMatchObject({ type: "fail", ownerAlert: true });
  });

  it("with no job retries configured goes straight from the ladder to the failure text", () => {
    expect(actionFor("transient", ctx({ stepRetriesUsed: 2, jobRetries: 0 }))).toMatchObject({
      type: "fail",
    });
  });
});

describe("actionFor: other classes", () => {
  it("after_tools replies from the tool records, never the busy line", () => {
    const action = actionFor("after_tools", ctx());
    expect(action).toEqual({ type: "fallback_from_tools", otherwise: FAILURE_TEXT_KEYS.ack });
    expect(terminalStateOf(action)).toBe("replied");
  });

  it("empty_answer re-asks once, then falls back to the tool records", () => {
    expect(actionFor("empty_answer", ctx({ reasked: false }))).toEqual({
      type: "reask_without_tools",
    });
    expect(actionFor("empty_answer", ctx({ reasked: true }))).toEqual({
      type: "fallback_from_tools",
      otherwise: FAILURE_TEXT_KEYS.ack,
    });
  });

  it.each<FailureClass>(["spend_cap", "ai_off"])(
    "%s sends the paused text without a reference and alerts the owner",
    (cls) => {
      expect(actionFor(cls, ctx())).toEqual({
        type: "fail",
        text: FAILURE_TEXT_KEYS.aiPaused,
        withRef: false,
        errorEvent: false,
        ownerAlert: true,
      });
      // Once per day per chat: after that the turn is a recorded policy drop.
      expect(actionFor(cls, ctx({ customerTextAllowed: false }))).toEqual({ type: "drop" });
    },
  );

  it("permanent sends the failure text with a reference and stores an error event", () => {
    expect(actionFor("permanent", ctx())).toEqual({
      type: "fail",
      text: FAILURE_TEXT_KEYS.failed,
      withRef: true,
      errorEvent: true,
      ownerAlert: true,
    });
  });

  it("policy drops without a reply", () => {
    const action = actionFor("policy", ctx());
    expect(action).toEqual({ type: "drop" });
    expect(terminalStateOf(action)).toBe("dropped_policy");
  });
});

describe("invariants", () => {
  const sentText = (action: FailureAction): string | null => {
    switch (action.type) {
      case "defer":
        return action.text;
      case "fail":
        return action.text;
      case "fallback_from_tools":
        return action.otherwise;
      default:
        return null;
    }
  };

  it("never asks for the retired busy line and never pauses the chat", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FAILURE_CLASSES), ctxArb, (cls, c) => {
        const action = actionFor(cls, c);
        expect(sentText(action)).not.toBe("whatsapp.agent.busy");
        expect(Object.keys(action)).not.toContain("pause");
      }),
    );
  });

  it("only a policy state (or the once-a-day paused notice) ends without anything sent", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FAILURE_CLASSES), ctxArb, (cls, c) => {
        const action = actionFor(cls, c);
        if (action.type !== "drop") return;
        const allowedDrop =
          cls === "policy" || ((cls === "spend_cap" || cls === "ai_off") && !c.customerTextAllowed);
        expect(allowedDrop).toBe(true);
      }),
    );
  });

  it("a failure text never goes out while the customer-text limit forbids it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FAILURE_CLASSES), ctxArb, (cls, c) => {
        const action = actionFor(cls, c);
        if (c.customerTextAllowed) return;
        if (action.type === "defer") expect(action.text).toBeNull();
        if (action.type === "fail" && (cls === "spend_cap" || cls === "ai_off")) {
          throw new Error("paused notice sent over the limit");
        }
      }),
    );
  });

  it("a silent end (fail without a text being allowed) always alerts the owner", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FAILURE_CLASSES), ctxArb, (cls, c) => {
        const action = actionFor(cls, c);
        if (action.type === "fail" && !c.customerTextAllowed) expect(action.ownerAlert).toBe(true);
      }),
    );
  });

  it("every wait is bounded and positive", () => {
    fc.assert(
      fc.property(fc.constantFrom(...FAILURE_CLASSES), ctxArb, (cls, c) => {
        const action = actionFor(cls, c);
        if (action.type === "retry_step" || action.type === "defer") {
          expect(action.delayMs).toBeGreaterThan(0);
          expect(action.delayMs).toBeLessThanOrEqual(600_000);
        }
      }),
    );
  });

  it("a run of transient failures terminates within the ladder plus the retries", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3 }), fc.boolean(), (jobRetries, allowed) => {
        let attempt = 1;
        let rateDeferred = false;
        for (let runs = 0; runs < 20; runs += 1) {
          let step = 0;
          let action = actionFor("transient", ctx({ attempt, jobRetries, stepRetriesUsed: step }));
          while (action.type === "retry_step") {
            step += 1;
            action = actionFor("transient", ctx({ attempt, jobRetries, stepRetriesUsed: step }));
          }
          action = actionFor(
            "transient",
            ctx({
              attempt,
              jobRetries,
              stepRetriesUsed: step,
              customerTextAllowed: allowed,
              customerTextInMs: 1_000,
              rateDeferred,
            }),
          );
          if (action.type !== "defer") return;
          if (attempt > jobRetries) rateDeferred = true;
          else attempt += 1;
        }
        throw new Error("transient failures never terminated");
      }),
    );
  });
});
