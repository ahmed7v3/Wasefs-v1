import { createHash } from "node:crypto";

import { canonicalJson } from "@wasfa/shared/wa-agent/canonical-json";

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

/** The proof that a write tool ran, handed to the services behind it (docs/WA-AGENT-RUNTIME.md section 17.2). */
export interface ToolEffectInfo {
  /** Hex sha256 of turn, tool and arguments; the downstream ids of the effect derive from it. */
  key: string;
  turnId: string;
  /** The turn fence the effect must still match (section 17.4); absent when the turn has none. */
  fence?: number;
}

/** The turn lost its conversation to a newer turn; nothing was done and the turn must stop (section 17.4). */
export class StaleFenceError extends Error {
  constructor() {
    super("stale turn fence");
    this.name = "StaleFenceError";
  }
}

/** What `withToolEffect` needs from the store of `wa_tool_effects`, as a narrow port so a test can fake it. */
export interface ToolEffectsPort {
  /** Inserts the pending row, or reports what an earlier run left. */
  begin: (
    key: string,
    turnId: string,
    tool: string,
  ) => Promise<
    { state: "fresh" } | { state: "pending" } | { state: "done"; result: Record<string, unknown> }
  >;
  markDone: (key: string, result: Record<string, unknown>) => Promise<void>;
  /** Throws `StaleFenceError` unless the conversation is still at `fence`. */
  assertFence: (conversationId: string, fence: number) => Promise<void>;
}

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
  /** Set for a write tool of a v2 turn: the effect the call belongs to. */
  effect?: ToolEffectInfo;
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
  /** The `wa_tool_effects` store; needed only when a turn sets `turnId`. */
  effects?: ToolEffectsPort;
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
  /** The `wa_turns.id` of this turn. Set by the v2 turn runner; while absent the tools behave as in v1. */
  turnId?: string;
  /** The conversation fence this turn holds (section 17.4); effects refuse to run once it moved on. */
  fence?: number;
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
  /** `write` tools run once per turn and arguments (`withToolEffect`); `read` tools run every time. */
  effect: AgentToolEffect;
  /** Re-applies the in-memory part of a write tool when its stored result is returned instead of a run. */
  replay?: (ctx: AgentToolContext, args: unknown) => Promise<void> | void;
  /** False for a result that must be tried again (a refusal that did nothing); default: not an `error` result. */
  settled?: (result: unknown) => boolean;
  /** Keys left out of the stored result: secrets and customer text never rest in `wa_tool_effects`. */
  unstored?: readonly string[];
  handler: (
    ctx: AgentToolContext,
    args: unknown,
    effect?: ToolEffectInfo,
  ) => Promise<unknown> | unknown;
}

export type AgentToolEffect = "write" | "read";

/** Declares a tool with typed arguments; the registry stores it with `args` erased. */
export function defineTool<S extends z.ZodType>(tool: {
  definition: ToolDefinition;
  schema: S;
  linkedOnly: boolean;
  guestOnly?: boolean;
  feature?: AgentToolFeature;
  effect: AgentToolEffect;
  replay?: (ctx: AgentToolContext, args: z.output<S>) => Promise<void> | void;
  settled?: (result: unknown) => boolean;
  unstored?: readonly string[];
  handler: (
    ctx: AgentToolContext,
    args: z.output<S>,
    effect?: ToolEffectInfo,
  ) => Promise<unknown> | unknown;
}): AgentTool {
  return {
    definition: tool.definition,
    schema: tool.schema,
    linkedOnly: tool.linkedOnly,
    ...(tool.guestOnly === true ? { guestOnly: true } : {}),
    ...(tool.feature === undefined ? {} : { feature: tool.feature }),
    effect: tool.effect,
    // The registry parses with `schema` before it calls, so the casts only restore the known type.
    ...(tool.replay === undefined
      ? {}
      : { replay: (ctx, args) => tool.replay?.(ctx, args as z.output<S>) }),
    ...(tool.settled === undefined ? {} : { settled: tool.settled }),
    ...(tool.unstored === undefined ? {} : { unstored: tool.unstored }),
    handler: (ctx, args, effect) => tool.handler(ctx, args as z.output<S>, effect),
  };
}

/** The call a tool makes for the chat's account; a guest never gets this far. */
export function callOf(ctx: AgentToolContext, effect?: ToolEffectInfo): AgentCall | null {
  if (ctx.userId === null) return null;
  return {
    ...(effect === undefined ? {} : { effect }),
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    market: ctx.market,
    config: ctx.config,
    now: ctx.now,
  };
}

/** A domain refusal the model can read: `{ error: "<code>" }`. */
export const toolError = (code: string) => ({ error: code });

/** Hex sha256 of `turnId | tool | canonicalJson(args)`: the same call of the same turn always has this key. */
export function toolEffectKey(turnId: string, tool: string, args: unknown): string {
  return createHash("sha256")
    .update(`${turnId}|${tool}|${canonicalJson(args)}`)
    .digest("hex");
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Runs a write tool once per turn and arguments (docs/WA-AGENT-RUNTIME.md section 17.2). The pending
 * row goes in first; a finished earlier run returns its stored result without acting (after `replay`
 * restored what only lives in memory); a pending one died mid-effect and runs again, which every
 * effect tolerates (its downstream ids derive from the key). `run` marks the row done itself when the
 * effect is in Postgres (same transaction); otherwise it is marked here once `run` returned.
 * Without a `turnId` this is just `run` (v1).
 */
export async function withToolEffect(
  ctx: AgentToolContext,
  tool: string,
  args: unknown,
  run: (effect: ToolEffectInfo | undefined) => Promise<unknown> | unknown,
  options: Pick<AgentTool, "replay" | "settled" | "unstored"> = {},
): Promise<unknown> {
  const { turnId } = ctx;
  if (turnId === undefined) return run(undefined);
  const effects = ctx.deps.effects;
  if (effects === undefined) throw new Error("tool effects store is not configured");
  const key = toolEffectKey(turnId, tool, args);
  const begun = await effects.begin(key, turnId, tool);
  if (begun.state === "done") {
    await options.replay?.(ctx, args);
    return begun.result;
  }
  if (ctx.fence !== undefined) await effects.assertFence(ctx.conversationId, ctx.fence);
  const result = await run({
    key,
    turnId,
    ...(ctx.fence === undefined ? {} : { fence: ctx.fence }),
  });
  const settled = options.settled ?? ((value: unknown) => !(isRecord(value) && "error" in value));
  if (isRecord(result) && settled(result)) {
    const stored = Object.fromEntries(
      Object.entries(result).filter(([name]) => !(options.unstored ?? []).includes(name)),
    );
    await effects.markDone(key, stored);
  }
  return result;
}
