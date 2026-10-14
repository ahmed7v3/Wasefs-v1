import { costUsdMicros, creditsFor, type ModelPricing, type RouterResult } from "@wasfa/ai";

import { IMAGE_INPUT_TOKENS } from "./chat-context.js";

/*
 * Credit math of one chat turn (phase2.md, Decision 4): reserve the worst case before the call,
 * settle what was really used after it. Integers only; `creditsFor` and `costUsdMicros` do the
 * rounding (always up, at least one credit).
 */

/** About three characters per token: deliberately pessimistic for Arabic, so the hold is never too small. */
export function estimateInputTokens(inputChars: number, imageCount: number): number {
  return Math.ceil(inputChars / 3) + IMAGE_INPUT_TOKENS * imageCount;
}

export interface ReserveInput {
  inputChars: number;
  imageCount: number;
  maxOutputTokens: number;
  search: boolean;
  pricing: ModelPricing;
  multiplierBp: number;
  creditValueUsdMicros: number;
}

/** Credits to hold: the cost of the largest answer the first model can give, at least 1. */
export function reserveCredits(input: ReserveInput): number {
  const cost = costUsdMicros(
    {
      inputTokens: estimateInputTokens(input.inputChars, input.imageCount),
      cachedInputTokens: 0,
      outputTokens: input.maxOutputTokens,
      thinkingTokens: 0,
      searchCount: input.search ? 1 : 0,
    },
    input.pricing,
  );
  return creditsFor(cost, input.multiplierBp, input.creditValueUsdMicros);
}

export interface SettleInput {
  /** Whether the user got any text or thinking. Nothing produced = nothing to charge. */
  producedOutput: boolean;
  /** The router's final event; absent when the call failed after output began. */
  result: RouterResult | undefined;
  inputChars: number;
  imageCount: number;
  outputChars: number;
  /** The first model's price and multiplier: used only when the provider reported no usage. */
  pricing: ModelPricing;
  multiplierBp: number;
  creditValueUsdMicros: number;
}

/**
 * Credits actually owed: 0 when nothing was produced (the hold is released), otherwise the
 * provider cost of the answering attempt (at least 1). A provider that reports no usage (a stopped
 * or failed stream) is priced from the text we saw, so a partial answer is never free.
 */
export function settleCredits(input: SettleInput): number {
  if (!input.producedOutput) return 0;
  const { result } = input;
  if (result?.usage) {
    return creditsFor(result.costUsdMicros, result.creditMultiplierBp, input.creditValueUsdMicros);
  }
  const estimated = costUsdMicros(
    {
      inputTokens: estimateInputTokens(input.inputChars, input.imageCount),
      cachedInputTokens: 0,
      outputTokens: Math.ceil(input.outputChars / 3),
      thinkingTokens: 0,
      searchCount: 0,
    },
    input.pricing,
  );
  return creditsFor(
    estimated,
    result?.creditMultiplierBp ?? input.multiplierBp,
    input.creditValueUsdMicros,
  );
}
