import { z } from "zod";

import { defineTool, toolError } from "./tool.js";

/** The linked customer's plan, renewal date, credit balance and unpaid orders. Never takes an id. */
export const accountStatusTool = defineTool({
  definition: {
    name: "account_status",
    description:
      "The linked customer's own plan, renewal or expiry date, credit balance and orders waiting for payment.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}),
  linkedOnly: true,
  handler: async (ctx) => {
    // The server binds the account; a guest never reaches this, and a stray call gets a plain refusal.
    if (ctx.userId === null) return toolError("not_linked");
    return ctx.deps.account.status(ctx.userId, ctx.now);
  },
});
