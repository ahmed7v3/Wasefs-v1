import { AiProviderError, ToolLoopError } from "@wasfa/ai";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it } from "vitest";

import { RoundRefused, type RoundFailure } from "../../src/wa-agent/turn/agent-round.js";
import { signalOf } from "../../src/wa-agent/turn/failure-policy.js";
import { fallbackTexts } from "../../src/wa-agent/turn/fallback-replies.js";

import type { FailureSignal } from "@wasfa/shared/wa-agent/failure";

const timeout = () => new DOMException("timed out", "TimeoutError");
const expired = () => {
  const controller = new AbortController();
  controller.abort(timeout());
  return controller.signal;
};
const failure = (cause: unknown): RoundFailure => ({
  cause,
  toolRecords: [],
  toolResults: [],
  costUsdMicros: 0,
  steps: [],
  handoffReason: null,
});
const modelFailed = (cause: unknown) =>
  new RoundRefused({ kind: "busy", cause: "model_failed", detail: {} }, failure(cause));

describe("signalOf", () => {
  it.each<[string, unknown, FailureSignal]>([
    [
      "provider 429",
      new AiProviderError("rate_limited"),
      { kind: "provider", code: "rate_limited" },
    ],
    ["provider auth", new AiProviderError("auth"), { kind: "provider", code: "auth" }],
    ["a step timeout", timeout(), { kind: "step_timeout" }],
    [
      "a tool loop error is judged by its cause",
      new ToolLoopError(new AiProviderError("unavailable"), 0, 2),
      { kind: "provider", code: "unavailable" },
    ],
    ["a wrapped refusal is judged by its cause", modelFailed(timeout()), { kind: "step_timeout" }],
    ["ECONNRESET", Object.assign(new Error("socket"), { code: "ECONNRESET" }), { kind: "network" }],
    ["fetch failed", new TypeError("fetch failed"), { kind: "network" }],
    [
      "undici error on the cause",
      new Error("x", { cause: Object.assign(new Error("y"), { code: "UND_ERR_SOCKET" }) }),
      { kind: "network" },
    ],
    [
      "spend cap",
      new RoundRefused({ kind: "busy", cause: "spend_cap", detail: {} }),
      { kind: "spend_cap" },
    ],
    [
      "AI unavailable",
      new RoundRefused({ kind: "busy", cause: "ai_unavailable", detail: {} }),
      { kind: "ai_off", reason: "kill_switch" },
    ],
    [
      "no model route",
      new AppError(ErrorCode.UPSTREAM_UNAVAILABLE, { details: { reason: "no_route" } }),
      { kind: "ai_off", reason: "no_model" },
    ],
    [
      "a suspended account is a deliberate state",
      new RoundRefused({ kind: "account_unavailable" }),
      { kind: "policy", reason: "blocked" },
    ],
    [
      "a refusal without a cause",
      new RoundRefused({ kind: "busy", cause: "model_failed", detail: {} }),
      { kind: "unknown" },
    ],
    ["anything else", new Error("boom"), { kind: "unknown" }],
    ["a non-error", "boom", { kind: "unknown" }],
  ])("%s", (_name, error, expected) => {
    expect(signalOf(error)).toEqual(expected);
  });

  it("a timeout while the turn's own budget is spent is a turn timeout", () => {
    expect(signalOf(timeout(), { turnSignal: expired() })).toEqual({ kind: "turn_timeout" });
    expect(signalOf(timeout(), { turnSignal: new AbortController().signal })).toEqual({
      kind: "step_timeout",
    });
  });
});

describe("fallbackTexts", () => {
  it("builds a text from what the tools returned, in order", () => {
    const texts = fallbackTexts(
      [
        { name: "get_catalog", result: { plans: [] } },
        { name: "analyze_prescription", result: { started: true, pages: 1 } },
        {
          name: "offer_discount",
          result: { offered: true, code: "ABC123", expiresAtCairo: "غدًا" },
        },
        {
          name: "start_subscription",
          result: {
            started: true,
            orderRef: "ORD-1",
            formatted: "199 ج.م",
            instructions: {
              bankName: "بنك",
              accountName: "وصفة",
              account: "123",
              reference: "R-9",
            },
          },
        },
        { name: "create_document", result: { creating: true } },
        { name: "handoff_to_owner", result: { handedOff: true } },
      ],
      "ar",
    );
    expect(texts).toHaveLength(5);
    expect(texts[0]).toContain("بقرأ الروشتة");
    expect(texts[1]).toContain("ABC123");
    expect(texts[2]).toContain("199 ج.م");
    expect(texts[2]).toContain("R-9");
    expect(texts[3]).toContain("بجهزلك الملف");
    expect(texts[4]).toContain("حولت كلامك");
  });

  it("says nothing for tools that did not do what they were asked, or have no text", () => {
    expect(
      fallbackTexts(
        [
          { name: "analyze_prescription", result: { started: false, reason: "no_image" } },
          { name: "offer_discount", result: { offered: false } },
          { name: "get_catalog", result: {} },
        ],
        "ar",
      ),
    ).toEqual([]);
  });
});
