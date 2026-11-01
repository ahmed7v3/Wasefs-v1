import { t } from "@wasfa/shared/i18n";

import { HISTORY_LIMIT } from "./round-helpers.js";

import type { HistoryRow } from "./agent-prompt.js";
import type { WaAgentRepo } from "../conversation/conversation.repo.js";
import type { SessionService } from "../conversation/session.service.js";
import type { ComposeOptions, RoundOutcome } from "../turn/agent-round.js";
import type { WaConversation } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

/** What a v2 round sees of the chat: its current session only (docs/WA-AGENT-RUNTIME.md §18.2). */
export interface SessionView {
  sessionId: string;
  rows: HistoryRow[];
  /** What replaces the chat in the round's input: the session (its files are the ones tools may use), its summary and, for a customer who came back after a break, one line. */
  input: { sessionId: string; conversation: WaConversation; returningNote?: string };
}

/** The session's verbatim tail, summary and returning note; null while the chat has no session yet. */
export async function sessionView(
  sessions: SessionService,
  conversation: WaConversation,
  config: WaAgentSettings,
): Promise<SessionView | null> {
  const session = await sessions.context(conversation.id);
  if (session === null) return null;
  const rows = await sessions.history(conversation.id, session, HISTORY_LIMIT);
  const note =
    session.isReturning && session.outboundCount < 2
      ? t("whatsapp.agent.session.returning", undefined, config.language === "en" ? "en" : "ar")
      : undefined;
  return {
    sessionId: session.id,
    rows,
    input: {
      sessionId: session.id,
      conversation: { ...conversation, summary: session.summary },
      ...(note === undefined ? {} : { returningNote: note }),
    },
  };
}

/** v2 reads the chat's current session only; without one (and in v1) the last rows of the whole chat. */
export async function roundRows(
  repo: WaAgentRepo,
  sessions: SessionService | undefined,
  conversation: WaConversation,
  config: WaAgentSettings,
  options: ComposeOptions,
): Promise<{ view: SessionView | null; rows: HistoryRow[] }> {
  const view =
    options.turnId !== undefined && sessions
      ? await sessionView(sessions, conversation, config)
      : null;
  return {
    view,
    rows: view?.rows ?? (await repo.recentMessages(conversation.id, HISTORY_LIMIT)),
  };
}

/** Marks the outcome with its session, so `afterReply` summarises the session and not the chat. */
export function inSession(outcome: RoundOutcome, view: SessionView | null): RoundOutcome {
  return view === null
    ? outcome
    : { ...outcome, tail: { ...outcome.tail, sessionId: view.sessionId } };
}
