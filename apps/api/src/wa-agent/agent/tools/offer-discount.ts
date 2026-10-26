import { z } from "zod";

import { callOf, defineTool, toolError } from "./tool.js";

/** The periods the catalog sells; the tools refuse any other before a service is called. */
export const MONTHS_SCHEMA = z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]);

/**
 * A personal single-use coupon under the owner's discount policy. The model names a plan and a
 * period; whether an offer is allowed, its size and its expiry are decided by the server, and a
 * refusal comes back as a reason code (`{ offered: false, reason }`), never as an error.
 */
export const offerDiscountTool = defineTool({
  definition: {
    name: "offer_discount",
    description:
      "Offer the linked customer a personal discount code for ONE plan and period. Only when the customer hesitates about the price, never in the first messages, and at most once per conversation. The server may refuse; then do not promise any discount. Mention urgency only from the returned expiry.",
    parameters: {
      type: "object",
      properties: {
        planKey: { type: "string", description: "The plan key from get_catalog." },
        months: { type: "integer", enum: [1, 3, 6, 12], description: "Subscription months." },
      },
      required: ["planKey", "months"],
      additionalProperties: false,
    },
  },
  schema: z.object({ planKey: z.string().trim().min(1).max(40), months: MONTHS_SCHEMA }),
  linkedOnly: true,
  handler: (ctx, args) => {
    const call = callOf(ctx);
    if (call === null) return toolError("not_linked");
    return ctx.deps.commerce.offerDiscount(call, args.planKey, args.months);
  },
});
