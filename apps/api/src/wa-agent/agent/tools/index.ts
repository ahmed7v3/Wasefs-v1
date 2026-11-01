import { normalizeHandle, formatHandle } from "../../conversation/attachment-handle.js";

import { accountStatusTool } from "./account-status.js";
import { analyzePrescriptionTool } from "./analyze-prescription.js";
import { askMedicalTool } from "./ask-medical.js";
import { attachReceiptTool } from "./attach-receipt.js";
import { createAccountTool } from "./create-account.js";
import { createDocumentTool } from "./create-document.js";
import { withExplain, refusalCodeOf } from "./explain.js";
import { getCatalogTool } from "./get-catalog.js";
import { handoffToOwnerTool } from "./handoff-to-owner.js";
import { loginLinkTool } from "./login-link.js";
import { medicationAlternativesTool, searchMedicationsTool } from "./medications.js";
import { offerDiscountTool } from "./offer-discount.js";
import { sendMediaTool } from "./send-media.js";
import { startSubscriptionTool } from "./start-subscription.js";
import {
  StaleFenceError,
  toolError,
  withToolEffect,
  type AgentTool,
  type AgentToolContext,
  type AgentToolFeature,
} from "./tool.js";
import { viewAttachmentTool } from "./view-attachment.js";

import type { ToolDefinition, ToolHandler } from "@wasfa/ai";

export type {
  AccountStatusFacts,
  AgentCall,
  AgentTool,
  AgentToolContext,
  AgentToolDeps,
  AgentToolEffect,
  AgentToolResult,
  ToolEffectInfo,
  ToolEffectsPort,
} from "./tool.js";
export { StaleFenceError } from "./tool.js";

/** Every tool the agent has. A new tool is a new file in this folder plus one line here. */
export const AGENT_TOOLS: readonly AgentTool[] = [
  getCatalogTool,
  accountStatusTool,
  offerDiscountTool,
  startSubscriptionTool,
  attachReceiptTool,
  analyzePrescriptionTool,
  askMedicalTool,
  searchMedicationsTool,
  medicationAlternativesTool,
  sendMediaTool,
  createDocumentTool,
  createAccountTool,
  loginLinkTool,
  handoffToOwnerTool,
  viewAttachmentTool,
];

/** Which feature-gated tools are on this turn (admin switches); every one is off unless named. */
export type AgentToolFeatures = Partial<Record<AgentToolFeature, boolean>>;

/**
 * The tools a sender may use: a guest never even sees the linked-only ones, and a tool behind a
 * switch is offered only while its switch is on.
 */
export function toolsFor(linked: boolean, features: AgentToolFeatures = {}): AgentTool[] {
  return AGENT_TOOLS.filter(
    (tool) =>
      (linked || !tool.linkedOnly) &&
      (!linked || tool.guestOnly !== true) &&
      (tool.feature === undefined || features[tool.feature] === true),
  );
}

/** What a turn records per tool call: the tool and how it ended, never its arguments or result. */
export interface ToolCallRecord {
  name: string;
  ok: boolean;
  code?: string;
  /** A declined result (`started: false, reason`) counts as `ok` to the policy; its tool note shows the reason. */
  refusal?: string;
  /** v2 tool memory (§8.3): the analysis a call started (first characters of its id) and the handles it used. */
  rxRef?: string;
  handles?: string[];
}

/**
 * What a successful call returned, kept in memory only: the failure policy builds a reply from it when
 * the model fails after a tool ran. Never stored and never logged (it can hold amounts and codes).
 */
export interface ToolOutput {
  name: string;
  result: unknown;
}

function errorCode(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("error" in result)) return null;
  return typeof result.error === "string" ? result.error : "error";
}

/** The analysis reference and the handles of a call, for the turn's tool note (from its result, else its arguments). */
function noteDetails(result: unknown, args: unknown): Pick<ToolCallRecord, "rxRef" | "handles"> {
  const read = (value: unknown, key: string): unknown =>
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  const rxRef = read(result, "rxRef");
  const fromResult = read(result, "handles");
  const raw = Array.isArray(fromResult) ? fromResult : read(args, "handles");
  const handles = (Array.isArray(raw) ? raw : []).flatMap((handle: unknown) => {
    const n =
      typeof handle === "string" || typeof handle === "number" ? normalizeHandle(handle) : null;
    return n === null ? [] : [formatHandle(n)];
  });
  return {
    ...(typeof rxRef === "string" ? { rxRef } : {}),
    ...(handles.length === 0 ? {} : { handles }),
  };
}

/**
 * The model-facing side of the tools for one turn: their definitions and handlers. Handlers validate
 * the arguments with the tool's zod schema, refuse a linked-only tool for a guest even if the model
 * invents the call, and turn every failure into a fixed code (no message or stack reaches the model).
 */
export function bindTools(
  tools: readonly AgentTool[],
  ctx: AgentToolContext,
  records: ToolCallRecord[],
  outputs?: ToolOutput[],
): { definitions: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const handlers: Record<string, ToolHandler> = {};
  const locale = ctx.config.language === "en" ? "en" : "ar";
  for (const tool of tools) {
    handlers[tool.definition.name] = async (raw) => {
      const name = tool.definition.name;
      const fail = (code: string) => {
        records.push({ name, ok: false, code });
        return withExplain(toolError(code), locale);
      };
      if (tool.linkedOnly && ctx.userId === null) return fail("not_linked");
      if (tool.guestOnly === true && ctx.userId !== null) return fail("already_linked");
      const parsed = tool.schema.safeParse(raw);
      if (!parsed.success) return fail("invalid_arguments");
      try {
        // A write tool of a v2 turn (`ctx.turnId`) acts once per turn and arguments; v1 just calls it.
        const result =
          tool.effect === "write"
            ? await withToolEffect(
                ctx,
                name,
                parsed.data,
                (effect) => tool.handler(ctx, parsed.data, effect),
                tool,
              )
            : await tool.handler(ctx, parsed.data);
        const code = errorCode(result);
        const refusal = refusalCodeOf(result);
        const details = noteDetails(result, parsed.data);
        records.push(
          code === null
            ? { name, ok: true, ...(refusal === null ? {} : { refusal }), ...details }
            : { name, ok: false, code, ...details },
        );
        if (code === null) outputs?.push({ name, result });
        // A refusal carries a fixed sentence the model may paraphrase (docs/WA-AGENT-RUNTIME.md §18.5).
        return withExplain(result, locale);
      } catch (error) {
        // The turn lost the chat to a newer one: nothing was done, and the runner must see why.
        if (error instanceof StaleFenceError) return fail("stale_turn");
        return fail("tool_failed");
      }
    };
  }
  return { definitions: tools.map((tool) => tool.definition), handlers };
}
