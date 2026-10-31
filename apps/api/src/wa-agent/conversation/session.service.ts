import { Injectable } from "@nestjs/common";
import {
  SET_BURST_MS,
  nextSetLabel,
  type WaAgentProfile,
  type WaSessionState,
} from "@wasfa/shared/wa-agent/session";

import { SessionRepo, type SessionContext } from "./session.repo.js";

import type { HistoryRow } from "../agent/agent-prompt.js";
import type { InsertedInbound, WaConversation } from "@wasfa/db";

type Tx = Parameters<Parameters<SessionRepo["transaction"]>[0]>[0];

const HOUR_MS = 3_600_000;

/** What assignment reads from the settings (`waAgent.sessions.idleHours`, `rx.maxPages`). */
export interface SessionConfig {
  idleHours: number;
  /** A set of media rows never grows past this (a prescription has at most this many pages). */
  maxPages: number;
}

/**
 * Agent sessions (docs/WA-AGENT-RUNTIME.md §18.2): which slice of the chat the model sees, the media
 * handles inside it and the short-lived state. Only called while `waAgent.runtime.v2` is on.
 */
@Injectable()
export class SessionService {
  constructor(private readonly repo: SessionRepo) {}

  /**
   * Called inside the ingest transaction for every newly stored row. A customer message first rolls the
   * session over when there is none or the chat was silent for `idleHours`; owner rows join the current
   * session without ever starting one. Returns the row's session id (null when the chat has none yet).
   */
  async assignInTx(
    tx: Tx,
    conversation: Pick<WaConversation, "id" | "sessionId" | "lastInboundAt">,
    row: InsertedInbound,
    now: Date,
    config: SessionConfig,
  ): Promise<string | null> {
    // The ingest upsert already holds this row; the lock makes the rule hold for any other caller too.
    const current = (await this.repo.lockConversation(tx, conversation.id)) ?? conversation;
    let sessionId = current.sessionId;
    if (row.direction !== "in") {
      if (sessionId !== null) await this.repo.stampRow(tx, row.id, sessionId);
      return sessionId;
    }
    const idle =
      current.lastInboundAt !== null &&
      current.lastInboundAt.getTime() < now.getTime() - config.idleHours * HOUR_MS;
    if (sessionId === null || idle) {
      if (sessionId !== null) await this.repo.end(tx, sessionId, "idle", now);
      sessionId = await this.repo.open(tx, conversation.id, idle, now);
    }
    if (row.kind !== "image" && row.kind !== "document") {
      await this.repo.stampRow(tx, row.id, sessionId);
      return sessionId;
    }
    const handle = await this.repo.takeHandle(tx, sessionId);
    const previous = await this.repo.lastMedia(tx, sessionId);
    const sameSet =
      previous !== null &&
      previous.setLabel !== null &&
      Math.abs(row.createdAt.getTime() - previous.createdAt.getTime()) <= SET_BURST_MS &&
      previous.setSize < config.maxPages;
    const label = sameSet ? (previous.setLabel ?? "A") : nextSetLabel(previous?.setLabel ?? null);
    await this.repo.stampMedia(tx, row.id, sessionId, handle, label);
    return sessionId;
  }

  /** The `new` and privacy commands: ends the current session and opens a fresh one, atomically. */
  startNew(conversationId: string, reason: "command" | "privacy", now: Date): Promise<string> {
    return this.repo.transaction(async (tx) => {
      const current = await this.repo.lockConversation(tx, conversationId);
      if (current === null) throw new Error("wa_conversations row not found");
      if (current.sessionId !== null) await this.repo.end(tx, current.sessionId, reason, now);
      return this.repo.open(tx, conversationId, false, now);
    });
  }

  /** Puts reply rows queued in `tx` into the current session. */
  stampOutbound(tx: Tx, conversationId: string, rowIds: readonly string[]): Promise<void> {
    return this.repo.stampOutbound(tx, conversationId, rowIds);
  }

  state(sessionId: string): Promise<WaSessionState> {
    return this.repo.state(sessionId);
  }

  setState(sessionId: string, patch: WaSessionState): Promise<void> {
    return this.repo.mergeState(sessionId, patch);
  }

  clearState(sessionId: string, key: keyof WaSessionState): Promise<void> {
    return this.repo.removeStateKey(sessionId, key);
  }

  profile(conversationId: string): Promise<WaAgentProfile> {
    return this.repo.profile(conversationId);
  }

  setProfile(conversationId: string, patch: WaAgentProfile): Promise<void> {
    return this.repo.mergeProfile(conversationId, patch);
  }

  history(
    conversationId: string,
    session: Pick<SessionContext, "id" | "startedAt">,
    limit: number,
  ): Promise<HistoryRow[]> {
    return this.repo.history(conversationId, session, limit);
  }

  context(conversationId: string): Promise<SessionContext | null> {
    return this.repo.context(conversationId);
  }
}
