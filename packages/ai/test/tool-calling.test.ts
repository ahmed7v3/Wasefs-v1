import { http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../src/index.js";

import { collect, request, sseResponse } from "./helpers.js";

import type {
  AIProviderAdapter,
  NormalizedMessage,
  NormalizedRequest,
  ToolDefinition,
} from "../src/index.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TOOLS: ToolDefinition[] = [
  {
    name: "get_catalog",
    description: "Plans and prices",
    parameters: { type: "object", properties: { market: { type: "string" } } },
  },
  {
    name: "handoff_to_owner",
    description: "Pause the agent",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

const HISTORY: NormalizedMessage[] = [
  { role: "user", parts: [{ type: "text", text: "what plans do you have?" }] },
  {
    role: "assistant",
    parts: [{ type: "text", text: "Let me check." }],
    toolCalls: [
      { id: "call_a", name: "get_catalog", arguments: { market: "eg" }, opaque: "sig-1" },
      { id: "call_b", name: "handoff_to_owner", arguments: {} },
    ],
  },
  { role: "tool", toolCallId: "call_a", name: "get_catalog", content: '{"plans":["pro"]}' },
  { role: "tool", toolCallId: "call_b", name: "handoff_to_owner", content: "plain text" },
];

const frame = (value: unknown): string => JSON.stringify(value);
const delta = (d: Record<string, unknown>, finish: string | null = null) =>
  frame({ choices: [{ index: 0, delta: d, finish_reason: finish }] });

function toolRequest(overrides: Partial<NormalizedRequest> = {}): NormalizedRequest {
  return request({ messages: HISTORY, tools: TOOLS, toolChoice: "auto", ...overrides });
}

describe.each([
  {
    name: "openai_compatible",
    url: "https://llm.test/v1/chat/completions",
    make: (): AIProviderAdapter =>
      createAdapter(
        {
          kind: "openai_compatible",
          baseUrl: "https://llm.test/v1",
          apiKey: "k",
          dataPolicy: "paid_no_training",
        },
        {},
      ),
  },
  {
    name: "openrouter",
    url: "https://or.test/api/v1/chat/completions",
    make: (): AIProviderAdapter =>
      createAdapter({
        kind: "openrouter",
        baseUrl: "https://or.test/api/v1",
        apiKey: "k",
        dataPolicy: "paid_no_training",
      }),
  },
])("$name tool calling", ({ url, make }) => {
  async function run(frames: string[], req = toolRequest()) {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(url, async ({ request: r }) => {
        body = (await r.json()) as Record<string, unknown>;
        return sseResponse(frames);
      }),
    );
    const events = await collect(make().stream(req, new AbortController().signal));
    return { body, events };
  }

  it("maps tools, tool_choice, assistant tool_calls and tool results to the wire format", async () => {
    const { body } = await run([delta({ content: "ok" }, "stop"), "[DONE]"]);

    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_catalog",
          description: "Plans and prices",
          parameters: TOOLS[0]?.parameters,
        },
      },
      {
        type: "function",
        function: {
          name: "handoff_to_owner",
          description: "Pause the agent",
          parameters: TOOLS[1]?.parameters,
        },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
    const messages = body.messages as Record<string, unknown>[];
    expect(messages[1]).toEqual({
      role: "assistant",
      content: "Let me check.",
      tool_calls: [
        {
          id: "call_a",
          type: "function",
          function: { name: "get_catalog", arguments: '{"market":"eg"}' },
        },
        { id: "call_b", type: "function", function: { name: "handoff_to_owner", arguments: "{}" } },
      ],
    });
    expect(messages[2]).toEqual({
      role: "tool",
      tool_call_id: "call_a",
      content: '{"plans":["pro"]}',
    });
    expect(messages[3]).toEqual({ role: "tool", tool_call_id: "call_b", content: "plain text" });
  });

  it("sends a named tool_choice and omits tools entirely when none are given", async () => {
    const named = await run(
      [delta({ content: "x" }, "stop")],
      toolRequest({ toolChoice: { name: "get_catalog" } }),
    );
    expect(named.body.tool_choice).toEqual({ type: "function", function: { name: "get_catalog" } });

    const plain = await run([delta({ content: "x" }, "stop")], request());
    expect(plain.body).not.toHaveProperty("tools");
    expect(plain.body).not.toHaveProperty("tool_choice");
  });

  it("assembles one streamed tool call from fragments", async () => {
    const { events } = await run([
      delta({
        tool_calls: [{ index: 0, id: "call_1", function: { name: "get_catalog", arguments: "" } }],
      }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '{"market":' } }] }),
      delta({ tool_calls: [{ index: 0, function: { arguments: '"eg"}' } }] }, "tool_calls"),
      frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } }),
      "[DONE]",
    ]);
    expect(events.filter((e) => e.type === "tool_calls")).toEqual([
      {
        type: "tool_calls",
        toolCalls: [{ id: "call_1", name: "get_catalog", arguments: { market: "eg" } }],
      },
    ]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("assembles several tool calls in index order and invents ids when the server sends none", async () => {
    const { events } = await run([
      delta({
        tool_calls: [
          { index: 1, function: { name: "handoff_to_owner", arguments: "{}" } },
          { index: 0, function: { name: "get_catalog", arguments: '{"market":"sa"}' } },
        ],
      }),
      "[DONE]",
    ]);
    expect(events.find((e) => e.type === "tool_calls")).toEqual({
      type: "tool_calls",
      toolCalls: [
        { id: "call_0", name: "get_catalog", arguments: { market: "sa" } },
        { id: "call_1", name: "handoff_to_owner", arguments: {} },
      ],
    });
  });

  it("surfaces invalid argument JSON as a truncated marker instead of throwing", async () => {
    const raw = `{"market": "${"x".repeat(900)}`;
    const { events } = await run([
      delta({
        tool_calls: [{ index: 0, id: "c", function: { name: "get_catalog", arguments: raw } }],
      }),
      "[DONE]",
    ]);
    const call = events.find((e) => e.type === "tool_calls");
    if (call?.type !== "tool_calls") throw new Error("no tool_calls event");
    expect(call.toolCalls[0]?.arguments).toEqual({ __invalid: raw.slice(0, 500) });
  });

  it("emits no tool_calls event for a plain text answer", async () => {
    const { events } = await run([delta({ content: "Hello" }, "stop"), "[DONE]"]);
    expect(events.some((e) => e.type === "tool_calls")).toBe(false);
  });
});

describe("gemini tool calling", () => {
  const STREAM_URL = "https://generativelanguage.googleapis.com/v1beta/models/*";
  const adapter = (): AIProviderAdapter =>
    createAdapter({
      kind: "gemini",
      baseUrl: null,
      apiKey: "test-key",
      dataPolicy: "paid_no_training",
    });

  async function run(frames: unknown[], req = toolRequest()) {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(STREAM_URL, async ({ request: r }) => {
        body = (await r.json()) as Record<string, unknown>;
        return sseResponse(frames.map((f) => JSON.stringify(f)));
      }),
    );
    const events = await collect(adapter().stream(req, new AbortController().signal));
    return { body, events };
  }

  const answer = [{ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] } }] }];

  it("maps declarations, function calling mode, calls and merged function responses", async () => {
    const { body } = await run(answer);

    const tools = body.tools as { functionDeclarations: Record<string, unknown>[] }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]?.functionDeclarations.map((d) => d.name)).toEqual([
      "get_catalog",
      "handoff_to_owner",
    ]);
    expect(tools[0]?.functionDeclarations[0]?.parametersJsonSchema).toEqual(TOOLS[0]?.parameters);
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });

    const contents = body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[1]?.parts).toEqual([
      { text: "Let me check." },
      {
        functionCall: { id: "call_a", name: "get_catalog", args: { market: "eg" } },
        thoughtSignature: "sig-1",
      },
      { functionCall: { id: "call_b", name: "handoff_to_owner", args: {} } },
    ]);
    // Both results share one user turn; non-object JSON is wrapped.
    expect(contents[2]?.parts).toEqual([
      {
        functionResponse: { id: "call_a", name: "get_catalog", response: { plans: ["pro"] } },
      },
      {
        functionResponse: {
          id: "call_b",
          name: "handoff_to_owner",
          response: { result: "plain text" },
        },
      },
    ]);
  });

  it("maps none and a named choice, and never sends googleSearch next to declarations", async () => {
    const none = await run(answer, toolRequest({ toolChoice: "none", search: true }));
    expect(none.body.toolConfig).toEqual({ functionCallingConfig: { mode: "NONE" } });
    const noneTools = none.body.tools as Record<string, unknown>[];
    expect(noneTools).toHaveLength(1);
    expect(noneTools[0]).not.toHaveProperty("googleSearch");

    const named = await run(answer, toolRequest({ toolChoice: { name: "get_catalog" } }));
    expect(named.body.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["get_catalog"] },
    });
  });

  it("keeps googleSearch when there are no tools", async () => {
    const { body } = await run(answer, request({ search: true }));
    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body).not.toHaveProperty("toolConfig");
  });

  it("parses several function calls, generates ids and keeps thought signatures", async () => {
    const { events } = await run([
      {
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: { name: "get_catalog", args: { market: "eg" } },
                  thoughtSignature: "sig-9",
                },
                { functionCall: { id: "given", name: "handoff_to_owner" } },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      },
    ]);
    expect(events.find((e) => e.type === "tool_calls")).toEqual({
      type: "tool_calls",
      toolCalls: [
        { id: "call_0", name: "get_catalog", arguments: { market: "eg" }, opaque: "sig-9" },
        { id: "given", name: "handoff_to_owner", arguments: {} },
      ],
    });
    expect(events.some((e) => e.type === "usage")).toBe(true);
  });

  it("emits no tool_calls event for a text answer", async () => {
    const { events } = await run(answer);
    expect(events.some((e) => e.type === "tool_calls")).toBe(false);
  });
});
