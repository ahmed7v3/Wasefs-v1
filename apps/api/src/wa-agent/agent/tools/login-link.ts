import { z } from "zod";

import { defineTool, toolError } from "./tool.js";

/** A one-time sign-in link for the linked customer's own account (never for 2FA or staff accounts). */
export const loginLinkTool = defineTool({
  definition: {
    name: "login_link",
    description:
      "Give the linked customer a one-time link that signs them in to the website, valid for 15 minutes. Use it when they ask to log in or reach their account on the site.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}),
  linkedOnly: true,
  effect: "write",
  feature: "accountSignup",
  // The one-time sign-in link is a secret: it is never stored.
  unstored: ["loginUrl"],
  handler: (ctx) => {
    if (ctx.userId === null) return toolError("not_linked");
    return ctx.deps.accounts.loginLink(ctx.userId);
  },
});
