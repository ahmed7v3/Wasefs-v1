import { z } from "zod";

import { callOf, defineTool, toolError } from "./tool.js";

/**
 * Starts the paid prescription reading from the prescription pictures the customer just sent. The
 * result arrives later as a separate message; this tool only starts it and reports why it could not.
 */
export const analyzePrescriptionTool = defineTool({
  definition: {
    name: "analyze_prescription",
    description:
      "Read the prescription pictures the customer just sent (charges credits from their account). Use it only after the customer clearly agreed to the cost in credits, or asked for the reading explicitly. The result is sent to the customer separately about a minute later; do not describe it yourself.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}),
  linkedOnly: true,
  handler: (ctx) => {
    const call = callOf(ctx);
    if (call === null) return toolError("not_linked");
    return ctx.deps.usage.analyzePrescription(call);
  },
});
