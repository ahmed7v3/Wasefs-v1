import type { RouterEvent } from "./router.js";
import type { CompletionResult, NormalizedEvent, ToolCall, Usage } from "./types.js";

/**
 * Drains a router (or adapter) event stream into one result, for callers that do not stream.
 * Cost comes from the router `result` event (all attempts); a bare adapter stream reports 0.
 */
export async function collectCompletion(
  events: AsyncIterable<RouterEvent | NormalizedEvent>,
): Promise<CompletionResult> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: Usage | undefined;
  let costUsdMicros = 0;
  let finishReason: CompletionResult["finishReason"] = "stop";
  for await (const event of events) {
    switch (event.type) {
      case "text":
        text += event.text;
        break;
      case "tool_calls":
        toolCalls.push(...event.toolCalls);
        break;
      case "usage":
        usage = event.usage;
        break;
      case "done":
        finishReason = event.finishReason;
        break;
      case "result":
        usage = event.result.usage ?? usage;
        costUsdMicros = event.result.totalCostUsdMicros;
        break;
      default:
        break;
    }
  }
  return { text, toolCalls, usage, costUsdMicros, finishReason };
}

/** Field-wise sum; `providerCostUsdMicros` stays absent unless some part had it. */
export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum: Usage = {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thinkingTokens: a.thinkingTokens + b.thinkingTokens,
    searchCount: a.searchCount + b.searchCount,
  };
  if (a.providerCostUsdMicros !== undefined || b.providerCostUsdMicros !== undefined) {
    sum.providerCostUsdMicros = (a.providerCostUsdMicros ?? 0) + (b.providerCostUsdMicros ?? 0);
  }
  return sum;
}
