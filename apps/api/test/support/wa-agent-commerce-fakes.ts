import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { settingDefault } from "@wasfa/shared/settings";

import type { AgentCall, AgentToolDeps } from "../../src/wa-agent/agent/tools/index.js";
import type { PinoLogger } from "nestjs-pino";

/*
 * Fakes for the WhatsApp agent's commerce and usage tests (work package C): ports that fail loudly
 * when a test did not mean to reach them, and a call bound to one account.
 */

const unused = () => Promise.reject(new Error("unused in this test"));

/** `commerce` and `usage` ports for tests that never reach them. */
export const unusedCommerceDeps: Pick<AgentToolDeps, "commerce" | "usage"> = {
  commerce: { offerDiscount: unused, startSubscription: unused, attachReceipt: unused },
  usage: { analyzePrescription: unused, askMedical: unused },
};

export const COMMERCE_NOW = new Date("2026-10-26T10:00:00.000Z");
export const COMMERCE_USER_ID = "018f0000-0000-7000-8000-0000000000a1";
export const COMMERCE_CONVERSATION_ID = "018f0000-0000-7000-8000-0000000000c1";

/** A call for the linked account with the default `waAgent` settings, discounts switched on. */
export function commerceCall(overrides: Partial<AgentCall> = {}): AgentCall {
  const config = settingDefault("waAgent");
  return {
    conversationId: COMMERCE_CONVERSATION_ID,
    userId: COMMERCE_USER_ID,
    market: { currency: "EGP", country: "EG" },
    config: { ...config, discounts: { ...config.discounts, enabled: true, minUserMessages: 2 } },
    now: COMMERCE_NOW,
    ...overrides,
  };
}

export const appError = (code: keyof typeof ErrorCode, reason?: string) =>
  new AppError(ErrorCode[code], reason === undefined ? {} : { details: { reason } });

/** A logger that records nothing (the services only call `info`, `warn`, `error`, `setContext`). */
export const quietLogger = {
  setContext: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as PinoLogger;
