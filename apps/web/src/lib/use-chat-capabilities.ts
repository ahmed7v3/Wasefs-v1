"use client";

import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";
import { useState } from "react";

import { useResource } from "./use-admin-data";

import type { AiMode } from "@wasfa/shared/ai";

/** Until the plan is known, only the everyday mode is offered (a locked mode would be refused anyway). */
const FALLBACK_MODES: readonly AiMode[] = ["balanced"];

/**
 * What the composer may offer this account: modes, web search, and the balance for the cost note.
 * The balance follows the `credits` event of each answer without another request.
 */
export function useChatCapabilities() {
  const resource = useResource("/me/credits", meCreditsResponseSchema);
  const [settledBalance, setSettledBalance] = useState<number | null>(null);
  const data = resource.status === "ready" ? resource.data : null;
  const modes = data && data.chat.modes.length > 0 ? data.chat.modes : FALLBACK_MODES;
  return {
    loaded: data !== null,
    modes,
    /** The mode a new composer starts in: balanced when the plan has it, else the first it has. */
    defaultMode: (modes.includes("balanced")
      ? "balanced"
      : (modes[0] ?? "balanced")) satisfies AiMode,
    webSearch: data?.chat.webSearch ?? false,
    balance: settledBalance ?? data?.wallet.balance ?? null,
    setBalance: setSettledBalance,
  };
}
