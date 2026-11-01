import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";

import { composeParts } from "../compose/compose-parts.js";

import type { AuditEntry } from "../../audit/audit.service.js";
import type { Market } from "../../catalog/market.js";
import type {
  AccountStatusFacts,
  AgentCall,
  AgentToolResult,
  ToolEffectInfo,
  ToolEffectsPort,
} from "../agent/tools/tool.js";
import type { AttachmentsService } from "../conversation/attachments.service.js";
import type { RxStartBase } from "../rx/agent-rx.service.js";
import type { WaConversation } from "@wasfa/db";
import type { WaCommand } from "@wasfa/shared/i18n/wa-commands";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";
import type { WaAgentProfile, WaSessionState } from "@wasfa/shared/wa-agent/session";

/** How a row became a command: the matcher's three ways, or pictures that `awaitingRx` was waiting for. */
export type CommandVia = "alias" | "fuzzy" | "menu" | "awaiting";

/** One answered unit of a command turn: the command, how it was recognised and the inbound rows it consumes. */
export interface CommandStep {
  command: WaCommand;
  via: CommandVia;
  /** `on|off|en|ar` for voice/lang, `confirm` for the privacy confirmation word. */
  arg?: string;
  rowIds: string[];
  /** When the newest of its rows arrived: the privacy deletion keeps what came later. */
  at: Date;
}

/** What a handler needs of the turn it answers in. `conversation` is read fresh for every step. */
export interface CommandInput {
  conversation: WaConversation;
  turn: { id: string; fence: number };
  config: WaAgentSettings;
  now: Date;
  locale: Locale;
  step: CommandStep;
}

/** What a handler produced: the parts to send, plus a fact the router acts on after the send. */
export interface CommandResult {
  parts: WaAgentOutboundPart[];
  /** Set by `human`: the chat is paused once these parts were delivered. */
  handoffReason?: string;
}

export type CommandHandler = (input: CommandInput, deps: CommandDeps) => Promise<CommandResult>;

/** A report PDF this chat already received, as the deliverer sent it. */
export interface ReportDocument {
  mediaKey: string;
  fileName: string;
}

/** The services the handlers reach, as narrow ports so a unit test can fake them. */
export interface CommandDeps {
  sessions: {
    startNew: (conversationId: string, reason: "command" | "privacy", now: Date) => Promise<string>;
    state: (sessionId: string) => Promise<WaSessionState>;
    setState: (sessionId: string, patch: WaSessionState) => Promise<void>;
    clearState: (sessionId: string, key: keyof WaSessionState) => Promise<void>;
    setProfile: (conversationId: string, patch: WaAgentProfile) => Promise<void>;
  };
  attachments: Pick<AttachmentsService, "resolve">;
  rx: {
    startBase: (call: AgentCall) => Promise<RxStartBase | null>;
    start: (
      call: AgentCall,
      effect: ToolEffectInfo,
      base: RxStartBase,
      picked: { mediaIds: readonly string[]; handles: readonly number[] },
    ) => Promise<AgentToolResult>;
  };
  effects: ToolEffectsPort;
  account: { status: (userId: string, now: Date) => Promise<AccountStatusFacts> };
  handoff: { raise: (conversationId: string, reason: string) => Promise<void> };
  store: {
    lastReport: (
      conversationId: string,
      fileNames: readonly string[],
    ) => Promise<ReportDocument | null>;
    /** Deletes the chat's rows up to `upTo`; returns the stored files to remove. */
    erase: (conversationId: string, upTo: Date) => Promise<string[]>;
  };
  storage: { remove: (key: string) => Promise<void> };
  audit: { record: (entry: AuditEntry) => Promise<void> };
  market: (conversation: WaConversation) => Promise<Market>;
}

/** A short customer text from i18n, composed for WhatsApp under the admin's caps. */
export function say(
  input: Pick<CommandInput, "config" | "locale">,
  key: MessageKey,
  params?: Record<string, string>,
): WaAgentOutboundPart[] {
  return composeParts(t(key, params, input.locale), input.config.caps);
}
