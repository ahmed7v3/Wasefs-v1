import type { ToolCallRecord } from "../agent/tools/index.js";
import type { BusyCause } from "../agent/wa-agent-turn.service.js";
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

export class RoundRefused extends Error {
  constructor(readonly refusal: RoundRefusal) {
    super(refusal.kind === "busy" ? `round refused: ${refusal.cause}` : "round refused: account");
    this.name = "RoundRefused";
  }
}
