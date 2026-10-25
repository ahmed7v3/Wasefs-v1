/*
 * Focal point maths of the media drawer. The point is stored as integer percents of the image
 * (`focalX`, `focalY`, 0 to 100); the picker turns a pointer position or an arrow key into one.
 */

export interface FocalPoint {
  x: number;
  y: number;
}

export const FOCAL_KEY_STEP = 1;
export const FOCAL_KEY_STEP_LARGE = 10;

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

/** Percent position of a pointer inside a box (`left`/`top` + size); a zero-sized box gives the centre. */
export function focalFromPointer(
  point: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
): FocalPoint {
  if (box.width <= 0 || box.height <= 0) return { x: 50, y: 50 };
  return {
    // The image is not mirrored in RTL: x always grows to the physical right.
    x: clampPercent(((point.clientX - box.left) / box.width) * 100),
    y: clampPercent(((point.clientY - box.top) / box.height) * 100),
  };
}

/** The point after an arrow key (physical directions); shift moves by 10. Other keys return `null`. */
export function focalFromKey(current: FocalPoint, key: string, shift: boolean): FocalPoint | null {
  const step = shift ? FOCAL_KEY_STEP_LARGE : FOCAL_KEY_STEP;
  switch (key) {
    case "ArrowLeft":
      return { x: clampPercent(current.x - step), y: current.y };
    case "ArrowRight":
      return { x: clampPercent(current.x + step), y: current.y };
    case "ArrowUp":
      return { x: current.x, y: clampPercent(current.y - step) };
    case "ArrowDown":
      return { x: current.x, y: clampPercent(current.y + step) };
    case "Home":
      return { x: 50, y: 50 };
    default:
      return null;
  }
}
