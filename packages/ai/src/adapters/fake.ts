import { AiProviderError } from "../types.js";

import type {
  AIProviderAdapter,
  ConnectionResult,
  DiscoveredModel,
  NormalizedEvent,
  NormalizedRequest,
} from "../types.js";

/** Deterministic adapter for dev, e2e and unit tests. Never available in production (see createAdapter). */

const FAKE_MODELS = ["fake-echo", "fake-json", "fake-error-retryable", "fake-slow"] as const;
const SLOW_STEP_MS = 50;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AiProviderError("timeout"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AiProviderError("timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function lastUserText(req: NormalizedRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const message = req.messages[i];
    if (message?.role !== "user") continue;
    return message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  }
  return "";
}

function inputChars(req: NormalizedRequest): number {
  let chars = req.system?.length ?? 0;
  for (const message of req.messages) {
    for (const part of message.parts) if (part.type === "text") chars += part.text.length;
  }
  return chars;
}

/** Splits into at most three non-empty chunks, by code point so surrogate pairs stay whole. */
function threeChunks(text: string): string[] {
  const chars = Array.from(text);
  const size = Math.max(1, Math.ceil(chars.length / 3));
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(""));
  return chunks;
}

export class FakeAdapter implements AIProviderAdapter {
  async *stream(req: NormalizedRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent> {
    if (!(FAKE_MODELS as readonly string[]).includes(req.model))
      throw new AiProviderError("not_found");
    if (req.model === "fake-error-retryable") throw new AiProviderError("rate_limited");

    const chunks =
      req.model === "fake-json" ? [JSON.stringify({ ok: true })] : threeChunks(lastUserText(req));
    let outputChars = 0;
    for (const [index, chunk] of chunks.entries()) {
      if (req.model === "fake-slow" && index > 0) await wait(SLOW_STEP_MS, signal);
      if (signal.aborted) throw new AiProviderError("timeout");
      outputChars += chunk.length;
      yield { type: "text", text: chunk };
    }
    if (signal.aborted) throw new AiProviderError("timeout");
    yield {
      type: "usage",
      usage: {
        inputTokens: Math.ceil(inputChars(req) / 4),
        cachedInputTokens: 0,
        outputTokens: Math.ceil(outputChars / 4),
        thinkingTokens: 0,
        searchCount: 0,
      },
    };
    yield { type: "done", finishReason: "stop" };
  }

  listModels(): Promise<DiscoveredModel[]> {
    return Promise.resolve(
      FAKE_MODELS.map((id) => ({
        id,
        displayName: id,
        contextTokens: null,
        capabilities: ["json" as const],
        pricing: {
          inputUsdMicrosPerM: 0,
          cachedInputUsdMicrosPerM: 0,
          outputUsdMicrosPerM: 0,
          searchUsdMicros: 0,
        },
      })),
    );
  }

  testConnection(): Promise<ConnectionResult> {
    return Promise.resolve({ ok: true, latencyMs: 0 });
  }
}
