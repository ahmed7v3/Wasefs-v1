import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseSse } from "../src/adapters/openai-shared.js";
import { AiProviderError, createAdapter } from "../src/index.js";

import {
  collect,
  collectUntilError,
  enc,
  hangingSseResponse,
  request,
  sseResponse,
} from "./helpers.js";

import type { AIProviderAdapter } from "../src/index.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = "https://llm.test/v1";

function adapter(): AIProviderAdapter {
  return createAdapter({
    kind: "openai_compatible",
    baseUrl: BASE,
    apiKey: "k",
    dataPolicy: "paid_no_training",
  });
}

const frame = (value: unknown): string => JSON.stringify(value);
const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  frame({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

describe("openai-compatible stream", () => {
  it("maps text, a length finish and usage (no cost, no thinking events)", async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers = new Headers();
    server.use(
      http.post(`${BASE}/chat/completions`, async ({ request: req }) => {
        body = (await req.json()) as Record<string, unknown>;
        headers = req.headers;
        return sseResponse([
          // Compatible servers get no reasoning mapping: it is an OpenRouter extension.
          delta({ reasoning: "ignored", content: "Hi" }),
          delta({ content: " there" }, "length"),
          frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
          "[DONE]",
        ]);
      }),
    );

    const events = await collect(
      adapter().stream(
        request({ jsonSchema: { type: "object" }, thinking: "high" }),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: "text", text: "Hi" },
      { type: "text", text: " there" },
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 4,
          thinkingTokens: 0,
          searchCount: 0,
        },
      },
      { type: "done", finishReason: "length" },
    ]);
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(headers.get("x-title")).toBeNull();
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_schema", json_schema: { name: "result", strict: true } },
    });
    expect(body.provider).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it.each([
    [401, "auth"],
    [404, "not_found"],
    [429, "rate_limited"],
    [400, "bad_request"],
    [500, "unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    server.use(
      http.post(`${BASE}/chat/completions`, () =>
        HttpResponse.json({ error: { message: "SECRET" } }, { status }),
      ),
    );
    const { error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    expect((error as AiProviderError).code).toBe(code);
    expect((error as AiProviderError).message).not.toContain("SECRET");
  });

  it("maps content_filter to a safety finish", async () => {
    server.use(
      http.post(`${BASE}/chat/completions`, () =>
        sseResponse([delta({ content: "x" }, "content_filter"), "[DONE]"]),
      ),
    );
    const events = await collect(adapter().stream(request(), new AbortController().signal));
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "safety" });
  });

  it("stops after an abort mid-stream", async () => {
    server.use(
      http.post(`${BASE}/chat/completions`, () =>
        hangingSseResponse([delta({ content: "first" })]),
      ),
    );
    const controller = new AbortController();
    const seen: string[] = [];
    let error: unknown;
    try {
      for await (const event of adapter().stream(request(), controller.signal)) {
        seen.push(event.type);
        controller.abort();
      }
    } catch (caught) {
      error = caught;
    }
    expect(seen).toEqual(["text"]);
    expect((error as AiProviderError).code).toBe("timeout");
  });

  it("lists ids only and tests the connection through /models", async () => {
    server.use(
      http.get(`${BASE}/models`, () =>
        HttpResponse.json({ object: "list", data: [{ id: "llama-3" }, { id: "qwen" }] }),
      ),
    );
    expect(await adapter().listModels(new AbortController().signal)).toEqual([
      { id: "llama-3", displayName: null, contextTokens: null, capabilities: [], pricing: null },
      { id: "qwen", displayName: null, contextTokens: null, capabilities: [], pricing: null },
    ]);
    expect((await adapter().testConnection(new AbortController().signal)).ok).toBe(true);

    server.use(http.get(`${BASE}/models`, () => HttpResponse.json({}, { status: 401 })));
    expect(await adapter().testConnection(new AbortController().signal)).toMatchObject({
      ok: false,
      errorCode: "auth",
    });
  });
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
      controller.close();
    },
  });
}

async function events(chunks: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSse(streamOf(chunks))) out.push(data);
  return out;
}

describe("parseSse", () => {
  it("handles events split across chunks, mid-line and mid-CRLF", async () => {
    expect(await events(["da", 'ta: {"a"', ":1}\r", "\n\r", "\ndata: two\n\n"])).toEqual([
      '{"a":1}',
      "two",
    ]);
  });

  it("skips comments and ignores other fields", async () => {
    expect(await events([": keep-alive\n\nevent: x\nid: 1\ndata: one\n\n: ping\n\n"])).toEqual([
      "one",
    ]);
  });

  it("joins multi-line data and tolerates a missing space after the colon", async () => {
    expect(await events(["data:a\ndata: b\n\n"])).toEqual(["a\nb"]);
  });

  it("delivers a final event without a trailing blank line", async () => {
    expect(await events(["data: last"])).toEqual(["last"]);
  });

  it("splits multi-byte characters across chunks", async () => {
    const bytes = enc.encode("data: مرحبا\n\n");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });
    const out: string[] = [];
    for await (const data of parseSse(stream)) out.push(data);
    expect(out).toEqual(["مرحبا"]);
  });
});
