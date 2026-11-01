import { z } from "zod";

import { toolError, defineTool } from "./tool.js";

/**
 * Lets the model look at one of the customer's pictures by handle (docs/WA-AGENT-RUNTIME.md §8.1): a box
 * photo, an older prescription page. The answer is only `{ ok, handle }`; the picture itself is added to
 * the next model step (`attachment-views.ts`). Two per turn. A read tool: it changes nothing.
 */
export const viewAttachmentTool = defineTool({
  definition: {
    name: "view_attachment",
    description:
      "Look at one of the customer's pictures listed under the attachments (by its handle, e.g. #3). Use it when the customer asks about a picture you cannot see yet, such as a medicine box or an earlier page. The picture is shown to you in the next step. At most two per reply.",
    parameters: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "The attachment number, like #3.",
        },
      },
      required: ["handle"],
      additionalProperties: false,
    },
  },
  schema: z.object({
    handle: z.union([z.string().trim().min(1).max(12), z.number().int().positive()]),
  }),
  linkedOnly: false,
  feature: "attachments",
  effect: "read",
  handler: (ctx, args) => {
    // v1 keeps no attachment registry: nothing to look at.
    if (ctx.views === undefined) return toolError("view_unavailable");
    return ctx.views.request(args.handle);
  },
});
