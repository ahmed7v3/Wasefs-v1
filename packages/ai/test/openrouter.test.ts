import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiProviderError, createAdapter } from "../src/index.js";

import { collect, collectUntilError, hangingSseResponse, request, sseResponse } from "./helpers.js";

import type { AIProviderAdapter, ProviderConfig } from "../src/index.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const KEY_URL = "https://openrouter.ai/api/v1/key";

function adapter(overrides: Partial<ProviderConfig> = {}): AIProviderAdapter {
  return createAdapter({
    kind: "openrouter",
    baseUrl: null,
    apiKey: "or-key",
    dataPolicy: "paid_no_training",
    ...overrides,
  });
}

const frame = (value: unknown): string => JSON.stringify(value);
const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  frame({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

describe("openrouter stream", () => {
  it("maps reasoning (once), text, url citations, and the final usage chunk with cost", async () => {
    server.use(
      http.post(CHAT_URL, () =>
        sseResponse([
          delta({ role: "assistant", content: "" }),
          delta({
            reasoning: "hmm ",
            reasoning_details: [{ type: "reasoning.text", text: "hmm " }],
          }),
          delta({ reasoning_details: [{ type: "reasoning.summary", summary: "so" }] }),
          delta({ content: "Hel" }),
          delta({
            content: "lo",
            annotations: [
              { type: "url_citation", url_citation: { url: "https://a.test", title: "A" } },
              { type: "url_citation", url_citation: { url: "https://a.test", title: "A" } },
            ],
          }),
          delta({}, "stop"),
          frame({
            choices: [],
            usage: {
              prompt_tokens: 1120,
              completion_tokens: 800,
              prompt_tokens_details: { cached_tokens: 200 },
              completion_tokens_details: { reasoning_tokens: 300 },
              cost: 0.00123,
            },
          }),
          "[DONE]",
        ]),
      ),
    );

    const events = await collect(
      adapter().stream(
        request({ thinking: "high", includeThoughts: true, search: true }),
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: "thinking", text: "hmm " },
      { type: "thinking", text: "so" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "search", sources: [{ url: "https://a.test", title: "A" }] },
      {
        type: "usage",
        usage: {
          inputTokens: 1120,
          cachedInputTokens: 200,
          // completion_tokens (800) includes the 300 reasoning tokens.
          outputTokens: 500,
          thinkingTokens: 300,
          searchCount: 1,
          providerCostUsdMicros: 1230,
        },
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("sends routing, reasoning, plugins, schema, image data URL and attribution headers", async () => {
    let body: Record<string, unknown> = {};
    let headers: Headers = new Headers();
    server.use(
      http.post(CHAT_URL, async ({ request: req }) => {
        body = (await req.json()) as Record<string, unknown>;
        headers = req.headers;
        return sseResponse([delta({ content: "{}" }, "stop"), "[DONE]"]);
      }),
    );

    await collect(
      adapter({ dataPolicy: "zdr" }).stream(
        request({
          model: "google/gemini-3-flash",
          system: "be brief",
          temperature: 0.1,
          thinking: "low",
          jsonSchema: { type: "object" },
          search: true,
          messages: [
            {
              role: "user",
              parts: [
                { type: "text", text: "see" },
                { type: "image", mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) },
              ],
            },
          ],
        }),
        new AbortController().signal,
      ),
    );

    expect(headers.get("authorization")).toBe("Bearer or-key");
    expect(headers.get("http-referer")).toBe("https://wasfa.online");
    expect(headers.get("x-title")).toBe("Wasfa AI");
    expect(body).toMatchObject({
      model: "google/gemini-3-flash",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 256,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", strict: true, schema: { type: "object" } },
      },
      reasoning: { effort: "low", exclude: true },
      plugins: [{ id: "web" }],
      provider: { data_collection: "deny", allow_fallbacks: true, zdr: true },
      messages: [
        { role: "system", content: "be brief" },
        {
          role: "user",
          content: [
            { type: "text", text: "see" },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
          ],
        },
      ],
    });
  });

  it("disables reasoning for thinking off and omits zdr unless the policy asks for it", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(CHAT_URL, async ({ request: req }) => {
        body = (await req.json()) as Record<string, unknown>;
        return sseResponse([delta({ content: "x" }, "stop"), "[DONE]"]);
      }),
    );
    await collect(adapter().stream(request({ thinking: "off" }), new AbortController().signal));
    expect(body.reasoning).toEqual({ enabled: false });
    expect(body.provider).toEqual({ data_collection: "deny", allow_fallbacks: true });
    expect(body.plugins).toBeUndefined();
  });

  it("honours a base url override", async () => {
    let hit = false;
    server.use(
      http.post("https://proxy.test/v1/chat/completions", () => {
        hit = true;
        return sseResponse([delta({ content: "x" }, "stop"), "[DONE]"]);
      }),
    );
    await collect(
      adapter({ baseUrl: "https://proxy.test/v1/" }).stream(
        request(),
        new AbortController().signal,
      ),
    );
    expect(hit).toBe(true);
  });

  it("maps a mid-stream error event by its code, never its text", async () => {
    server.use(
      http.post(CHAT_URL, () =>
        sseResponse([
          delta({ content: "partial" }),
          frame({ error: { code: 429, message: "SECRET echo" } }),
        ]),
      ),
    );
    const { events, error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    expect(events).toEqual([{ type: "text", text: "partial" }]);
    expect((error as AiProviderError).code).toBe("rate_limited");
    expect((error as AiProviderError).message).not.toContain("SECRET");
  });

  it.each([
    [401, "auth", false],
    [402, "unavailable", true],
    [403, "auth", false],
    [404, "not_found", false],
    [408, "timeout", true],
    [429, "rate_limited", true],
    [400, "bad_request", false],
    [502, "unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    server.use(
      http.post(CHAT_URL, () =>
        HttpResponse.json({ error: { message: "SECRET prompt echo" } }, { status }),
      ),
    );
    const { error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    const providerError = error as AiProviderError;
    expect(providerError).toBeInstanceOf(AiProviderError);
    expect(providerError.code).toBe(code);
    expect(providerError.retryable).toBe(retryable);
    expect(providerError.status).toBe(status);
    expect(providerError.message).not.toContain("SECRET");
  });

  it("maps a network failure to unavailable", async () => {
    server.use(http.post(CHAT_URL, () => HttpResponse.error()));
    const { error } = await collectUntilError(
      adapter().stream(request(), new AbortController().signal),
    );
    expect((error as AiProviderError).code).toBe("unavailable");
  });

  it("stops after an abort mid-stream", async () => {
    server.use(http.post(CHAT_URL, () => hangingSseResponse([delta({ content: "first" })])));
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

describe("openrouter listModels / testConnection", () => {
  it("converts USD-per-token strings to micros per 1M and derives capabilities", async () => {
    server.use(
      http.get(MODELS_URL, () =>
        HttpResponse.json({
          data: [
            {
              id: "google/gemini-3.8-flash",
              name: "Gemini 3.8 Flash",
              context_length: 1_048_576,
              architecture: { input_modalities: ["text", "image"] },
              supported_parameters: ["reasoning", "response_format", "tools"],
              pricing: {
                prompt: "0.00000075",
                completion: "0.0000375",
                input_cache_read: "0.000000075",
                web_search: "0.035",
              },
            },
            {
              id: "openrouter/auto",
              name: "Auto Router",
              context_length: 2_000_000,
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["structured_outputs"],
              pricing: { prompt: "-1", completion: "-1" },
            },
            {
              id: "meta/free:free",
              architecture: { input_modalities: ["text"] },
              pricing: { prompt: "0", completion: "0" },
            },
          ],
        }),
      ),
    );
    const models = await adapter().listModels(new AbortController().signal);
    expect(models).toEqual([
      {
        id: "google/gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        contextTokens: 1_048_576,
        capabilities: ["vision", "thinking", "json"],
        pricing: {
          inputUsdMicrosPerM: 750_000,
          cachedInputUsdMicrosPerM: 75_000,
          outputUsdMicrosPerM: 37_500_000,
          searchUsdMicros: 35_000,
        },
      },
      {
        id: "openrouter/auto",
        displayName: "Auto Router",
        contextTokens: 2_000_000,
        capabilities: ["json"],
        pricing: null,
      },
      {
        id: "meta/free:free",
        displayName: null,
        contextTokens: null,
        capabilities: [],
        pricing: {
          inputUsdMicrosPerM: 0,
          cachedInputUsdMicrosPerM: null,
          outputUsdMicrosPerM: 0,
          searchUsdMicros: null,
        },
      },
    ]);
  });

  it("tests the connection against /key and maps failures", async () => {
    server.use(http.get(KEY_URL, () => HttpResponse.json({ data: { label: "k" } })));
    const ok = await adapter().testConnection(new AbortController().signal);
    expect(ok.ok).toBe(true);

    server.use(http.get(KEY_URL, () => HttpResponse.json({}, { status: 401 })));
    expect(await adapter().testConnection(new AbortController().signal)).toMatchObject({
      ok: false,
      errorCode: "auth",
    });

    server.use(http.get(KEY_URL, () => HttpResponse.json({}, { status: 503 })));
    expect(await adapter().testConnection(new AbortController().signal)).toMatchObject({
      ok: false,
      errorCode: "unavailable",
    });
  });
});
