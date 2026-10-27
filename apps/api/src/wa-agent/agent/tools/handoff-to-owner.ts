import { z } from "zod";

import { defineTool } from "./tool.js";

/**
 * Hands the chat to the owner. The alert goes out now; the pause itself waits until the model's last
 * reply was delivered (the bridge refuses to send into a paused chat), see `WaAgentTurnService`.
 */
export const handoffToOwnerTool = defineTool({
  definition: {
    name: "handoff_to_owner",
    description:
      "Hand this conversation to the owner (a human) when the customer asks for a person, is upset, or needs something you cannot do. After calling it, tell the customer the owner will reply.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the owner, at most 200 characters.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
  schema: z.object({ reason: z.string().trim().min(1).max(200) }),
  linkedOnly: false,
  handler: async (ctx, args) => {
    await ctx.deps.handoff.raise(ctx.conversationId, args.reason);
    ctx.handoffReason = args.reason;
    return { handedOff: true };
  },
});
