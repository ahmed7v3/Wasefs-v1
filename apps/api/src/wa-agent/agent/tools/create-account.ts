import { z } from "zod";

import { defineTool } from "./tool.js";

/**
 * Creates the account for this chat's own, WhatsApp-verified number (docs/WA-SIGNUP.md section 3).
 * Only offered to a guest, only after the customer said yes to the terms, and the number is the
 * chat's: the model cannot name another one.
 */
export const createAccountTool = defineTool({
  definition: {
    name: "create_account",
    description:
      "Create the customer's Wasfa account for this WhatsApp number, only after you asked them to confirm (mentioning the terms) and they said yes. Returns a one-time sign-in link to send as it is.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name to put on the account, if they gave one." },
        confirmed: {
          type: "boolean",
          description:
            "True only if the customer clearly agreed to create the account and to the terms.",
        },
      },
      required: ["confirmed"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    name: z.string().trim().min(1).max(60).optional(),
    confirmed: z.boolean(),
  }),
  linkedOnly: false,
  guestOnly: true,
  feature: "accountSignup",
  handler: (ctx, args) => {
    if (!args.confirmed) return { created: false, reason: "needs_confirmation" };
    // A guest whose number WhatsApp did not reveal cannot get an account here: the website is the way.
    const phone = ctx.phone ?? null;
    if (phone === null) return { created: false, reason: "phone_unknown" };
    return ctx.deps.accounts.create({
      conversationId: ctx.conversationId,
      phone,
      ...(args.name === undefined ? {} : { name: args.name }),
    });
  },
});
