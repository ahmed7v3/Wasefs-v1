import { ogPageInputSchema } from "@wasfa/shared/schemas/og";

import { COLOR, frame, gap, sideOf, stack, textBlock, TITLE_SIZES, type Block } from "../frame.js";

import type { OgTemplate } from "./types.js";

/** Page title and one subtitle line: the static set of the public pages (home, pricing, legal, contact). */
export const pageTemplate: OgTemplate<"page"> = {
  id: "page",
  version: 1,
  schema: ogPageInputSchema,
  async render(input) {
    const side = sideOf(input.locale);
    const blocks: Block[] = [
      await textBlock(input.title, side, {
        sizes: TITLE_SIZES,
        maxLines: 3,
        weight: 700,
        fill: COLOR.primary,
      }),
    ];
    if (input.subtitle !== undefined) {
      blocks.push(
        gap(28),
        await textBlock(input.subtitle, side, {
          sizes: [36],
          maxLines: 1,
          weight: 400,
          fill: COLOR.textMuted,
        }),
      );
    }
    return frame(side, stack(blocks));
  },
};
