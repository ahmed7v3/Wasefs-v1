import { z } from "zod";

import { callOf, defineTool, toolError } from "./tool.js";

/**
 * Sends the receipt picture the customer just sent to the payment review queue. Takes no argument:
 * the server picks the newest unattached image or PDF of this chat and the order it belongs to.
 * It only files the receipt; a person approves the payment.
 */
export const attachReceiptTool = defineTool({
  definition: {
    name: "attach_receipt",
    description:
      "File the transfer receipt (image or PDF) the customer just sent into the payment review queue. Afterwards say it is under review and give the minutes; never say the payment or the subscription is confirmed.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  schema: z.object({}),
  linkedOnly: true,
  effect: "write",
  handler: (ctx) => {
    const call = callOf(ctx);
    if (call === null) return toolError("not_linked");
    return ctx.deps.commerce.attachReceipt(call);
  },
});
