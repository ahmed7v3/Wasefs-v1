import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiProviderError, createAdapter } from "../src/index.js";

import { collect, collectUntilError, hangingSseResponse, request, sseResponse } from "./helpers.js";

import type { AIProviderAdapter } from "../src/index.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const STREAM_URL = "https://generativelanguage.googleapis.com/v1beta/models/*";
const LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function adapter(): AIProviderAdapter {
  return createAdapter({
    kind: "gemini",
    baseUrl: null,
    apiKey: "test-key",
    dataPolicy: "paid_no_training",
  });
}

const frame = (value: unknown): string => JSON.stringify(value);
const textChunk = (text: string, extra: Record<string, unknown> = {}) =>
  frame({ candidates: [{ content: { role: "model", parts: [{ text }] }, ...extra }] });

describe("gemini stream", () => {
  it("maps text, thought parts, grounding sources (deduped) and one final usage", async () => {
    server.use(
      http.post(STREAM_URL, () =>
        sseResponse([
          frame({
            candidates: [
              { content: { role: "model", parts: [{ text: "pondering", thought: true }] } },
            ],
          }),
          textChunk("Hel"),
          textChunk("lo", {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://a.test/1", title: "A" } },
                { web: { uri: "https://b.test/2" } },
              ],
            },
          }),
          frame({
            candidates: [
              {
                content: { role: "model", parts: [{ text: "!" }] },
                finishReason: "STOP",
                groundingMetadata: {
                  groundingChunks: [{ web: { uri: "https://a.test/1", title: "A" } }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 1120,
              cachedContentTokenCount: 200,
              candidatesTokenCount: 500,
              thoughtsTokenCount: 300,
            },
          }),
        ]),
      ),
    );

    const events = await collect(
      adapter().stream(
        request({ model: "gemini-3-flash", search: true }),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: "thinking", text: "pondering" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      {
        type: "search",
        sources: [{ url: "https://a.test/1", title: "A" }, { url: "https://b.test/2" }],
      },
      { type: "text", text: "!" },
      {
        type: "usage",
        usage: {
          inputTokens: 1120,
          cachedInputTokens: 200,
          outputTokens: 500,
          thinkingTokens: 300,
          searchCount: 1,
        },
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("sends the request in Gemini's shape (level thinking, JSON schema, media resolution, search)", async () => {
    let body: Record<string, unknown> = {};
    let url = "";
    server.use(
      http.post(STREAM_URL, async ({ request: req }) => {
        body = (await req.json()) as Record<string, unknown>;
        url = req.url;
        return sseResponse([textChunk("{}", { finishReason: "STOP" })]);
      }),
    );

    await collect(
      adapter().stream(
        request({
          model: "gemini-3-flash",
          system: "be brief",
          temperature: 0.2,
          thinking: "medium",
          includeThoughts: true,
          mediaResolution: "ultra_high",
          jsonSchema: { type: "object" },
          search: true,
          messages: [
            {
              role: "user",
              parts: [
                { type: "text", text: "read this" },
                { type: "image", mime: "image/png", data: new Uint8Array([1, 2, 3]) },
              ],
            },
          ],
        }),
        new AbortController().signal,
      ),
    );

    expect(url).toContain("gemini-3-flash:streamGenerateContent");
    expect(url).toContain("alt=sse");
    expect(body.systemInstruction).toMatchObject({ parts: [{ text: "be brief" }] });
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [{ text: "read this" }, { inlineData: { mimeType: "image/png", data: "AQID" } }],
      },
    ]);
    expect(body.generationConfig).toMatchObject({
      maxOutputTokens: 256,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "MEDIUM", includeThoughts: true },
      mediaResolution: "MEDIA_RESOLUTION_HIGH",
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
    });
    expect(JSON.stringify(body.generationConfig)).not.toContain("thinkingBudget");
  });

  it("turns thinking off with a zero budget and no level", async () => {
    let body: { generationConfig?: { thinkingConfig?: Record<string, unknown> } } = {};
    server.use(
      http.post(STREAM_URL, async ({ request: req }) => {
        body = (await req.json()) as typeof body;
        return sseResponse([textChunk("ok", { finishReason: "STOP" })]);
      }),
    );
    await collect(adapter().stream(request({ thinking: "off" }), new AbortController().signal));
    expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("maps finish reasons", async () => {
    server.use(
      http.post(STREAM_URL, () => sseResponse([textChunk("x", { finishReason: "MAX_TOKENS" })])),
    );
    const events = await collect(adapter().stream(request(), new AbortController().signal));
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "length" });

    server.use(
      http.post(STREAM_URL, () => sseResponse([textChunk("x", { finishReason: "SAFETY" })])),
    );
    const safety = await collect(adapter().stream(request(), new AbortController().signal));
    expect(safety.at(-1)).toEqual({ type: "done", finishReason: "safety" });
  });

  it("reports a blocked prompt as content_blocked", async () => {
    server.use(
      http.post(STREAM_URL, () =>
        sseResponse([frame({ promptFeedback: { blockReason: "SAFETY" } })]),
      ),
    );
    const { error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    expect((error as AiProviderError).code).toBe("content_blocked");
    expect((error as AiProviderError).retryable).toBe(false);
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [404, "not_found", false],
    [429, "rate_limited", true],
    [400, "bad_request", false],
    [500, "unavailable", true],
    [503, "unavailable", true],
  ] as const)(
    "maps HTTP %i to %s without leaking provider text",
    async (status, code, retryable) => {
      server.use(
        http.post(STREAM_URL, () =>
          HttpResponse.json(
            { error: { code: status, message: "SECRET prompt echo sk-leak", status: "X" } },
            { status },
          ),
        ),
      );
      const { events, error } = await collectUntilError(
        adapter().stream(request(), new AbortController().signal),
      );
      expect(events).toEqual([]);
      expect(error).toBeInstanceOf(AiProviderError);
      const providerError = error as AiProviderError;
      expect(providerError.code).toBe(code);
      expect(providerError.retryable).toBe(retryable);
      expect(providerError.message).not.toContain("SECRET");
      expect(providerError.message).not.toContain("sk-leak");
    },
  );

  it("maps a network failure to unavailable", async () => {
    server.use(http.post(STREAM_URL, () => HttpResponse.error()));
    const { error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    expect((error as AiProviderError).code).toBe("unavailable");
  });

  it("stops after an abort mid-stream and maps it to timeout", async () => {
    server.use(http.post(STREAM_URL, () => hangingSseResponse([textChunk("first")])));
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
});

describe("gemini listModels / testConnection", () => {
  it("pages, keeps generateContent models, strips models/ and derives capabilities", async () => {
    server.use(
      http.get(LIST_URL, ({ request: req }) => {
        const token = new URL(req.url).searchParams.get("pageToken");
        if (!token) {
          return HttpResponse.json({
            models: [
              {
                name: "models/gemini-3-flash",
                displayName: "Gemini 3 Flash",
                inputTokenLimit: 1_000_000,
                supportedGenerationMethods: ["generateContent", "countTokens"],
                thinking: true,
              },
              { name: "models/text-embedding-9", supportedGenerationMethods: ["embedContent"] },
            ],
            nextPageToken: "p2",
          });
        }
        return HttpResponse.json({
          models: [
            { name: "models/gemma-4-31b-it", supportedGenerationMethods: ["generateContent"] },
          ],
        });
      }),
    );
    const models = await adapter().listModels(new AbortController().signal);
    expect(models).toEqual([
      {
        id: "gemini-3-flash",
        displayName: "Gemini 3 Flash",
        contextTokens: 1_000_000,
        capabilities: ["vision", "thinking", "search", "json"],
        pricing: null,
      },
      {
        id: "gemma-4-31b-it",
        displayName: null,
        contextTokens: null,
        capabilities: ["vision", "json"],
        pricing: null,
      },
    ]);
  });

  it("reports ok with latency, and maps failures to an error code", async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json({ models: [] })));
    const ok = await adapter().testConnection(new AbortController().signal);
    expect(ok.ok).toBe(true);
    expect(ok.errorCode).toBeUndefined();
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);

    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json({ error: { message: "bad key" } }, { status: 403 }),
      ),
    );
    const failed = await adapter().testConnection(new AbortController().signal);
    expect(failed).toMatchObject({ ok: false, errorCode: "auth" });
  });
});
