import sharp from "sharp";

/** Normalized `[ymin, xmin, ymax, xmax]` on a 0-1000 scale (the `box_2d` convention). */
export type Box2d = readonly [number, number, number, number];

const PADDING = 0.15;
/** A crop smaller than this is too small to read, whatever the box says. */
const MIN_SIDE_PX = 48;
const CROP_JPEG_QUALITY = 90;

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The box in pixels, padded by 15% of its own size on every side, clamped to the image and never
 * smaller than `MIN_SIDE_PX` (grown around its centre). Pure, so the geometry is testable.
 */
export function cropRect(box: Box2d, imageWidth: number, imageHeight: number): PixelRect {
  const [ymin, xmin, ymax, xmax] = box;
  const boxWidth = ((xmax - xmin) / 1000) * imageWidth;
  const boxHeight = ((ymax - ymin) / 1000) * imageHeight;
  const centerX = ((xmin + xmax) / 2000) * imageWidth;
  const centerY = ((ymin + ymax) / 2000) * imageHeight;
  const width = Math.min(imageWidth, Math.max(MIN_SIDE_PX, boxWidth * (1 + 2 * PADDING)));
  const height = Math.min(imageHeight, Math.max(MIN_SIDE_PX, boxHeight * (1 + 2 * PADDING)));
  const left = Math.min(Math.max(0, centerX - width / 2), imageWidth - width);
  const top = Math.min(Math.max(0, centerY - height / 2), imageHeight - height);
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.max(1, Math.min(imageWidth - Math.round(left), Math.round(width))),
    height: Math.max(1, Math.min(imageHeight - Math.round(top), Math.round(height))),
  };
}

/**
 * Cuts one line out of a processed page for the verification pass. The crop keeps the page's own
 * pixels (no upscaling): how finely the model sees it is the route's `mediaResolution`. A line
 * without a box is verified on the whole page.
 */
export async function cropRegion(jpeg: Buffer, box: Box2d | null): Promise<Buffer> {
  if (box === null) return jpeg;
  const { width, height } = await sharp(jpeg).metadata();
  if (width === undefined || height === undefined) throw new Error("Image has no dimensions");
  return sharp(jpeg)
    .extract(cropRect(box, width, height))
    .jpeg({ quality: CROP_JPEG_QUALITY })
    .toBuffer();
}
