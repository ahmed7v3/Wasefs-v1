import { AiProviderError, ToolLoopError } from "@wasfa/ai";
import { ErrorCode, isAppError } from "@wasfa/shared/errors";
import {
  actionFor,
  classify,
  type ActionContext,
  type FailureAction,
  type FailureClass,
  type FailureSignal,
} from "@wasfa/shared/wa-agent/failure";

import { RoundRefused } from "./agent-round.js";

/*
 * The api half of the failure policy (docs/WA-AGENT-RUNTIME.md section 5.4): what was caught becomes a
 * `FailureSignal`; the decisions (`classify`, `actionFor`) are the pure ones in `@wasfa/shared`.
 */

export interface SignalContext {
  /** The turn's own budget: a `TimeoutError` while it is aborted means the turn ran out, not one step. */
  turnSignal?: AbortSignal | undefined;
}

const NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function isNetwork(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = codeOf(error) ?? codeOf(error.cause);
  if (code !== undefined && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR_"))) return true;
  return error.message === "fetch failed";
}

/** The error behind a wrapper: a `ToolLoopError` is judged by its cause (effects come from the tool records). */
function unwrap(error: unknown): unknown {
  return error instanceof ToolLoopError ? error.cause : error;
}

/**
 * Maps whatever a round threw to the policy's signal. `StaleFenceError` is not mapped here: it is not a
 * failure, the runner stops the round silently (the new holder owns the chat).
 */
export function signalOf(error: unknown, ctx: SignalContext = {}): FailureSignal {
  const cause = unwrap(error);
  if (cause instanceof RoundRefused) {
    const { refusal } = cause;
    // A suspended or deleted account is an account state the platform set on purpose, so it is a policy
    // drop (v1 sent one polite line a day; v2 records it as `dropped_policy`).
    if (refusal.kind === "account_unavailable") return { kind: "policy", reason: "blocked" };
    if (refusal.cause === "spend_cap") return { kind: "spend_cap" };
    // The refusal does not say which of the three switches it was; the kill switch is the common one.
    if (refusal.cause === "ai_unavailable") return { kind: "ai_off", reason: "kill_switch" };
    return cause.failure === undefined ? { kind: "unknown" } : signalOf(cause.failure.cause, ctx);
  }
  // The router refuses with UPSTREAM_UNAVAILABLE (`ai_paused`, `no_route`, `no_model`) when AI is off.
  if (isAppError(cause) && cause.code === ErrorCode.UPSTREAM_UNAVAILABLE) {
    return {
      kind: "ai_off",
      reason: cause.details?.["reason"] === "ai_paused" ? "kill_switch" : "no_model",
    };
  }
  if (cause instanceof AiProviderError) return { kind: "provider", code: cause.code };
  if (cause instanceof Error && cause.name === "TimeoutError") {
    return ctx.turnSignal?.aborted === true ? { kind: "turn_timeout" } : { kind: "step_timeout" };
  }
  if (isNetwork(cause)) return { kind: "network" };
  return { kind: "unknown" };
}

/** Why the owner is alerted, per class (the admin alert text; no customer data). */
export const OWNER_REASONS: Record<FailureClass, string> = {
  spend_cap: "سقف إنفاق الوكيل اليومي وصل حده",
  ai_off: "الذكاء الاصطناعي متوقف أو غير متاح الآن",
  transient: "تعذّر على الوكيل الرد بعد عدة محاولات (فشل أو مهلة في النموذج)",
  permanent: "تعذّر على الوكيل الرد بسبب خطأ غير متوقع",
  after_tools: "تعذّر على الوكيل إكمال الرد بعد تنفيذ إجراء",
  empty_answer: "النموذج لم يرجع ردًا",
  policy: "",
};

/** Classifies a signal given the tool records of the turn so far. */
export function classOf(signal: FailureSignal, effectsRan: boolean): FailureClass {
  return classify(signal, { effectsRan });
}

/** The action for a class; thin wrapper so callers import one module. */
export function decide(cls: FailureClass, ctx: ActionContext): FailureAction {
  return actionFor(cls, ctx);
}
