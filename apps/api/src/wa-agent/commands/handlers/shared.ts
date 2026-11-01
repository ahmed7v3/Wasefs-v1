import { say, type CommandDeps, type CommandInput, type CommandResult } from "../command-types.js";

/** How long a menu, an `awaitingRx` wait and a privacy confirmation stay open (docs/WA-AGENT-RUNTIME.md §18.3). */
export const MENU_MS = 10 * 60_000;
export const AWAITING_RX_MS = 10 * 60_000;
export const PRIVACY_CONFIRM_MS = 5 * 60_000;

export const untilOf = (now: Date, ms: number): { until: string } => ({
  until: new Date(now.getTime() + ms).toISOString(),
});

/** The chat's current session; a chat that has none yet (written before v2) gets one so state has a place. */
export async function sessionOf(input: CommandInput, deps: CommandDeps): Promise<string> {
  return (
    input.conversation.sessionId ??
    (await deps.sessions.startNew(input.conversation.id, "command", input.now))
  );
}

/** The linked account of the chat, or the reply for a guest. */
export function linkedUser(input: CommandInput): { userId: string } | { guest: CommandResult } {
  const userId = input.conversation.userId;
  return userId === null
    ? { guest: { parts: say(input, "whatsapp.agent.commands.guest") } }
    : { userId };
}
