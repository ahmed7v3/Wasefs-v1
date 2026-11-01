import { AiProviderError } from "@wasfa/ai";
import { ErrorCode, isAppError } from "@wasfa/shared/errors";

import { RxStepError } from "./model-call.js";

import type { RxResult } from "@wasfa/shared/schemas/rx";
import type { WaRxFailureReason } from "@wasfa/shared/schemas/wa-agent";

/*
 * Why a reading ended without a result, in the customer's terms (docs/WA-AGENT-RUNTIME.md §9.2). Pure.
 * `insufficient_credits` and `too_many_pages` are decided by the api before a job exists, so no job
 * failure maps to them.
 */

/** Nothing readable: no medicine lines and no regions that looked like writing means it was not a prescription. */
export function refundedReason(result: RxResult): "unreadable_image" | "not_a_prescription" {
  return result.items.length === 0 && result.unreadableRegions.length === 0
    ? "not_a_prescription"
    : "unreadable_image";
}

/**
 * Why the job failed, for the customer's text: a model that did not answer in time or at all is the
 * service being unavailable (the person can simply send it again); everything else is ours (internal).
 * Nothing retries the job, so none of these promises a retry.
 */
export function failureReason(error: unknown): WaRxFailureReason {
  if (error instanceof RxStepError) {
    return error.code === "no_answer" || error.code === "budget_exceeded"
      ? "model_unavailable"
      : "internal";
  }
  return error instanceof AiProviderError ||
    (isAppError(error) && error.code === ErrorCode.UPSTREAM_UNAVAILABLE)
    ? "model_unavailable"
    : "internal";
}
