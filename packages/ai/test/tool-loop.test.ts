import { describe, expect, it } from "vitest";

import {
  AiProviderError,
  FakeAdapter,
  ToolLoopError,
  collectCompletion,
  runToolLoop,
  scriptQueue,
} from "../src/index.js";

import type {
  CompletionResult,
  NormalizedRequest,
  ToolDefinition,
  ToolLoopCallInput,
  Usage,
} from "../src/index.js";

const TOOLS: ToolDefinition[] = [
  { name: "get_catalog", description: "Plans", parameters: { type: "object" } },
  { name: "handoff_to_owner", description: "Handoff", parameters: { type: "object" } },
];

const usage = (input: number, output: number): Usage => ({
  inputTokens: input,
  cachedInputTokens: 0,
  outputTokens: output,
  thinkingTokens: 0,
  searchCount: 0,
});

const completion = (over: Partial<CompletionResult> = {}): CompletionResult => ({
  text: "",
  toolCalls: [],
  usage: usage(100, 10),
  costUsdMicros: 7,
  finishReason: "stop",
  ...over,
});

const askFor = (...names: string[]): CompletionResult =>
  completion({
    toolCalls: names.map((name, i) => ({ id: `id_${name}_${String(i)}`, name, arguments: { i } })),
  });

/** A `call` that answers from a queue and records every input it was given. */
function scripted(replies: (CompletionResult | Error)[]) {
  const inputs: ToolLoopCallInput[] = [];
  const call = (input: ToolLoopCallInput): Promise<CompletionResult> => {
    inputs.push(input);
    const reply = replies[inputs.length - 1] ?? replies[replies.length - 1];
    if (reply === undefined || reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(reply);
  };
  return { call, inputs };
}

const base = {
  messages: [{ role: "user" as const, parts: [{ type: "text" as const, text: "hi" }] }],
  tools: TOOLS,
};

describe("runToolLoop", () => {
  it("runs the requested tool, feeds the result back and returns the final text", async () => {
    const seen: unknown[] = [];
    const { call, inputs } = scripted([
      askFor("get_catalog"),
      completion({ text: "Pro is 99 EGP" }),
    ]);
    const result = await runToolLoop({
      ...base,
      call,
      handlers: {
        get_catalog: (args) => {
          seen.push(args);
          return { plans: ["pro"] };
        },
      },
    });

    expect(result.text).toBe("Pro is 99 EGP");
    expect(result.steps).toBe(2);
    expect(result.toolCallCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(seen).toEqual([{ i: 0 }]);
    expect(inputs[0]?.toolChoice).toBe("auto");
    expect(inputs[0]?.allowFallback).toBe(true);
    // The second call sees the assistant turn and the tool result.
    expect(inputs[1]?.allowFallback).toBe(false);
    expect(result.messages.slice(1)).toEqual([
      {
        role: "assistant",
        parts: [],
        toolCalls: [{ id: "id_get_catalog_0", name: "get_catalog", arguments: { i: 0 } }],
      },
      {
        role: "tool",
        toolCallId: "id_get_catalog_0",
        name: "get_catalog",
        content: '{"plans":["pro"]}',
      },
    ]);
  });

  it("answers an unknown tool with unknown_tool without calling any handler", async () => {
    const { call } = scripted([askFor("nope"), completion({ text: "sorry" })]);
    const result = await runToolLoop({ ...base, call, handlers: {} });
    expect(result.messages.at(-1)).toMatchObject({
      role: "tool",
      content: '{"error":"unknown_tool"}',
    });
    expect(result.text).toBe("sorry");
  });

  it("does not let prototype members act as tools", async () => {
    const { call } = scripted([askFor("toString"), completion({ text: "ok" })]);
    const result = await runToolLoop({ ...base, call, handlers: {} });
    expect(result.messages.at(-1)).toMatchObject({
      role: "tool",
      content: '{"error":"unknown_tool"}',
    });
  });

  it("turns a throwing handler into tool_failed with no message or stack", async () => {
    const { call } = scripted([askFor("get_catalog"), completion({ text: "done" })]);
    const result = await runToolLoop({
      ...base,
      call,
      handlers: {
        get_catalog: () => {
          throw new Error("secret detail 0100-000-0000");
        },
      },
    });
    const tool = result.messages.find((m) => m.role === "tool");
    expect(tool).toMatchObject({ content: '{"error":"tool_failed"}' });
    expect(JSON.stringify(result.messages)).not.toContain("secret detail");
  });

  it("does not run a handler on invalid argument JSON", async () => {
    let ran = false;
    const { call } = scripted([
      completion({ toolCalls: [{ id: "a", name: "get_catalog", arguments: { __invalid: "{" } }] }),
      completion({ text: "ok" }),
    ]);
    const result = await runToolLoop({
      ...base,
      call,
      handlers: {
        get_catalog: () => {
          ran = true;
        },
      },
    });
    expect(ran).toBe(false);
    expect(result.messages.find((m) => m.role === "tool")).toMatchObject({
      content: '{"error":"invalid_arguments"}',
    });
  });

  it("caps tool calls per step but still answers every call id", async () => {
    let runs = 0;
    const { call } = scripted([
      askFor("get_catalog", "get_catalog", "get_catalog"),
      completion({ text: "ok" }),
    ]);
    const result = await runToolLoop({
      ...base,
      call,
      maxToolCallsPerStep: 2,
      handlers: {
        get_catalog: () => {
          runs++;
          return "ok";
        },
      },
    });
    expect(runs).toBe(2);
    const tools = result.messages.filter((m) => m.role === "tool");
    expect(tools.map((m) => m.content)).toEqual(["ok", "ok", '{"error":"too_many_calls"}']);
  });

  it("cuts off at maxSteps with one final call that may not use tools", async () => {
    const { call, inputs } = scripted([
      askFor("get_catalog"),
      askFor("get_catalog"),
      askFor("get_catalog"),
      completion({ text: "wrapping up" }),
    ]);
    const result = await runToolLoop({
      ...base,
      call,
      maxSteps: 3,
      handlers: { get_catalog: () => "x" },
    });
    expect(inputs.map((i) => i.toolChoice)).toEqual(["auto", "auto", "auto", "none"]);
    expect(result.steps).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("wrapping up");
  });

  it("sums usage and cost over every call", async () => {
    const { call } = scripted([
      askFor("get_catalog"),
      completion({ usage: usage(200, 20), costUsdMicros: 11, text: "end" }),
    ]);
    const result = await runToolLoop({ ...base, call, handlers: { get_catalog: () => 1 } });
    expect(result.usage).toEqual(usage(300, 30));
    expect(result.costUsdMicros).toBe(18);
  });

  it("lets a failure before any tool ran through unchanged (fallback is the router job)", async () => {
    const error = new AiProviderError("rate_limited", 429);
    const { call, inputs } = scripted([error]);
    await expect(runToolLoop({ ...base, call, handlers: {} })).rejects.toBe(error);
    expect(inputs[0]?.allowFallback).toBe(true);
  });

  it("ends with a typed error, and no fallback, when a call fails after a tool ran", async () => {
    const { call, inputs } = scripted([
      askFor("get_catalog"),
      new AiProviderError("unavailable", 503),
    ]);
    const failure = await runToolLoop({ ...base, call, handlers: { get_catalog: () => 1 } }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ToolLoopError);
    expect(failure).toMatchObject({ code: "unavailable", costUsdMicros: 7, steps: 2 });
    expect(inputs[1]?.allowFallback).toBe(false);
  });

  it("works end to end with the fake adapter script and collectCompletion", async () => {
    const adapter = new FakeAdapter(
      scriptQueue([
        {
          text: "",
          toolCalls: [{ id: "t1", name: "get_catalog", arguments: {} }],
          usage: usage(50, 5),
        },
        { text: "final answer", usage: usage(70, 7) },
      ]),
    );
    const result = await runToolLoop({
      ...base,
      handlers: { get_catalog: () => ({ ok: true }) },
      call: (input) => {
        const req: NormalizedRequest = {
          model: "fake",
          messages: input.messages,
          tools: input.tools,
          toolChoice: input.toolChoice,
          maxOutputTokens: 100,
        };
        return collectCompletion(adapter.stream(req, new AbortController().signal));
      },
    });
    expect(result.text).toBe("final answer");
    expect(result.usage).toEqual(usage(120, 12));
    expect(adapter.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool", toolCallId: "t1" });
  });
});
