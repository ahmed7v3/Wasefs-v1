import { classifyUnknown } from "./adapters/errors.js";
import { AiProviderError } from "./types.js";

import type { AIProviderAdapter, NormalizedEvent, NormalizedRequest, Usage } from "./types.js";

/** One route entry: a model on a provider, with the request already shaped for it. */
export interface RunnerCandidate {
  /** Opaque id (e.g. the route/model row id) used for breakers and attempt records. */
  key: string;
  adapter: AIProviderAdapter;
  request: NormalizedRequest;
}

export interface AttemptInfo {
  key: string;
  /** 1-based count of attempts actually started (skipped candidates do not count). */
  attempt: number;
  outcome: "ok" | "error" | "cancelled";
  error?: AiProviderError;
  usage?: Usage;
  latencyMs: number;
}

export interface RunnerHooks {
  /** Circuit breaker: an open candidate is skipped without an attempt. */
  isOpen?(key: string): Promise<boolean>;
  /** Called exactly once per started attempt, including failed and cancelled ones. */
  onAttempt(info: AttemptInfo): Promise<void> | void;
}

export interface RunnerOptions {
  attemptTimeoutMs?: number;
}

export type RunnerEvent = NormalizedEvent & { candidate?: string };

const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * Tries candidates in order. Only a retryable error that arrives BEFORE any text/thinking has
 * been yielded moves on to the next candidate; once the caller has seen output, or when the error
 * is not retryable, it is thrown. An abort ends the stream quietly after reporting "cancelled".
 */
export async function* runWithFallbacks(
  candidates: RunnerCandidate[],
  signal: AbortSignal,
  hooks: RunnerHooks,
  options: RunnerOptions = {},
): AsyncGenerator<RunnerEvent> {
  const timeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  let attempt = 0;
  let lastError: AiProviderError | undefined;

  for (const candidate of candidates) {
    if (signal.aborted) return;
    if (hooks.isOpen && (await hooks.isOpen(candidate.key))) continue;

    attempt += 1;
    const startedAt = performance.now();
    const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    let usage: Usage | undefined;
    let outputSeen = false;
    let reported = false;

    const report = async (
      outcome: AttemptInfo["outcome"],
      error?: AiProviderError,
    ): Promise<void> => {
      reported = true;
      await hooks.onAttempt({
        key: candidate.key,
        attempt,
        outcome,
        ...(error ? { error } : {}),
        ...(usage ? { usage } : {}),
        latencyMs: Math.round(performance.now() - startedAt),
      });
    };

    try {
      for await (const event of candidate.adapter.stream(candidate.request, attemptSignal)) {
        // Nothing may reach the caller after an abort, even if the adapter had it buffered.
        if (signal.aborted) break;
        if (event.type === "usage") usage = event.usage;
        if (event.type === "text" || event.type === "thinking" || event.type === "tool_calls") {
          outputSeen = true;
        }
        yield { ...event, candidate: candidate.key };
      }
      if (signal.aborted) {
        await report("cancelled");
        return;
      }
      await report("ok");
      return;
    } catch (caught) {
      if (signal.aborted) {
        await report("cancelled");
        return;
      }
      const error = classifyUnknown(caught);
      await report("error", error);
      if (!error.retryable || outputSeen) throw error;
      lastError = error;
    } finally {
      // The consumer stopped iterating early (generator return): still record the attempt.
      if (!reported) await report("cancelled");
    }
  }

  if (signal.aborted) return;
  throw lastError ?? new AiProviderError("unavailable");
}
