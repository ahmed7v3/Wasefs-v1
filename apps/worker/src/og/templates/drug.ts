import { ogDrugInputSchema } from "@wasfa/shared/schemas/og";

import {
  chipBlock,
  COLOR,
  frame,
  gap,
  hasArabic,
  LABELS,
  SAFE,
  SAFE_WIDTH,
  sideOf,
  stack,
  textBlock,
  TITLE_SIZES,
  type Block,
} from "../frame.js";

import { pictogram } from "./pictograms.js";

import type { OgTemplate } from "./types.js";

const PICTOGRAM = { size: 240, gutter: 56, top: 190 } as const;

/** Arabic and English names, active ingredient, class chip, and a neutral pictogram of the dosage form. */
export const drugTemplate: OgTemplate<"drug"> = {
  id: "drug",
  version: 1,
  schema: ogDrugInputSchema,
  async render(input) {
    const side = sideOf(input.locale);
    const labels = LABELS[input.locale];
    const [primary, secondary] =
      input.locale === "ar" ? [input.nameAr, input.nameEn] : [input.nameEn, input.nameAr];
    const columnWidth = SAFE_WIDTH - PICTOGRAM.size - PICTOGRAM.gutter;
    const edge = side.rtl
      ? SAFE.right - PICTOGRAM.size - PICTOGRAM.gutter
      : SAFE.left + PICTOGRAM.size + PICTOGRAM.gutter;
    const column = { edge, width: columnWidth };

    const blocks: Block[] = [];
    if (input.drugClass !== undefined)
      blocks.push(await chipBlock(input.drugClass, side, column), gap(24));
    blocks.push(
      await textBlock(primary, side, {
        ...column,
        sizes: TITLE_SIZES,
        maxLines: 2,
        weight: 700,
        fill: COLOR.primary,
        rtl: hasArabic(primary),
      }),
      gap(12),
      await textBlock(secondary, side, {
        ...column,
        sizes: [40],
        maxLines: 1,
        weight: 400,
        fill: COLOR.text,
        rtl: hasArabic(secondary),
      }),
    );
    if (input.activeIngredient !== undefined) {
      blocks.push(
        gap(20),
        await textBlock(`${labels.activeIngredient}: ${input.activeIngredient}`, side, {
          ...column,
          sizes: [32],
          maxLines: 2,
          weight: 400,
          fill: COLOR.textMuted,
        }),
      );
    }
    const x = side.rtl ? SAFE.right - PICTOGRAM.size : SAFE.left;
    return frame(
      side,
      pictogram(input.dosageForm, x, PICTOGRAM.top, PICTOGRAM.size) + stack(blocks),
    );
  },
};
