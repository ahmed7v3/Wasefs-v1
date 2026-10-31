import { buildSystemPrompt, firstNameOf } from "./agent-prompt.js";

import type { WaAgentToolDeps } from "./tool-deps.js";
import type { AgentToolContext } from "./tools/index.js";
import type { Market } from "../../catalog/market.js";
import type { TurnUser, WaConversation } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/** Which optional tool groups this round offers (and the prompt describes). */
export interface ToolSwitches {
  medications: boolean;
  accountSignup: boolean;
}

/** The round's system prompt: persona and language from the settings, the chat's summary, the market. */
export function roundSystemPrompt(input: {
  switches: ToolSwitches;
  webOrigin: string;
  config: WaAgentSettings;
  now: Date;
  user: TurnUser | null;
  market: Market;
  conversation: WaConversation;
}): string {
  const { switches, config, user, market } = input;
  return buildSystemPrompt({
    medications: switches.medications,
    accountSignup: switches.accountSignup ? { webOrigin: input.webOrigin } : null,
    persona: config.persona,
    language: config.language,
    emojiLevel: config.emojiLevel,
    now: input.now,
    firstName: user === null ? null : firstNameOf(user.name),
    currency: market.currency,
    summary: input.conversation.summary,
  });
}

/** What the tools see of this round: the chat, the account, the market and (v2) the turn and its fence. */
export function roundToolContext(input: {
  conversation: WaConversation;
  user: TurnUser | null;
  market: Market;
  config: WaAgentSettings;
  now: Date;
  deps: WaAgentToolDeps;
  turnId?: string;
  fence?: number;
}): AgentToolContext {
  const { conversation, user } = input;
  return {
    conversationId: conversation.id,
    userId: user === null ? null : conversation.userId,
    phone: conversation.phone,
    market: input.market,
    config: input.config,
    now: input.now,
    deps: input.deps,
    mediaParts: [],
    handoffReason: null,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.fence === undefined ? {} : { fence: input.fence }),
  };
}

/** The whole turn's abort signal: the caller's (v2: lock lost) and the turn's own time limit. */
export function roundTurnSignal(signal: AbortSignal | undefined, turnMs: number): AbortSignal {
  return AbortSignal.any(
    signal === undefined
      ? [AbortSignal.timeout(turnMs)]
      : [signal, AbortSignal.timeout(turnMs)],
  );
}
