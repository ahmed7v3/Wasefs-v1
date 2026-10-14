/*
 * The maths of the image editor, kept apart from the component so it is testable. Crop edges are
 * "insets": the fraction of the (already rotated) image cut away from each side. They are physical
 * (left is left on screen in any language) because they describe the picture, not the page layout.
 */

export interface CropInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type CropEdge = keyof CropInsets;

export const NO_CROP: CropInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The crop never gets smaller than this share of either side. */
export const MIN_CROP_SHARE = 0.1;

const OPPOSITE: Record<CropEdge, CropEdge> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/** Moves one edge by `delta` (positive = inward), keeping the crop inside the image and big enough. */
export function adjustInset(crop: CropInsets, edge: CropEdge, delta: number): CropInsets {
  const room = 1 - MIN_CROP_SHARE - crop[OPPOSITE[edge]];
  const value = Math.min(Math.max(crop[edge] + delta, 0), Math.max(0, room));
  return { ...crop, [edge]: Math.round(value * 10_000) / 10_000 };
}

/** What an arrow key does to an edge handle: positive moves the edge inward. */
export function keyToInsetDelta(edge: CropEdge, key: string, step: number): number | null {
  const inward: Record<CropEdge, string> = {
    left: "ArrowRight",
    right: "ArrowLeft",
    top: "ArrowDown",
    bottom: "ArrowUp",
  };
  const outward: Record<CropEdge, string> = {
    left: "ArrowLeft",
    right: "ArrowRight",
    top: "ArrowUp",
    bottom: "ArrowDown",
  };
  if (key === inward[edge]) return step;
  if (key === outward[edge]) return -step;
  return null;
}

/** The pixel rectangle to keep, at least one pixel on each side. */
export function cropRect(
  crop: CropInsets,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.round(crop.left * width);
  const y = Math.round(crop.top * height);
  const right = Math.round((1 - crop.right) * width);
  const bottom = Math.round((1 - crop.bottom) * height);
  return {
    x: Math.min(x, width - 1),
    y: Math.min(y, height - 1),
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/** Size after `quarterTurns` clockwise quarter turns. */
export function rotatedSize(
  width: number,
  height: number,
  quarterTurns: number,
): { width: number; height: number } {
  return quarterTurns % 2 === 0 ? { width, height } : { width: height, height: width };
}

/** Scales down to `maxEdge` on the long edge. Never scales up. */
export function fitLongEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
