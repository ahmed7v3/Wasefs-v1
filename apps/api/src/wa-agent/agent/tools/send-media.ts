import { isMediaOriginUrl } from "@wasfa/shared/schemas/wa-agent";
import { z } from "zod";

import { defineTool, toolError } from "./tool.js";

import type { MediaAsset } from "@wasfa/shared/schemas/media";

/** Widest rendition WhatsApp needs; wider ones only cost the customer data. */
const TARGET_WIDTH = 1_200;

/**
 * The JPEG (else WebP) rendition closest to `TARGET_WIDTH` without going far over it. AVIF is left
 * out: WhatsApp does not display it.
 */
export function pickImageVariant(variants: MediaAsset["variants"]): { key: string } | null {
  for (const format of ["jpeg", "webp"] as const) {
    const sized = variants.filter((variant) => variant.format === format);
    const fitting = sized.filter((variant) => variant.width <= TARGET_WIDTH);
    const best =
      fitting.length > 0
        ? fitting.reduce((a, b) => (b.width > a.width ? b : a))
        : sized.reduce<(typeof sized)[number] | undefined>(
            (a, b) => (a === undefined || b.width < a.width ? b : a),
            undefined,
          );
    if (best) return { key: best.key };
  }
  return null;
}

/**
 * Sends a picture the admin put in the agent media list (`waAgent.media`). The model names a list key;
 * everything else (which asset, which url) is decided here, and the url must lie under the public
 * media origin. The media library holds images only, so this is images only.
 */
export const sendMediaTool = defineTool({
  definition: {
    name: "send_media",
    description:
      "Send the customer a ready-made picture from the owner's media list (for example a screenshot or the bank details card). Use only a key the owner defined.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "The media list key." } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  schema: z.object({ key: z.string().trim().min(1).max(40) }),
  linkedOnly: false,
  handler: async (ctx, args) => {
    const item = ctx.config.media.find((entry) => entry.key === args.key);
    if (!item) return toolError("unknown_key");
    // Room is kept for at least one text message in the same turn.
    const limit = ctx.config.caps.maxMessagesPerTurn - 1;
    if (ctx.mediaParts.length >= limit) return toolError("limit_reached");

    const asset = await ctx.deps.media.find(item.mediaAssetId);
    if (!asset || asset.status !== "ready") return toolError("media_unavailable");
    const variant = pickImageVariant(asset.variants);
    if (!variant || ctx.deps.mediaOrigin === "") return toolError("media_unavailable");
    const url = `${ctx.deps.mediaOrigin.replace(/\/+$/, "")}/${variant.key}`;
    if (!isMediaOriginUrl(url, ctx.deps.mediaOrigin)) return toolError("media_unavailable");

    // The same picture twice in one turn is one picture.
    const already = ctx.mediaParts.some((part) => part.kind === "image" && part.url === url);
    if (!already) {
      ctx.mediaParts.push({
        kind: "image",
        url,
        ...(item.caption ? { caption: item.caption } : {}),
      });
    }
    return { sent: true };
  },
});
