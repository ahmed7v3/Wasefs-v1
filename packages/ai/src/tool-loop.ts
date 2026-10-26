import { addUsage } from "./completion.js";
import { AiProviderError } from "./types.js";

import type {
  AiErrorCode,
  CompletionResult,
  NormalizedMessage,
  ToolCall,
  ToolChoice,
  ToolDefinition,
  ToolResultMessage,
  Usage,
} from "./types.js";

/** What the loop asks `call` to run: one model turn over the conversation so far. */
export interface ToolLoopCallInput {
  messages: NormalizedMessage[];
  tools: ToolDefinition[];
  toolChoice: ToolChoice;
  /**
   * False once a tool has run: tools can have side effects, so the next model call must not move
   * to a fallback model (wire it to the router `noFallback`).
   */
  allowFallback: boolean;
}

export type ToolHandler = (args: unknown) => unknown;

export interface ToolLoopOptions {
  call(input: ToolLoopCallInput): Promise<CompletionResult>;
  /** The conversation so far (the system text goes in the request the `call` builds). */
  messages: NormalizedMessage[];
  tools: ToolDefinition[];
  /** Receive already-parsed arguments; validating them is the handler job. */
  handlers: Readonly<Record<string, ToolHandler>>;
  /** Model turns before the forced final answer. Default 5. */
  maxSteps?: number;
  /** Tool calls executed per model turn; the rest are answered with `too_many_calls`. Default 4. */
  maxToolCallsPerStep?: number;
}

export interface ToolLoopResult {
  text: string;
  /** The input messages followed by every assistant and tool message the loop added. */
  messages: NormalizedMessage[];
  usage: Usage | undefined;
  costUsdMicros: number;
  /** Model calls made, the forced final one included. */
  steps: number;
  toolCallCount: number;
  /** True when maxSteps ran out and the answer came from the forced final call. */
  truncated: boolean;
}

/** The loop failed after a tool had already run; the side effects stand, so there is no retry. */
export class ToolLoopError extends Error {
  readonly code: AiErrorCode;
  readonly costUsdMicros: number;
  readonly steps: number;

  constructor(cause: unknown, costUsdMicros: number, steps: number) {
    const code = cause instanceof AiProviderError ? cause.code : "unknown";
    super(`Tool loop failed after tools ran: ${code}`);
    this.name = "ToolLoopError";
    this.code = code;
    this.costUsdMicros = costUsdMicros;
    this.steps = steps;
  }
}

const DEFAULT_MAX_STEPS = 5;
const DEFAULT_MAX_TOOL_CALLS_PER_STEP = 4;

const errorContent = (error: string): string => JSON.stringify({ error });

function isInvalidArguments(args: unknown): boolean {
  return typeof args === "object" && args !== null && "__invalid" in args;
}

async function runTool(
  call: ToolCall,
  handlers: Readonly<Record<string, ToolHandler>>,
): Promise<string> {
  const handler = Object.hasOwn(handlers, call.name) ? handlers[call.name] : undefined;
  if (!handler) return errorContent("unknown_tool");
  if (isInvalidArguments(call.arguments)) return errorContent("invalid_arguments");
  try {
    const result = await handler(call.arguments);
    if (typeof result === "string") return result;
    // `undefined` has no JSON form.
    return JSON.stringify(result ?? null);
  } catch {
    // A handler error message or stack can carry user data; the model gets a fixed code.
    return errorContent("tool_failed");
  }
}

/**
 * Multi-step tool calling over any model `call`: ask, run the requested tools one after another,
 * feed the results back, repeat until a turn has no tool calls. Never logs arguments or results.
 */
export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_STEPS);
  const maxCalls = Math.max(1, options.maxToolCallsPerStep ?? DEFAULT_MAX_TOOL_CALLS_PER_STEP);
  const messages = [...options.messages];
  let usage: Usage | undefined;
  let costUsdMicros = 0;
  let steps = 0;
  let toolCallCount = 0;
  let toolsRan = false;

  const turn = async (toolChoice: ToolChoice): Promise<CompletionResult> => {
    steps += 1;
    let completion: CompletionResult;
    try {
      completion = await options.call({
        messages: [...messages],
        tools: options.tools,
        toolChoice,
        allowFallback: !toolsRan,
      });
    } catch (error) {
      if (toolsRan) throw new ToolLoopError(error, costUsdMicros, steps);
      throw error;
    }
    usage = addUsage(usage, completion.usage);
    costUsdMicros += completion.costUsdMicros;
    return completion;
  };

  const done = (text: string, truncated: boolean): ToolLoopResult => ({
    text,
    messages,
    usage,
    costUsdMicros,
    steps,
    toolCallCount,
    truncated,
  });

  for (let step = 0; step < maxSteps; step++) {
    const completion = await turn("auto");
    if (completion.toolCalls.length === 0) return done(completion.text, false);

    messages.push({
      role: "assistant",
      parts: completion.text === "" ? [] : [{ type: "text", text: completion.text }],
      toolCalls: completion.toolCalls,
    });
    // Every call id needs an answer, so calls over the cap get one too (without running).
    const results: ToolResultMessage[] = [];
    for (const [index, call] of completion.toolCalls.entries()) {
      let content: string;
      if (index >= maxCalls) {
        content = errorContent("too_many_calls");
      } else {
        toolsRan = true;
        toolCallCount += 1;
        content = await runTool(call, options.handlers);
      }
      results.push({ role: "tool", toolCallId: call.id, name: call.name, content });
    }
    messages.push(...results);
  }

  // Out of steps: one last call that may not use tools, so the user still gets an answer.
  const final = await turn("none");
  return done(final.text, true);
}
