import { RX_MAX_PAGES } from "@wasfa/shared/rx";
import { z } from "zod";

import { callOf, defineTool, toolError } from "./tool.js";

/**
 * Starts the paid prescription reading. v2 (docs/WA-AGENT-RUNTIME.md §18.5): the model names a set
 * (`A`) or handles (`#3`, `#4`) of the attachments list, or nothing for the newest set not yet read; the
 * server validates them against the current session. v1 ignores both and reads the latest pictures. The
 * result arrives later as a separate message; this tool only starts it and reports why it could not.
 */
export const analyzePrescriptionTool = defineTool({
  definition: {
    name: "analyze_prescription",
    description:
      'Read the customer\'s prescription pictures (charges credits from their account). Use it only after the customer clearly agreed to the cost in credits, or asked for the reading explicitly. Without arguments it reads the newest set of pictures not read yet; pass `set` (e.g. "A") or `handles` (e.g. ["#3","#4"]) from the attachments list to read specific ones. The result is sent to the customer separately about a minute later; do not describe it yourself.',
    parameters: {
      type: "object",
      properties: {
        set: { type: "string", description: "A set label from the attachments list, like A." },
        handles: {
          type: "array",
          items: { type: "string" },
          description: 'Attachment numbers from the list, like ["#3","#4"]. Wins over set.',
        },
      },
      additionalProperties: false,
    },
  },
  schema: z.object({
    set: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{1,2}$/)
      .optional(),
    handles: z
      .array(z.union([z.string().trim().min(1).max(12), z.number().int().positive()]))
      .max(RX_MAX_PAGES)
      .optional(),
  }),
  linkedOnly: true,
  effect: "write",
  // A refusal (no picture yet, still processing, no credits) did nothing and may succeed on a retry.
  settled: (result) => (result as { started?: unknown }).started === true,
  handler: (ctx, args, effect) => {
    const call = callOf(ctx, effect);
    if (call === null) return toolError("not_linked");
    // The selection is only used by a v2 call (it carries a session); v1 ignores it.
    const selection = {
      ...(args.set === undefined ? {} : { set: args.set }),
      ...(args.handles === undefined ? {} : { handles: args.handles }),
    };
    return ctx.deps.usage.analyzePrescription(
      Object.keys(selection).length === 0 ? call : { ...call, selection },
    );
  },
});
