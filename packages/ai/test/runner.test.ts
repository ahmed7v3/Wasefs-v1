import { describe, expect, it } from "vitest";

import { AiProviderError, runWithFallbacks } from "../src/index.js";

import { request } from "./helpers.js";

import type {
  AIProviderAdapter,
  AttemptInfo,
  NormalizedEvent,
  RunnerCandidate,
  Usage,
} from "../src/index.js";

const USAGE: Usage = {
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1,
  thinkingTokens: 0,
  searchCount: 0,
};

/** Adapter whose stream is a script of events and errors. */
function scripted(script: (NormalizedEvent | Error)[]): AIProviderAdapter {
  return {
    async *stream() {
      for (const step of script) {
        if (step instanceof Error) throw step;
        yield step;
      }
    },
    listModels: () => Promise.resolve([]),
    testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
  };
}

const okScript: NormalizedEvent[] = [
  { type: "text", text: "hi" },
  { type: "usage", usage: USAGE },
  { type: "done", finishReason: "stop" },
];

const candidate = (key: string, adapter: AIProviderAdapter): RunnerCandidate => ({
  key,
  adapter,
  request: request(),
});

async function run(
  candidates: RunnerCandidate[],
  options: {
    signal?: AbortSignal;
    isOpen?: (key: string) => Promise<boolean>;
    attemptTimeoutMs?: number;
  } = {},
) {
  const attempts: AttemptInfo[] = [];
  const events: unknown[] = [];
  let error: unknown;
  try {
    for await (const event of runWithFallbacks(
      candidates,
      options.signal ?? new AbortController().signal,
      {
        ...(options.isOpen ? { isOpen: options.isOpen } : {}),
        onAttempt: (info) => void attempts.push(info),
      },
      options.attemptTimeoutMs ? { attemptTimeoutMs: options.attemptTimeoutMs } : {},
    )) {
      events.push(event);
    }
  } catch (caught) {
    error = caught;
  }
  return { attempts, events, error };
}

describe("runWithFallbacks", () => {
  it("streams the primary and tags events with the candidate key", async () => {
    const { attempts, events, error } = await run([
      candidate("a", scripted(okScript)),
      candidate("b", scripted(okScript)),
    ]);
    expect(error).toBeUndefined();
    expect(events).toEqual(okScript.map((event) => ({ ...event, candidate: "a" })));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ key: "a", attempt: 1, outcome: "ok", usage: USAGE });
  });

  it("falls back in order on a retryable error before any output", async () => {
    const { attempts, events, error } = await run([
      candidate("a", scripted([new AiProviderError("rate_limited")])),
      candidate("b", scripted([new AiProviderError("unavailable")])),
      candidate("c", scripted(okScript)),
    ]);
    expect(error).toBeUndefined();
    expect(events.every((event) => (event as { candidate: string }).candidate === "c")).toBe(true);
    expect(attempts.map((a) => [a.key, a.attempt, a.outcome, a.error?.code])).toEqual([
      ["a", 1, "error", "rate_limited"],
      ["b", 2, "error", "unavailable"],
      ["c", 3, "ok", undefined],
    ]);
  });

  it("does not fall back on a non-retryable error", async () => {
    const { attempts, events, error } = await run([
      candidate("a", scripted([new AiProviderError("bad_request")])),
      candidate("b", scripted(okScript)),
    ]);
    expect((error as AiProviderError).code).toBe("bad_request");
    expect(events).toEqual([]);
    expect(attempts.map((a) => a.key)).toEqual(["a"]);
  });

  it("does not fall back once output has been yielded", async () => {
    const { attempts, events, error } = await run([
      candidate(
        "a",
        scripted([{ type: "text", text: "part" }, new AiProviderError("unavailable")]),
      ),
      candidate("b", scripted(okScript)),
    ]);
    expect(events).toEqual([{ type: "text", text: "part", candidate: "a" }]);
    expect((error as AiProviderError).code).toBe("unavailable");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ key: "a", outcome: "error" });
  });

  it("may fall back after non-output events (search) were yielded", async () => {
    const { events, error } = await run([
      candidate(
        "a",
        scripted([
          { type: "search", sources: [{ url: "https://x.test" }] },
          new AiProviderError("timeout"),
        ]),
      ),
      candidate("b", scripted(okScript)),
    ]);
    expect(error).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: "done", candidate: "b" });
  });

  it("skips candidates whose breaker is open, without an attempt", async () => {
    const { attempts, events } = await run(
      [candidate("a", scripted(okScript)), candidate("b", scripted(okScript))],
      { isOpen: (key) => Promise.resolve(key === "a") },
    );
    expect(events[0]).toMatchObject({ candidate: "b" });
    expect(attempts.map((a) => [a.key, a.attempt])).toEqual([["b", 1]]);
  });

  it("throws unavailable when every breaker is open", async () => {
    const { attempts, error } = await run([candidate("a", scripted(okScript))], {
      isOpen: () => Promise.resolve(true),
    });
    expect((error as AiProviderError).code).toBe("unavailable");
    expect(attempts).toEqual([]);
  });

  it("throws the last error when all candidates fail retryably", async () => {
    const { error, attempts } = await run([
      candidate("a", scripted([new AiProviderError("rate_limited")])),
      candidate("b", scripted([new AiProviderError("timeout")])),
    ]);
    expect((error as AiProviderError).code).toBe("timeout");
    expect(attempts).toHaveLength(2);
  });

  it("wraps unexpected errors as non-retryable unknown", async () => {
    const { error } = await run([
      candidate("a", scripted([new Error("SECRET internals")])),
      candidate("b", scripted(okScript)),
    ]);
    expect((error as AiProviderError).code).toBe("unknown");
    expect((error as AiProviderError).message).not.toContain("SECRET");
  });

  it("stops quietly on abort, reports cancelled and yields nothing further", async () => {
    const controller = new AbortController();
    const adapter: AIProviderAdapter = {
      async *stream(_req, signal) {
        yield { type: "text", text: "first" };
        controller.abort();
        // An adapter that keeps emitting after abort must not leak those events.
        yield { type: "text", text: "after-abort" };
        signal.throwIfAborted();
      },
      listModels: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    };
    const { attempts, events, error } = await run(
      [candidate("a", adapter), candidate("b", scripted(okScript))],
      { signal: controller.signal },
    );
    expect(error).toBeUndefined();
    expect(events).toEqual([{ type: "text", text: "first", candidate: "a" }]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ key: "a", outcome: "cancelled" });
  });

  it("does nothing when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { attempts, events, error } = await run([candidate("a", scripted(okScript))], {
      signal: controller.signal,
    });
    expect([attempts, events, error]).toEqual([[], [], undefined]);
  });

  it("times an attempt out and falls back", async () => {
    const hanging: AIProviderAdapter = {
      async *stream(_req, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AiProviderError("timeout")), {
            once: true,
          });
        });
        yield { type: "done", finishReason: "stop" };
      },
      listModels: () => Promise.resolve([]),
      testConnection: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    };
    const { attempts, events, error } = await run(
      [candidate("slow", hanging), candidate("b", scripted(okScript))],
      { attemptTimeoutMs: 20 },
    );
    expect(error).toBeUndefined();
    expect(attempts.map((a) => [a.key, a.outcome, a.error?.code])).toEqual([
      ["slow", "error", "timeout"],
      ["b", "ok", undefined],
    ]);
    expect(events.at(-1)).toMatchObject({ type: "done", candidate: "b" });
  });

  it("records the attempt as cancelled when the consumer stops early", async () => {
    const attempts: AttemptInfo[] = [];
    const iterator = runWithFallbacks(
      [candidate("a", scripted(okScript))],
      new AbortController().signal,
      {
        onAttempt: (info) => void attempts.push(info),
      },
    );
    await iterator.next();
    await iterator.return(undefined);
    expect(attempts.map((a) => a.outcome)).toEqual(["cancelled"]);
  });
});
