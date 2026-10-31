import type { BusyCause } from "./v1-turn.service.js";
import type { ToolCallRecord, ToolOutput } from "../agent/tools/index.js";
import type { NormalizedMessage } from "@wasfa/ai";
import type { WaConversation, TurnMessage } from "@wasfa/db";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";

/*
 * The port between the turn engine (queue, lock, store, fencing) and the part that thinks: one round
 * reads the unanswered messages, runs the model and its tools and returns what to say. It writes nothing
 * to the customer's chat: queuing the parts, linking the rows and closing the turn belong to the caller
 * (v1: `WaAgentTurnService.runTurn`; v2: `TurnRunner`, under the conversation's fence).
 */

export type OutboundPart = WaAgentOutboundPart;
export type ToolRecord = ToolCallRecord;

/** One entry of a turn's trace: codes, timings and counts only, never message text or tool arguments. */
export interface TurnTraceStep {
  code: string;
  name?: string;
  ok?: boolean;
  ms?: number;
  count?: number;
}

/**
 * One model call of a turn, as stored in `wa_turns.trace.steps`: numbers and codes only, never text.
 * `tools` lists the tools that call asked for and how each ended.
 */
export interface StepTrace {
  step: number;
  model?: string;
  routeVersion?: number;
  latencyMs: number;
  tokens?: { input: number; output: number };
  costUsdMicros?: number;
  tools: { tool: string; outcome: string }[];
  /** The failure signal of this call when it failed. */
  error?: string;
}

/** What the caller needs after the reply is queued (summary, handoff pause, the spoken reply's words). */
export interface RoundTail {
  conversation: WaConversation;
  planId: string | null;
  now: Date;
  steps: number;
  truncated: boolean;
  /** The model's words (the voice row keeps them as its text). */
  text: string;
  spoken: { mediaKey: string; chars: number } | null;
  handoffReason: string | null;
}

export interface RoundOutcome {
  parts: OutboundPart[];
  toolRecords: ToolRecord[];
  /** A tool that changes something ran (not only reads), so the round must never simply be redone. */
  effectsRan: boolean;
  costUsdMicros: number;
  trace: TurnTraceStep[];
  tail: RoundTail;
  /** The round found nothing to do on purpose (agent off, chat held, nothing eligible): not an empty answer. */
  skipped?: boolean;
  /** Per model call, for `wa_turns.trace` (v2). */
  steps?: StepTrace[];
  /** What the successful tools returned; in memory only, used for the failure fallbacks. */
  toolResults?: ToolOutput[];
  /** The model's conversation so far (an empty answer is re-asked from it). In memory only. */
  transcript?: NormalizedMessage[];
}

/** What the v2 runner tells a round about the turn it belongs to. */
export interface ComposeOptions {
  turnId?: string;
  fence?: number;
  /** Ask the model once more from this conversation with `toolChoice: none` (the empty-answer re-ask). */
  reaskFrom?: NormalizedMessage[];
}

export interface AgentRound {
  /**
   * Answers `pending` (the conversation's unanswered customer messages). Resolves with no parts when
   * the agent must stay quiet (off, paused, nothing eligible). Rejects on a failure (`RoundRefused` for
   * the refusals v1 turns into a polite line); `signal` aborts the model calls.
   */
  compose: (
    conversation: WaConversation,
    pending: readonly TurnMessage[],
    signal: AbortSignal,
    options?: ComposeOptions,
  ) => Promise<RoundOutcome>;
  /** After the parts were queued as `messageIds`: row meta, the spoken words, handoff, summary. */
  afterReply: (
    conversationId: string,
    messageIds: readonly string[],
    outcome: RoundOutcome,
  ) => Promise<void>;
  /** The parts were not queued (stale fence, paused meanwhile): free what the round made (a voice file). */
  discard: (outcome: RoundOutcome) => Promise<void>;
}

/** Read-only tools: a round that ran only these can be redone without a side effect (§17.2). */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "account_status",
  "get_catalog",
  "search_medications",
  "medication_alternatives",
]);

export function effectsRanOf(records: readonly ToolRecord[]): boolean {
  return records.some((record) => !READ_ONLY_TOOLS.has(record.name));
}

/** Why a round could not answer; v1 turns it into its polite line, v2 lets the job fail and retry. */
export type RoundRefusal =
  | { kind: "account_unavailable" }
  | { kind: "busy"; cause: BusyCause; detail: Record<string, string | number | undefined> };

/** What a failed round had done before it failed: the v2 policy builds the reply from it. */
export interface RoundFailure {
  cause: unknown;
  toolRecords: ToolRecord[];
  toolResults: ToolOutput[];
  costUsdMicros: number;
  steps: StepTrace[];
  handoffReason: string | null;
}

export class RoundRefused extends Error {
  constructor(
    readonly refusal: RoundRefusal,
    /** Set when a model failure ended the round (v2 reads it; v1 ignores it). */
    readonly failure?: RoundFailure,
  ) {
    super(refusal.kind === "busy" ? `round refused: ${refusal.cause}` : "round refused: account");
    this.name = "RoundRefused";
  }
}
