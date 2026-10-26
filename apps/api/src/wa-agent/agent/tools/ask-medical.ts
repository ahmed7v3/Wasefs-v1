import { z } from "zod";

import { callOf, defineTool, toolError } from "./tool.js";

/**
 * One medical question answered by the platform's own assistant (charges credits by use). The answer
 * is delivered to the customer directly; it is never returned here, so it cannot be reworded.
 */
export const askMedicalTool = defineTool({
  definition: {
    name: "ask_medical",
    description:
      "Send the customer's medical question to the platform's medical assistant. It answers the customer directly (charges credits from their account). Use it for every medical question from a linked customer, after they agreed to the cost or asked explicitly. You never see or rephrase the answer; add at most one short non-medical line.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The customer's question in their own words, with the needed context.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  schema: z.object({ question: z.string().trim().min(1).max(2_000) }),
  linkedOnly: true,
  handler: (ctx, args) => {
    const call = callOf(ctx);
    if (call === null) return toolError("not_linked");
    return ctx.deps.usage.askMedical(call, args.question);
  },
});
