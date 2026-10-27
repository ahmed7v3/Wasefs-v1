import { accountStatusTool } from "./account-status.js";
import { analyzePrescriptionTool } from "./analyze-prescription.js";
import { askMedicalTool } from "./ask-medical.js";
import { attachReceiptTool } from "./attach-receipt.js";
import { createDocumentTool } from "./create-document.js";
import { getCatalogTool } from "./get-catalog.js";
import { handoffToOwnerTool } from "./handoff-to-owner.js";
import { offerDiscountTool } from "./offer-discount.js";
import { sendMediaTool } from "./send-media.js";
import { startSubscriptionTool } from "./start-subscription.js";
import { toolError, type AgentTool, type AgentToolContext } from "./tool.js";

import type { ToolDefinition, ToolHandler } from "@wasfa/ai";

export type {
  AccountStatusFacts,
  AgentCall,
  AgentTool,
  AgentToolContext,
  AgentToolDeps,
  AgentToolResult,
} from "./tool.js";

/** Every tool the agent has. A new tool is a new file in this folder plus one line here. */
export const AGENT_TOOLS: readonly AgentTool[] = [
  getCatalogTool,
  accountStatusTool,
  offerDiscountTool,
  startSubscriptionTool,
  attachReceiptTool,
  analyzePrescriptionTool,
  askMedicalTool,
  sendMediaTool,
  createDocumentTool,
  handoffToOwnerTool,
];

/** The tools a sender may use: a guest never even sees the linked-only ones. */
export function toolsFor(linked: boolean): AgentTool[] {
  return AGENT_TOOLS.filter((tool) => linked || !tool.linkedOnly);
}

/** What a turn records per tool call: the tool and how it ended, never its arguments or result. */
export interface ToolCallRecord {
  name: string;
  ok: boolean;
  code?: string;
}

function errorCode(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("error" in result)) return null;
  return typeof result.error === "string" ? result.error : "error";
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
): { definitions: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const handlers: Record<string, ToolHandler> = {};
  for (const tool of tools) {
    handlers[tool.definition.name] = async (raw) => {
      const name = tool.definition.name;
      const fail = (code: string) => {
        records.push({ name, ok: false, code });
        return toolError(code);
      };
      if (tool.linkedOnly && ctx.userId === null) return fail("not_linked");
      const parsed = tool.schema.safeParse(raw);
      if (!parsed.success) return fail("invalid_arguments");
      try {
        const result = await tool.handler(ctx, parsed.data);
        const code = errorCode(result);
        records.push(code === null ? { name, ok: true } : { name, ok: false, code });
        return result;
      } catch {
        return fail("tool_failed");
      }
    };
  }
  return { definitions: tools.map((tool) => tool.definition), handlers };
}
