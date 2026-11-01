import { couponCodeSchema } from "@wasfa/shared/schemas/billing";
import { z } from "zod";

import { MONTHS_SCHEMA } from "./offer-discount.js";
import { callOf, defineTool, toolError } from "./tool.js";

/**
 * Opens (or finds) the linked customer's order for a plan by bank transfer and returns the amount
 * and the transfer details exactly as the website shows them. A coupon that does not apply never
 * blocks the order; the result says so and carries the full price.
 */
export const startSubscriptionTool = defineTool({
  definition: {
    name: "start_subscription",
    description:
      "Create the customer's subscription order paid by bank transfer, after they chose a plan and period. Returns the exact amount and the transfer details to pass on as they are. Include the discount code only if you gave one or the customer has one.",
    parameters: {
      type: "object",
      properties: {
        planKey: { type: "string", description: "The plan key from get_catalog." },
        months: { type: "integer", enum: [1, 3, 6, 12], description: "Subscription months." },
        couponCode: { type: "string", description: "A discount code, if any." },
      },
      required: ["planKey", "months"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    planKey: z.string().trim().min(1).max(40),
    months: MONTHS_SCHEMA,
    couponCode: couponCodeSchema.optional(),
  }),
  linkedOnly: true,
  effect: "write",
  handler: (ctx, args) => {
    const call = callOf(ctx);
    if (call === null) return toolError("not_linked");
    return ctx.deps.commerce.startSubscription(call, args);
  },
});
