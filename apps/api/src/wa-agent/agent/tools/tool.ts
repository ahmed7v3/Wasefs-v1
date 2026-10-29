import type { Market } from "../../../catalog/market.js";
import type { DocumentCall } from "../../documents/agent-document.service.js";
import type { ToolDefinition } from "@wasfa/ai";
import type { CatalogResponse } from "@wasfa/shared/schemas/billing";
import type { MediaAsset } from "@wasfa/shared/schemas/media";
import type { MedicationSummary } from "@wasfa/shared/schemas/medications";
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
  /** What the paid tools cost, so the agent can say it before the customer agrees. */
  usage: {
    rxCreditsPerPage: number;
    rxMaxPages: number;
    /** Chat answers are charged by actual use; there is no fixed price to quote. */
    chatCharging: "by_use";
  };
  pendingOrders: {
    number: string;
    item: string;
    amountMinor: number;
    currency: string;
    amountFormatted: string;
    status: string;
  }[];
}

/** What a commerce or usage tool returns: plain data the model reads (never prose it should quote). */
export type AgentToolResult = Record<string, unknown>;

/**
 * Who a service call is for, taken from the turn and never from the model: the chat, the linked
 * account, the market of the chat's phone number and the admin settings of this turn.
 */
export interface AgentCall {
  conversationId: string;
  userId: string;
  market: Market;
  config: WaAgentSettings;
  now: Date;
}

/** The services the tools reach, as narrow ports so a test can fake them. */
export interface AgentToolDeps {
  catalog: { catalog: (market: Market) => Promise<CatalogResponse> };
  account: { status: (userId: string, now: Date) => Promise<AccountStatusFacts> };
  media: { find: (id: string) => Promise<MediaAsset | null> };
  /** Account creation and sign-in links (docs/WA-SIGNUP.md section 3). */
  accounts: {
    create: (input: {
      conversationId: string;
      phone: string;
      name?: string | undefined;
    }) => Promise<AgentToolResult>;
    loginLink: (userId: string) => Promise<AgentToolResult>;
  };
  /** `MEDIA_PUBLIC_ORIGIN`; empty when the media library is not configured. */
  mediaOrigin: string;
  handoff: { raise: (conversationId: string, reason: string) => Promise<void> };
  /** Discounts, orders and receipts (docs/WA-AGENT.md work package C). */
  commerce: {
    offerDiscount: (call: AgentCall, planKey: string, months: number) => Promise<AgentToolResult>;
    startSubscription: (
      call: AgentCall,
      input: { planKey: string; months: number; couponCode?: string | undefined },
    ) => Promise<AgentToolResult>;
    attachReceipt: (call: AgentCall) => Promise<AgentToolResult>;
  };
  /** Files the agent makes (create_document): free, capped, rendered by the worker. */
  documents: { create: (call: DocumentCall) => Promise<AgentToolResult> };
  /** The two tools that charge the linked account (prescription reading, medical answers). */
  usage: {
    analyzePrescription: (call: AgentCall) => Promise<AgentToolResult>;
    askMedical: (call: AgentCall, question: string) => Promise<AgentToolResult>;
  };
  /** The medication database (docs/MEDICATIONS.md section 5): free for guests and linked chats. */
  medications: {
    search: (query: string, limit: number) => Promise<MedicationSummary[]>;
    /** Same active-ingredient set, cheapest first. */
    alternatives: (drugId: string, limit: number) => Promise<MedicationSummary[]>;
    /** `medications.search.showPrices`: when false the tools leave prices out. */
    showPrices: () => Promise<boolean>;
  };
}

/** Admin switches that gate a whole tool (checked when the turn's tools are chosen). */
export type AgentToolFeature = "medications" | "accountSignup";

/** One turn's state, bound to one conversation. Tools read the account from here, never from the model. */
export interface AgentToolContext {
  conversationId: string;
  /** The account this chat is linked to; null for a guest. */
  userId: string | null;
  /** The chat's phone (E.164, resolved by the bridge); null or absent when WhatsApp did not reveal it. */
  phone?: string | null;
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
  /** Not offered to (and refused for) a linked chat. */
  guestOnly?: boolean;
  /** Offered only while this admin switch is on. */
  feature?: AgentToolFeature;
  handler: (ctx: AgentToolContext, args: unknown) => Promise<unknown> | unknown;
}

/** Declares a tool with typed arguments; the registry stores it with `args` erased. */
export function defineTool<S extends z.ZodType>(tool: {
  definition: ToolDefinition;
  schema: S;
  linkedOnly: boolean;
  guestOnly?: boolean;
  feature?: AgentToolFeature;
  handler: (ctx: AgentToolContext, args: z.output<S>) => Promise<unknown> | unknown;
}): AgentTool {
  return {
    definition: tool.definition,
    schema: tool.schema,
    linkedOnly: tool.linkedOnly,
    ...(tool.guestOnly === true ? { guestOnly: true } : {}),
    ...(tool.feature === undefined ? {} : { feature: tool.feature }),
    // The registry parses with `schema` before it calls, so the cast only restores the known type.
    handler: (ctx, args) => tool.handler(ctx, args as z.output<S>),
  };
}

/** The call a tool makes for the chat's account; a guest never gets this far. */
export function callOf(ctx: AgentToolContext): AgentCall | null {
  if (ctx.userId === null) return null;
  return {
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    market: ctx.market,
    config: ctx.config,
    now: ctx.now,
  };
}

/** A domain refusal the model can read: `{ error: "<code>" }`. */
export const toolError = (code: string) => ({ error: code });
