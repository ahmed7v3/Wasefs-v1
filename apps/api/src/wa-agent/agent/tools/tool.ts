import type { Market } from "../../../catalog/market.js";
import type { ToolDefinition } from "@wasfa/ai";
import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { MediaAsset } from "@wasfa/shared/schemas/media";
import type { WaAgentOutboundPart } from "@wasfa/shared/schemas/wa-agent";
import type { WaAgentSettings } from "@wasfa/shared/settings";
import type { z } from "zod";

/** What `account_status` reports about the linked account. Facts only, already shaped for the model. */
export interface AccountStatusFacts {
  plan: { key: string; name: string };
  subscription: {
    status: string;
    endsAt: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  credits: { balance: number; monthlyCredits: number; nextGrantAt: string };
  pendingOrders: {
    number: string;
    item: string;
    amountMinor: number;
    currency: string;
    amountFormatted: string;
    status: string;
  }[];
}

/** The services the tools reach, as narrow ports so a test can fake them. */
export interface AgentToolDeps {
  catalog: { catalog: (market: Market) => Promise<CatalogResponse> };
  account: { status: (userId: string, now: Date) => Promise<AccountStatusFacts> };
  media: { find: (id: string) => Promise<MediaAsset | null> };
  /** `MEDIA_PUBLIC_ORIGIN`; empty when the media library is not configured. */
  mediaOrigin: string;
  handoff: { raise: (conversationId: string, reason: string) => Promise<void> };
}

/** One turn's state, bound to one conversation. Tools read the account from here, never from the model. */
export interface AgentToolContext {
  conversationId: string;
  /** The account this chat is linked to; null for a guest. */
  userId: string | null;
  market: Market;
  config: WaAgentSettings;
  now: Date;
  deps: AgentToolDeps;
  /** Media parts the tools queued; they are sent before the text of the reply. */
  mediaParts: WaAgentOutboundPart[];
  /** Set by `handoff_to_owner`: the turn pauses the chat once its last reply is delivered. */
  handoffReason: string | null;
}

/** A tool as the registry keeps it: arguments arrive already parsed with `schema`. */
export interface AgentTool {
  definition: ToolDefinition;
  schema: z.ZodType;
  /** Not offered to (and refused for) a guest. */
  linkedOnly: boolean;
  handler: (ctx: AgentToolContext, args: unknown) => Promise<unknown> | unknown;
}

/** Declares a tool with typed arguments; the registry stores it with `args` erased. */
export function defineTool<S extends z.ZodType>(tool: {
  definition: ToolDefinition;
  schema: S;
  linkedOnly: boolean;
  handler: (ctx: AgentToolContext, args: z.output<S>) => Promise<unknown> | unknown;
}): AgentTool {
  return {
    definition: tool.definition,
    schema: tool.schema,
    linkedOnly: tool.linkedOnly,
    // The registry parses with `schema` before it calls, so the cast only restores the known type.
    handler: (ctx, args) => tool.handler(ctx, args as z.output<S>),
  };
}

/** A domain refusal the model can read: `{ error: "<code>" }`. */
export const toolError = (code: string) => ({ error: code });
