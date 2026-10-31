import { Injectable } from "@nestjs/common";

import { TurnRepo, type TurnEnd } from "./turn.repo.js";

import type { RoundOutcome } from "./agent-round.js";
import type { TurnMessage } from "@wasfa/db";

/** A turn a run is working on, `running` under the run's fence. */
export interface ActiveTurn {
  id: string;
  conversationId: string;
  fence: number;
  attempt: number;
  /** The inbound rows it answers; linked only when its reply is queued (§17.5). */
  inboundIds: string[];
}

/**
 * The state transitions of `wa_turns` (docs/WA-AGENT-RUNTIME.md §5.1): `begin` starts or resumes a turn,
 * a reply closes it `replied` inside `WaOutboundService.enqueueFenced`, and `endQuietly` records a round
 * that sent nothing. Every ending is fenced by `TurnRepo`.
 */
@Injectable()
export class TurnStore {
  constructor(private readonly repo: TurnRepo) {}

  bumpFence(conversationId: string): Promise<number> {
    return this.repo.bumpFence(conversationId);
  }

  unanswered(conversationId: string): Promise<TurnMessage[]> {
    return this.repo.unanswered(conversationId);
  }

  hasUnanswered(conversationId: string): Promise<boolean> {
    return this.repo.hasUnanswered(conversationId);
  }

  /** The conversation's live turn again (a retry, `attempt + 1`) or a new one, for these messages. */
  async begin(
    conversationId: string,
    fence: number,
    unanswered: readonly TurnMessage[],
  ): Promise<ActiveTurn> {
    const inboundIds = unanswered.map((message) => message.id);
    const row = await this.repo.begin(conversationId, fence, inboundIds);
    return { id: row.id, conversationId, fence, attempt: row.attempt, inboundIds };
  }

  /** What `enqueueFenced` / `endQuietly` write besides the state. */
  endOf(turn: ActiveTurn, outcome: RoundOutcome): Omit<TurnEnd, "conversationId"> {
    return {
      turnId: turn.id,
      fence: turn.fence,
      inboundIds: turn.inboundIds,
      costUsdMicros: outcome.costUsdMicros,
      trace: outcome.trace,
    };
  }

  /** Nothing is sent (`dropped_policy`): the inbound rows are linked so they are not answered again. */
  endQuietly(turn: ActiveTurn, outcome: RoundOutcome): Promise<void> {
    return this.repo.closeQuietly(
      { ...this.endOf(turn, outcome), conversationId: turn.conversationId },
      "dropped_policy",
    );
  }
}
