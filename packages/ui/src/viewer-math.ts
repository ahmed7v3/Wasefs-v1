/*
 * Geometry of the prescription image viewer. Everything is pure so zoom, pan, pinch and the
 * box-to-region mapping are tested without a browser. Coordinates: the "stage" is the clipped
 * viewport, the "content" is the image fitted to the stage at scale 1, and the transform moves and
 * scales the content with its origin at the content's top-left (`translate(x, y) scale(s)`).
 */

/** Normalized 0-1000 box `[ymin, xmin, ymax, xmax]` (the model's convention, see `rx.ts`). */
export type Box2d = readonly [number, number, number, number];

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 6;
export const ZOOM_STEP = 1.25;
/** Pixels one arrow-key press pans the image by. */
export const PAN_STEP = 48;
/** A pointer that moves less than this between down and up is a tap, not a drag. */
export const TAP_SLOP = 4;

const BOX_SCALE = 1000;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** The largest size with the image's aspect ratio that fits the stage (small images are enlarged to fill it). */
export function fitSize(natural: Size, stage: Size): Size {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return { width: 0, height: 0 };
  }
  const ratio = Math.min(stage.width / natural.width, stage.height / natural.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** Percentages of a box inside the content, as logical properties (the stage is `dir="ltr"`, so start = left). */
export function boxToStyle(box: Box2d): {
  insetInlineStart: string;
  insetBlockStart: string;
  inlineSize: string;
  blockSize: string;
} {
  const [ymin, xmin, ymax, xmax] = box;
  const pct = (value: number): string => `${String((value / BOX_SCALE) * 100)}%`;
  return {
    insetInlineStart: pct(xmin),
    insetBlockStart: pct(ymin),
    inlineSize: pct(xmax - xmin),
    blockSize: pct(ymax - ymin),
  };
}

/** A box in content pixels at scale 1. */
export function boxToRect(
  box: Box2d,
  content: Size,
): { x: number; y: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x: (xmin / BOX_SCALE) * content.width,
    y: (ymin / BOX_SCALE) * content.height,
    width: ((xmax - xmin) / BOX_SCALE) * content.width,
    height: ((ymax - ymin) / BOX_SCALE) * content.height,
  };
}

/** Keeps the content inside the stage; content smaller than the stage on an axis is centred on it. */
export function clampTransform(
  transform: ViewTransform,
  content: Size,
  stage: Size,
): ViewTransform {
  const scale = clamp(transform.scale, MIN_SCALE, MAX_SCALE);
  const axis = (offset: number, contentLength: number, stageLength: number): number => {
    const scaled = contentLength * scale;
    if (scaled <= stageLength) return (stageLength - scaled) / 2;
    return clamp(offset, stageLength - scaled, 0);
  };
  return {
    scale,
    x: axis(transform.x, content.width, stage.width),
    y: axis(transform.y, content.height, stage.height),
  };
}

/** Scale 1, centred. */
export function initialTransform(content: Size, stage: Size): ViewTransform {
  return clampTransform({ scale: MIN_SCALE, x: 0, y: 0 }, content, stage);
}

/**
 * Moves and scales so the content point that was under `from` (stage coordinates, at `start`) ends
 * up under `to`, with the scale multiplied by `ratio`. One finger is `ratio = 1`; a pinch passes the
 * change of distance; the wheel passes the same point twice.
 */
export function anchorTransform(
  start: ViewTransform,
  from: Point,
  to: Point,
  ratio: number,
  content: Size,
  stage: Size,
): ViewTransform {
  const scale = clamp(start.scale * ratio, MIN_SCALE, MAX_SCALE);
  const contentX = (from.x - start.x) / start.scale;
  const contentY = (from.y - start.y) / start.scale;
  return clampTransform(
    { scale, x: to.x - contentX * scale, y: to.y - contentY * scale },
    content,
    stage,
  );
}

/** Zoom by `factor` around a stage point (the wheel, +/-). */
export function zoomAt(
  transform: ViewTransform,
  factor: number,
  point: Point,
  content: Size,
  stage: Size,
): ViewTransform {
  return anchorTransform(transform, point, point, factor, content, stage);
}

/** Pan by a viewport step: a positive `dx` moves the view to the right, so the image moves left. */
export function panBy(
  transform: ViewTransform,
  dx: number,
  dy: number,
  content: Size,
  stage: Size,
): ViewTransform {
  return clampTransform({ ...transform, x: transform.x - dx, y: transform.y - dy }, content, stage);
}

/**
 * Brings a box fully into the stage with the least movement; a box larger than the stage is
 * centred. Does nothing when the box is already visible.
 */
export function revealBox(
  transform: ViewTransform,
  box: Box2d,
  content: Size,
  stage: Size,
  margin = 24,
): ViewTransform {
  const rect = boxToRect(box, content);
  const axis = (offset: number, start: number, length: number, stageLength: number): number => {
    const from = offset + start * transform.scale;
    const size = length * transform.scale;
    if (size + margin * 2 >= stageLength) return offset + (stageLength / 2 - (from + size / 2));
    if (from < margin) return offset + (margin - from);
    if (from + size > stageLength - margin) return offset - (from + size - (stageLength - margin));
    return offset;
  };
  return clampTransform(
    {
      scale: transform.scale,
      x: axis(transform.x, rect.x, rect.width, stage.width),
      y: axis(transform.y, rect.y, rect.height, stage.height),
    },
    content,
    stage,
  );
}

/** A stage point as a 0-1000 position inside the content, or `null` outside it. */
export function stageToBox(
  point: Point,
  transform: ViewTransform,
  content: Size,
): { x: number; y: number } | null {
  if (content.width <= 0 || content.height <= 0) return null;
  const x = ((point.x - transform.x) / transform.scale / content.width) * BOX_SCALE;
  const y = ((point.y - transform.y) / transform.scale / content.height) * BOX_SCALE;
  if (x < 0 || y < 0 || x > BOX_SCALE || y > BOX_SCALE) return null;
  return { x, y };
}

/** The smallest region containing a 0-1000 position (the innermost one wins when boxes overlap). */
export function regionAt<R extends { id: string; box: Box2d }>(
  regions: readonly R[],
  position: { x: number; y: number },
): R | null {
  let best: R | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const [ymin, xmin, ymax, xmax] = region.box;
    if (position.x < xmin || position.x > xmax || position.y < ymin || position.y > ymax) continue;
    const area = (xmax - xmin) * (ymax - ymin);
    if (area < bestArea) {
      best = region;
      bestArea = area;
    }
  }
  return best;
}
