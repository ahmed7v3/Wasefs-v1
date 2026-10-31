import {
  effectsRanOf,
  type RoundFailure,
  type RoundOutcome,
  type StepTrace,
  type ToolRecord,
} from "./agent-round.js";

import type { ToolOutput } from "../agent/tools/index.js";
import type { WaConversation } from "@wasfa/db";

/** What a round did before it ended without an answer; carried across the empty-answer re-ask. */
export interface Carry {
  toolRecords: ToolRecord[];
  toolResults: ToolOutput[];
  costUsdMicros: number;
  steps: StepTrace[];
  handoffReason: string | null;
}

export const emptyCarry = (): Carry => ({
  toolRecords: [],
  toolResults: [],
  costUsdMicros: 0,
  steps: [],
  handoffReason: null,
});

/** `carry` plus a finished round (the re-ask's result keeps its parts; the first pass's work is added). */
export function mergeOutcome(carry: Carry, outcome: RoundOutcome): RoundOutcome {
  const toolRecords = [...carry.toolRecords, ...outcome.toolRecords];
  return {
    ...outcome,
    toolRecords,
    toolResults: [...carry.toolResults, ...(outcome.toolResults ?? [])],
    steps: [...carry.steps, ...(outcome.steps ?? [])],
    effectsRan: effectsRanOf(toolRecords),
    costUsdMicros: carry.costUsdMicros + outcome.costUsdMicros,
    tail: {
      ...outcome.tail,
      handoffReason: outcome.tail.handoffReason ?? carry.handoffReason,
    },
  };
}

export function carryOf(carry: Carry, outcome: RoundOutcome): Carry {
  return {
    toolRecords: [...carry.toolRecords, ...outcome.toolRecords],
    toolResults: [...carry.toolResults, ...(outcome.toolResults ?? [])],
    costUsdMicros: carry.costUsdMicros + outcome.costUsdMicros,
    steps: [...carry.steps, ...(outcome.steps ?? [])],
    handoffReason: outcome.tail.handoffReason ?? carry.handoffReason,
  };
}

export function carryOfFailure(carry: Carry, failure: RoundFailure): Carry {
  return {
    toolRecords: [...carry.toolRecords, ...failure.toolRecords],
    toolResults: [...carry.toolResults, ...failure.toolResults],
    costUsdMicros: carry.costUsdMicros + failure.costUsdMicros,
    steps: [...carry.steps, ...failure.steps],
    handoffReason: failure.handoffReason ?? carry.handoffReason,
  };
}

/** The round a fallback reply stands in for, so `afterReply` can do its follow-ups (handoff pause, summary). */
export function fallbackOutcome(
  conversation: WaConversation,
  carry: Carry,
  text: string,
): RoundOutcome {
  return {
    parts: [{ kind: "text", text }],
    toolRecords: carry.toolRecords,
    toolResults: carry.toolResults,
    effectsRan: effectsRanOf(carry.toolRecords),
    costUsdMicros: carry.costUsdMicros,
    steps: carry.steps,
    trace: [],
    tail: {
      conversation,
      planId: null,
      now: new Date(),
      steps: carry.steps.length,
      truncated: false,
      text: "",
      spoken: null,
      handoffReason: carry.handoffReason,
    },
  };
}
