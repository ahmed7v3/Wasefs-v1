import { t } from "@wasfa/shared/i18n";

import { toWhatsappText, splitReply } from "./agent-output.js";

import type { RoundOutcome, StepTrace } from "../turn/agent-round.js";
import type { StepRetry } from "../turn/retry-ladder.js";
import type { ToolCallRecord } from "./tools/index.js";
import type { NormalizedMessage } from "@wasfa/ai";
import type { WaConversation, TurnMessage } from "@wasfa/db";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";
import type { Redis } from "ioredis";

/** Messages the model sees verbatim (older ones are covered by the summary). */
export const HISTORY_LIMIT = 20;
export const MAX_TOOL_CALLS_PER_STEP = 3;
export const DAY_SECONDS = 86_400;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const utcDay =(at: Date) => at.toISOString().slice(0, 10).replaceAll("-", "");
export const spendKey = (at: Date) => `wa:agent:spend:${utcDay(at)}`;

/** The agent's own spend today, in USD micros; the model's cost is added after every call. */
export async function addSpend(redis: Redis, micros: number, now: Date): Promise<void> {
  if (micros <= 0) return;
  const key = spendKey(now);
  try {
    await redis.incrby(key, micros);
    await redis.expire(key, 2 * DAY_SECONDS);
  } catch {
    // The model's own spend guard still counts it; a Redis blip must not lose the reply.
  }
}

/** The waits of a turn; tests replace them to run without real time. */
export interface TurnTiming {
  /** How long the chat must stay quiet after the customer's last message before a turn starts. */
  quietMs: number;
  /** The most a turn waits for quiet in total. */
  maxQuietWaitMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** What one round needs, gathered by the caller (v1 `runTurn`, v2 `compose`). */
export interface ComposeInput {
  conversation: WaConversation;
  /** The customer messages this round answers. */
  pending: readonly TurnMessage[];
  /** The recent transcript, `pending` included. */
  rows: readonly TurnMessage[];
  config: WaAgentSettings;
  now: Date;
  /** Aborts the model calls early (v2: the conversation lock was lost). */
  signal?: AbortSignal;
  limits: { stepMs: number; turnMs: number };
  /** v1 stamps the messages it takes; v2 does not (it links them when the reply is queued). */
  onTaken?: (messageIds: string[], requestId: string) => Promise<void>;
  /** What happens when a model step fails: v1 one retry, v2 the retry ladder. */
  stepRetry: StepRetry;
  /** v2: the turn and its fence, handed to the tools (idempotency keys). */
  turnId?: string;
  fence?: number;
  /** v2: answer again from this conversation without tools (the empty-answer re-ask). */
  reaskFrom?: NormalizedMessage[] | undefined;
}

/**
 * The customer messages this turn answers: not taken by an earlier turn, newer than the owner's last
 * message (the owner dealt with what came before it) and inside the 24 h reply window.
 */
export function pendingMessages(rows: readonly TurnMessage[], now: number): TurnMessage[] {
  const floor = answerFloor(rows, now);
  return rows.filter(
    (row) => row.direction === "in" && !row.answered && row.createdAt.getTime() > floor,
  );
}

/** Messages at or before this time (ms) are not answered: the owner dealt with them, or they are too old. */
export function answerFloor(rows: readonly TurnMessage[], now: number): number {
  const owner = rows.findLast((row) => row.direction === "owner");
  return Math.max(owner?.createdAt.getTime() ?? 0, now - REPLY_WINDOW_MS);
}

/** A round that found nothing to say (the agent is off, paused, or nothing is eligible). */
export function quietOutcome(conversation: WaConversation, now: Date): RoundOutcome {
  return {
    parts: [],
    skipped: true,
    toolRecords: [],
    effectsRan: false,
    costUsdMicros: 0,
    trace: [{ code: "quiet" }],
    tail: {
      conversation,
      planId: null,
      now,
      steps: 0,
      truncated: false,
      text: "",
      spoken: null,
      handoffReason: null,
    },
  };
}

/** Fills each step's tool list with how the calls ended; records come in the order the calls ran. */
export function withOutcomes(
  steps: readonly StepTrace[],
  records: readonly ToolCallRecord[],
): StepTrace[] {
  let next = 0;
  return steps.map((step) => ({
    ...step,
    tools: step.tools.map((entry, index) => {
      // Calls over the per-step cap are answered without running, so they have no record.
      if (index >= MAX_TOOL_CALLS_PER_STEP) return { tool: entry.tool, outcome: "too_many_calls" };
      const record = records[next];
      next += 1;
      const outcome =
        record === undefined ? "not_run" : record.ok ? "ok" : (record.code ?? "error");
      return { tool: entry.tool, outcome };
    }),
  }));
}

/** Media first, then the text split to what is left of the turn's message budget. */
export function replyParts(
  text: string,
  media: readonly WaAgentOutboundPart[],
  caps: WaAgentSettings["caps"],
): WaAgentOutboundPart[] {
  const budget = Math.max(0, caps.maxMessagesPerTurn - media.length);
  const texts = splitReply(toWhatsappText(text), budget, caps.maxReplyChars);
  return [...media, ...texts.map((part): WaAgentOutboundPart => ({ kind: "text", text: part }))];
}

export function cannedText(
  key: "whatsapp.agent.accountUnavailable" | "whatsapp.agent.busy",
  config: WaAgentSettings,
) {
  return t(key, undefined, config.language === "en" ? "en" : "ar");
}
