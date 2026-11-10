import { createHash } from "node:crypto";

import { AiProviderError } from "@wasfa/ai";
import { isAppError } from "@wasfa/shared/errors";

import type { TelegramKey } from "./telegram-i18n.js";

/** What the person is told, by failure class. The words never carry provider details. */
export type ChatFailureKind = "paused" | "unconfigured" | "slow" | "other";

export interface ChatFailure {
  kind: ChatFailureKind;
  /** One automatic new attempt is worth it (timeout, provider unavailable, empty answer). */
  transient: boolean;
  /** Safe-to-log facts: names and codes only, never text. */
  log: { error: string; appCode?: string; reason?: string; providerCode?: string; status?: number };
}

/** Thrown when the model answered with nothing. */
export class EmptyAnswerError extends Error {
  constructor() {
    super("empty_answer");
    this.name = "EmptyAnswerError";
  }
}

/**
 * Sorts a failed follow-up into what to say and whether to retry. Kill switch / spend cap is "paused";
 * no route, no model or a provider that is out of quota / unauthorised / gone is "unconfigured"
 * (an admin fix, so a generic line); a timeout or an empty answer is "slow" (the person may retry).
 */
export function classifyChatFailure(error: unknown): ChatFailure {
  const name = error instanceof Error ? error.name : "unknown";
  if (isAppError(error)) {
    const raw = error.details?.["reason"];
    const reason = typeof raw === "string" ? raw : undefined;
    const kind: ChatFailureKind =
      reason === "ai_paused"
        ? "paused"
        : reason === "no_route" || reason === "no_model"
          ? "unconfigured"
          : "other";
    return {
      kind,
      transient: false,
      log: { error: name, appCode: error.code, ...(reason ? { reason } : {}) },
    };
  }
  if (error instanceof AiProviderError) {
    const slow = error.code === "timeout";
    const unconfigured =
      error.code === "unavailable" ||
      error.code === "rate_limited" ||
      error.code === "auth" ||
      error.code === "not_found";
    return {
      kind: slow ? "slow" : unconfigured ? "unconfigured" : "other",
      transient: error.code === "timeout" || error.code === "unavailable",
      log: {
        error: name,
        providerCode: error.code,
        ...(error.status === undefined ? {} : { status: error.status }),
      },
    };
  }
  if (error instanceof EmptyAnswerError) {
    return { kind: "slow", transient: true, log: { error: name } };
  }
  // An abort signal that fired outside the router's own conversion.
  if (name === "TimeoutError" || name === "AbortError") {
    return { kind: "slow", transient: true, log: { error: name } };
  }
  return { kind: "other", transient: false, log: { error: name } };
}

export const FAILURE_MESSAGE: Record<ChatFailureKind, TelegramKey> = {
  paused: "followup.paused",
  unconfigured: "followup.unconfigured",
  slow: "followup.slow",
  other: "followup.error",
};

/** A short stable id of a chat for logs: enough to correlate, not the Telegram id itself. */
export function chatHash(chatId: number): string {
  return createHash("sha256").update(String(chatId)).digest("hex").slice(0, 12);
}
