import { ogArticleInputSchema } from "@wasfa/shared/schemas/og";

import {
  chipBlock,
  COLOR,
  frame,
  gap,
  imagePanel,
  LABELS,
  SAFE,
  SAFE_WIDTH,
  sideOf,
  stack,
  textBlock,
  TITLE_SIZES,
  type Block,
} from "../frame.js";

import type { OgTemplate } from "./types.js";

const COVER = { width: 420, height: 400, gutter: 48, top: 150 } as const;

/** Category chip, title, author; the cover (when there is one) sits on the start half, cropped by its focal point. */
export const articleTemplate: OgTemplate<"article"> = {
  id: "article",
  version: 1,
  schema: ogArticleInputSchema,
  async render(input, assets) {
    const side = sideOf(input.locale);
    const hasCover = input.cover !== undefined && assets.cover !== undefined;
    const columnWidth = hasCover ? SAFE_WIDTH - COVER.width - COVER.gutter : SAFE_WIDTH;
    // The cover takes the start side; the text column keeps the card's alignment next to it.
    const textEdge = !hasCover
      ? side.edge
      : side.rtl
        ? SAFE.right - COVER.width - COVER.gutter
        : SAFE.left + COVER.width + COVER.gutter;
    const column = { edge: textEdge, width: columnWidth };

    const blocks: Block[] = [
      await chipBlock(input.category, side, column),
      gap(28),
      await textBlock(input.title, side, {
        ...column,
        sizes: TITLE_SIZES,
        maxLines: 3,
        weight: 700,
        fill: COLOR.primary,
      }),
    ];
    if (input.authorName !== undefined) {
      blocks.push(
        gap(24),
        await textBlock(`${LABELS[input.locale].by} ${input.authorName}`, side, {
          ...column,
          sizes: [32],
          maxLines: 1,
          weight: 400,
          fill: COLOR.textMuted,
        }),
      );
    }

    let cover = "";
    if (input.cover !== undefined && assets.cover !== undefined) {
      cover = await imagePanel(assets.cover, input.cover, {
        id: "cover",
        x: side.rtl ? SAFE.right - COVER.width : SAFE.left,
        y: COVER.top,
        width: COVER.width,
        height: COVER.height,
      });
    }
    return frame(side, cover + stack(blocks));
  },
};
