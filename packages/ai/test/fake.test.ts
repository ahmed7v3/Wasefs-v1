import { describe, expect, it } from "vitest";

import { AiProviderError, createAdapter } from "../src/index.js";

import { collect, collectUntilError, request } from "./helpers.js";

const fakeConfig = {
  kind: "fake",
  baseUrl: null,
  apiKey: null,
  dataPolicy: "paid_no_training",
} as const;
const adapter = createAdapter(fakeConfig, { env: "test" });
const userText = (value: string) => [
  { role: "user" as const, parts: [{ type: "text" as const, text: value }] },
];

describe("fake adapter", () => {
  it("echoes the last user text in three chunks, then usage and done", async () => {
    const events = await collect(
      adapter.stream(
        request({ model: "fake-echo", messages: userText("abcdefghi") }),
        new AbortController().signal,
      ),
    );
    expect(events).toEqual([
      { type: "text", text: "abc" },
      { type: "text", text: "def" },
      { type: "text", text: "ghi" },
      {
        type: "usage",
        usage: {
          inputTokens: 3,
          cachedInputTokens: 0,
          outputTokens: 3,
          thinkingTokens: 0,
          searchCount: 0,
        },
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("emits JSON for fake-json", async () => {
    const events = await collect(
      adapter.stream(request({ model: "fake-json" }), new AbortController().signal),
    );
    expect(events[0]).toEqual({ type: "text", text: '{"ok":true}' });
  });

  it("throws a retryable rate_limited for fake-error-retryable", async () => {
    const { error } = await collectUntilError(
      adapter.stream(request({ model: "fake-error-retryable" }), new AbortController().signal),
    );
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).code).toBe("rate_limited");
    expect((error as AiProviderError).retryable).toBe(true);
  });

  it("reports unknown models as not_found", async () => {
    const { error } = await collectUntilError(
      adapter.stream(request({ model: "nope" }), new AbortController().signal),
    );
    expect((error as AiProviderError).code).toBe("not_found");
  });

  it("fake-slow honours abort and yields nothing after it", async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    let error: unknown;
    try {
      for await (const event of adapter.stream(
        request({ model: "fake-slow", messages: userText("abcdefghi") }),
        controller.signal,
      )) {
        seen.push(event.type);
        controller.abort();
      }
    } catch (caught) {
      error = caught;
    }
    expect(seen).toEqual(["text"]);
    expect((error as AiProviderError).code).toBe("timeout");
  });

  it("lists the fake models and tests the connection", async () => {
    const models = await adapter.listModels(new AbortController().signal);
    expect(models.map((m) => m.id)).toEqual([
      "fake-echo",
      "fake-json",
      "fake-error-retryable",
      "fake-slow",
      "fake-think",
    ]);
    expect(models.every((m) => m.capabilities.join() === "json")).toBe(true);
    expect((await adapter.testConnection(new AbortController().signal)).ok).toBe(true);
  });
});

describe("createAdapter", () => {
  it("refuses the fake adapter in production", () => {
    expect(() => createAdapter(fakeConfig, { env: "production" })).toThrow(
      expect.objectContaining({ code: "bad_request" }),
    );
  });

  it.each(["gemini", "openrouter", "openai_compatible"] as const)(
    "requires an api key for %s",
    (kind) => {
      expect(() =>
        createAdapter({
          kind,
          baseUrl: "https://x.test/v1",
          apiKey: null,
          dataPolicy: "paid_no_training",
        }),
      ).toThrow(expect.objectContaining({ code: "auth" }));
    },
  );

  it("requires a base url for openai_compatible", () => {
    expect(() =>
      createAdapter({
        kind: "openai_compatible",
        baseUrl: null,
        apiKey: "k",
        dataPolicy: "paid_no_training",
      }),
    ).toThrow(expect.objectContaining({ code: "bad_request" }));
  });
});
