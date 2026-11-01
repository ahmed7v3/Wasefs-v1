import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RxStepError, callJson } from "../src/rx/model-call.js";

import type { Router, RouterCompletion, RouterInput } from "@wasfa/ai";

/*
 * The rx worker asks the router for ONE non-streaming completion per call. A cut call must throw,
 * never reach the JSON parser as an empty answer.
 */

const schema = z.object({ ok: z.boolean() });
const request = {
  messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: "x" }] }],
  maxOutputTokens: 100,
};
const input: Omit<RouterInput, "request" | "attemptTimeoutMs"> = {
  task: "rx_extract",
  mode: "balanced",
  planId: null,
};

function completion(text: string): RouterCompletion {
  return {
    text,
    toolCalls: [],
    usage: undefined,
    costUsdMicros: 5,
    finishReason: "stop",
    result: {
      outcome: "ok",
      modelId: "m1",
      routeVersion: 3,
      usage: undefined,
      costUsdMicros: 5,
      totalCostUsdMicros: 7,
      usageId: "usage-1",
      creditMultiplierBp: 10_000,
      attempts: 1,
    },
  };
}

function routerOf(complete: Router["complete"]): Router {
  return {
    complete,
    run: () => {
      throw new Error("run (streaming) must not be used");
    },
  };
}

describe("callJson", () => {
  it("uses router.complete and carries cost, usage row and route version", async () => {
    const seen: RouterInput[] = [];
    const router = routerOf((routerInput) => {
      seen.push(routerInput);
      return Promise.resolve(completion('{"ok":true}'));
    });
    const call = await callJson({
      router,
      input,
      request,
      schema,
      signal: new AbortController().signal,
      attemptTimeoutMs: 40_000,
    });
    expect(call).toMatchObject({
      value: { ok: true },
      costUsdMicros: 7,
      usageId: "usage-1",
      routeVersion: 3,
      calls: 1,
    });
    expect(seen[0]?.attemptTimeoutMs).toBe(40_000);
  });

  it("repairs once through complete as well", async () => {
    const answers = ["not json", '{"ok":true}'];
    const router = routerOf(() => Promise.resolve(completion(answers.shift() ?? "")));
    const call = await callJson({
      router,
      input,
      request,
      schema,
      signal: new AbortController().signal,
      attemptTimeoutMs: 1_000,
    });
    expect(call.calls).toBe(2);
  });

  it("propagates a provider failure and maps the job's own abort to budget_exceeded", async () => {
    const failing = routerOf(() => Promise.reject(new Error("provider down")));
    await expect(
      callJson({
        router: failing,
        input,
        request,
        schema,
        signal: new AbortController().signal,
        attemptTimeoutMs: 1_000,
      }),
    ).rejects.toThrow("provider down");

    const controller = new AbortController();
    const budget = routerOf(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    await expect(
      callJson({
        router: budget,
        input,
        request,
        schema,
        signal: controller.signal,
        attemptTimeoutMs: 1_000,
      }),
    ).rejects.toEqual(new RxStepError("budget_exceeded"));
  });
});
