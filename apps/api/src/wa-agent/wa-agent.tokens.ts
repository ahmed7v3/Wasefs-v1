/** The seam work package B plugs the agent into; the default does nothing (docs/WA-AGENT.md section 8). */
export const WA_AGENT_TURN_HANDLER = Symbol("WA_AGENT_TURN_HANDLER");

export interface WaAgentTurnHandler {
  /**
   * A customer message was stored in this conversation and the agent is on, the chat is not paused
   * or blocked. May take a while; a failure is logged and never blocks the stream.
   */
  onInbound: (conversationId: string) => Promise<void>;
}

/** Stores and mirrors messages only: no answer is produced until the agent core is plugged in. */
export class NoopTurnHandler implements WaAgentTurnHandler {
  onInbound(): Promise<void> {
    return Promise.resolve();
  }
}

/** The part of the agent that thinks (`AgentRound`); the v2 turn runner calls it, `WaAgentTurnService` is it. */
export const WA_AGENT_ROUND = Symbol("WA_AGENT_ROUND");
