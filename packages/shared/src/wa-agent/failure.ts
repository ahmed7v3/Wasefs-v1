/*
 * The WhatsApp agent's failure policy (docs/WA-AGENT-RUNTIME.md §5.4, Decision 75). Pure: the api maps a
 * caught error to a `FailureSignal`, `classify` names the class, `actionFor` says what the turn does next.
 * The rules it enforces: a model error never produces the old "busy" line, the agent never pauses a chat
 * by itself, and no failure is silent: it becomes a retry, a deferral the customer was told about, a reply
 * built from what the tools already did, or a failure text with an error reference.
 */

/** How a turn ends (`wa_turns.state`). `queued` and `running` are the live states. */
export const WA_TURN_STATES = [
  "queued",
  "running",
  "replied",
  "deferred",
  "failed_replied",
  "dropped_policy",
] as const;
export type WaTurnState = (typeof WA_TURN_STATES)[number];

export const FAILURE_CLASSES = [
  "transient",
  "after_tools",
  "empty_answer",
  "spend_cap",
  "ai_off",
  "permanent",
  "policy",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/** Provider error codes as `@wasfa/ai` reports them (`AiErrorCode`). */
export type ProviderErrorCode =
  | "auth"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "bad_request"
  | "content_blocked"
  | "not_found"
  | "unknown";

/** What went wrong, reduced to what the policy needs. Built by the api from the caught error. */
export type FailureSignal =
  /** An `AiProviderError` (429, 5xx, overloaded, auth, refused request …). */
  | { kind: "provider"; code: ProviderErrorCode }
  /** One model call ran past `waAgent.runtime.stepTimeoutMs`. */
  | { kind: "step_timeout" }
  /** The whole turn ran past `waAgent.runtime.turnTimeoutMs`. */
  | { kind: "turn_timeout" }
  /** The connection to the provider failed before an answer (DNS, reset, socket closed). */
  | { kind: "network" }
  /** The model finished without any text for the customer. */
  | { kind: "empty_answer" }
  /** The agent's own daily spend cap (`waAgent.spendCapUsdMicros`). */
  | { kind: "spend_cap" }
  /** AI refused platform-wide: kill switch, the global daily cap, or no usable model route. */
  | { kind: "ai_off"; reason: "kill_switch" | "global_cap" | "no_model" }
  /** A deliberate admin/owner policy: paused, blocked, agent disabled, per-chat caps reached. */
  | { kind: "policy"; reason: "paused" | "blocked" | "disabled" | "caps" }
  /** Anything else: a bug, a schema mismatch, an unexpected exception. */
  | { kind: "unknown" };

export interface ClassifyContext {
  /**
   * A side-effecting tool (analysis started, order, coupon, document, handoff …) already ran in this
   * turn. Read-only tools (catalog, medication search, account status) do not count: repeating them is
   * harmless, so a failure after them is still retried like any transient error.
   */
  effectsRan: boolean;
}

const TRANSIENT_PROVIDER_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "unavailable",
]);

/**
 * The class of a failure. Order matters: a policy state wins over everything (nothing is sent), then a
 * failure after an effect (the customer must hear about what already happened), then the specific cases.
 */
export function classify(signal: FailureSignal, ctx: ClassifyContext): FailureClass {
  if (signal.kind === "policy") return "policy";
  if (signal.kind === "empty_answer") return "empty_answer";
  if (ctx.effectsRan) return "after_tools";
  switch (signal.kind) {
    case "spend_cap":
      return "spend_cap";
    case "ai_off":
      return "ai_off";
    case "step_timeout":
    case "turn_timeout":
    case "network":
      return "transient";
    case "provider":
      return TRANSIENT_PROVIDER_CODES.has(signal.code) ? "transient" : "permanent";
    case "unknown":
      return "permanent";
  }
}

/** Pauses before the in-turn retries of the same model step (the retry ladder, §5.4). */
export const STEP_RETRY_DELAYS_MS = [1_500, 4_000] as const;
/** Back-off of the turn job's retries after a deferral (§4.3); one entry per retry. */
export const JOB_RETRY_DELAYS_MS = [20_000, 60_000, 180_000] as const;

/** i18n keys of the deterministic customer texts the policy can ask for. */
export const FAILURE_TEXT_KEYS = {
  deferred: "whatsapp.agent.deferred",
  failed: "whatsapp.agent.failed",
  aiPaused: "whatsapp.agent.aiPaused",
  ack: "whatsapp.agent.fallback.ack",
} as const;
export type FailureTextKey = (typeof FAILURE_TEXT_KEYS)[keyof typeof FAILURE_TEXT_KEYS];

export interface ActionContext {
  /** Runs of this turn job so far, including the current one (1 on the first run). */
  attempt: number;
  /** Job retries allowed after the first run (`waAgent.runtime.jobAttempts`, default 3). */
  jobRetries: number;
  /** In-turn retries of the failing step already made (0, 1 or 2). */
  stepRetriesUsed: number;
  /** The empty-answer re-ask (`toolChoice: none`) was already tried in this turn. */
  reasked: boolean;
  /**
   * A customer failure text may be sent now (`waAgent.failures.customerTextEveryMinutes`, one per chat
   * per 10 minutes by default). For `spend_cap`/`ai_off` the caller applies its once-per-day rule here.
   */
  customerTextAllowed: boolean;
  /** Milliseconds until the customer-text limit allows the next text (0 when allowed). */
  customerTextInMs: number;
  /** This turn was already deferred once because only the customer-text limit was in the way. */
  rateDeferred: boolean;
}

export type FailureAction =
  /** Repeat the same model step after `delayMs` (route fallback allowed). The turn continues. */
  | { type: "retry_step"; delayMs: number }
  /** End the run as `deferred`; the job runs again after `delayMs`. `text` is sent first when set. */
  | { type: "defer"; delayMs: number; text: FailureTextKey | null }
  /** Ask the model once more with `toolChoice: none`. The turn continues. */
  | { type: "reask_without_tools" }
  /**
   * Reply from the turn's tool records (fallback-replies); when no record yields a text, send
   * `otherwise`. Ends `replied`.
   */
  | { type: "fallback_from_tools"; otherwise: FailureTextKey }
  /** Send `text` (with an error reference when `withRef`), end `failed_replied`. */
  | {
      type: "fail";
      text: FailureTextKey;
      withRef: boolean;
      errorEvent: boolean;
      ownerAlert: boolean;
    }
  /** Nothing is sent: a deliberate policy state, recorded and counted. Ends `dropped_policy`. */
  | { type: "drop" };

/** The `wa_turns.state` an action ends the run in; `null` when the turn goes on. */
export function terminalStateOf(action: FailureAction): WaTurnState | null {
  switch (action.type) {
    case "retry_step":
    case "reask_without_tools":
      return null;
    case "defer":
      return "deferred";
    case "fallback_from_tools":
      return "replied";
    case "fail":
      return "failed_replied";
    case "drop":
      return "dropped_policy";
  }
}

/**
 * When the customer-text limit is the only thing in the way of a text, wait for it once instead of
 * staying silent (§5.4: "within the limit a further failure is deferred again, never silent").
 */
function textOrWait(
  ctx: ActionContext,
  send: Extract<FailureAction, { type: "fail" }>,
): FailureAction {
  if (ctx.customerTextAllowed) return send;
  if (!ctx.rateDeferred) return { type: "defer", delayMs: Math.max(ctx.customerTextInMs, 1), text: null };
  // Waited once already and still limited: a text went out moments ago, so the customer has been told.
  // End without another one; the owner alert keeps the state alerted (I1).
  return { ...send, ownerAlert: true };
}

/** What the turn does next for a failure of class `cls`. Total over every class and context. */
export function actionFor(cls: FailureClass, ctx: ActionContext): FailureAction {
  switch (cls) {
    case "policy":
      return { type: "drop" };

    case "transient": {
      const stepDelay = STEP_RETRY_DELAYS_MS[ctx.stepRetriesUsed];
      if (stepDelay !== undefined) return { type: "retry_step", delayMs: stepDelay };
      const jobDelay = ctx.attempt <= ctx.jobRetries ? JOB_RETRY_DELAYS_MS[ctx.attempt - 1] : undefined;
      if (jobDelay !== undefined) {
        // The customer hears "I'll answer within minutes" once, on the first deferral only.
        const tell = ctx.attempt === 1 && ctx.customerTextAllowed;
        return { type: "defer", delayMs: jobDelay, text: tell ? FAILURE_TEXT_KEYS.deferred : null };
      }
      return textOrWait(ctx, {
        type: "fail",
        text: FAILURE_TEXT_KEYS.failed,
        withRef: true,
        errorEvent: true,
        ownerAlert: true,
      });
    }

    case "after_tools":
      return { type: "fallback_from_tools", otherwise: FAILURE_TEXT_KEYS.ack };

    case "empty_answer":
      return ctx.reasked
        ? { type: "fallback_from_tools", otherwise: FAILURE_TEXT_KEYS.ack }
        : { type: "reask_without_tools" };

    case "spend_cap":
    case "ai_off":
      // Commands keep working; the model part is off until the cap resets or the switch flips back.
      if (!ctx.customerTextAllowed) return { type: "drop" };
      return {
        type: "fail",
        text: FAILURE_TEXT_KEYS.aiPaused,
        withRef: false,
        errorEvent: false,
        ownerAlert: true,
      };

    case "permanent":
      return textOrWait(ctx, {
        type: "fail",
        text: FAILURE_TEXT_KEYS.failed,
        withRef: true,
        errorEvent: true,
        ownerAlert: true,
      });
  }
}
