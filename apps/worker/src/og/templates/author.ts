import { ogAuthorInputSchema } from "@wasfa/shared/schemas/og";

import {
  COLOR,
  frame,
  gap,
  imagePanel,
  SAFE,
  SAFE_WIDTH,
  sideOf,
  stack,
  textBlock,
  TITLE_SIZES,
  type Block,
} from "../frame.js";

import type { OgTemplate } from "./types.js";

const PHOTO = { size: 260, gutter: 56, top: 185 } as const;

/** Round photo (when there is one) on the start side, the name and the credentials line. */
export const authorTemplate: OgTemplate<"author"> = {
  id: "author",
  version: 1,
  schema: ogAuthorInputSchema,
  async render(input, assets) {
    const side = sideOf(input.locale);
    const withPhoto = input.photo !== undefined && assets.photo !== undefined;
    const column = withPhoto
      ? {
          width: SAFE_WIDTH - PHOTO.size - PHOTO.gutter,
          edge: side.rtl
            ? SAFE.right - PHOTO.size - PHOTO.gutter
            : SAFE.left + PHOTO.size + PHOTO.gutter,
        }
      : { width: SAFE_WIDTH, edge: side.edge };

    const blocks: Block[] = [
      await textBlock(input.name, side, {
        ...column,
        sizes: TITLE_SIZES,
        maxLines: 2,
        weight: 700,
        fill: COLOR.primary,
      }),
    ];
    if (input.credentials !== undefined) {
      blocks.push(
        gap(20),
        await textBlock(input.credentials, side, {
          ...column,
          sizes: [32],
          maxLines: 3,
          weight: 400,
          fill: COLOR.textMuted,
        }),
      );
    }

    let photo = "";
    if (input.photo !== undefined && assets.photo !== undefined) {
      photo = await imagePanel(assets.photo, input.photo, {
        id: "photo",
        circle: true,
        x: side.rtl ? SAFE.right - PHOTO.size : SAFE.left,
        y: PHOTO.top,
        width: PHOTO.size,
        height: PHOTO.size,
      });
    }
    return frame(side, photo + stack(blocks));
  },
};
