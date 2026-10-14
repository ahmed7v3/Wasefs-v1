/** Helpers shared by the drop and paste handlers. Pure, so they are tested without a browser. */

const SUPPORTED_EXTENSIONS = /\.(jpe?g|png|webp|gif|bmp|heic|heif|pdf)$/i;

/** Images (HEIC included, some browsers leave its type empty) and PDFs. */
export function isSupportedCaptureFile(file: Pick<File, "type" | "name">): boolean {
  if (file.type.startsWith("image/") || file.type === "application/pdf") return true;
  return file.type === "" && SUPPORTED_EXTENSIONS.test(file.name);
}

/** Every file in a drop or paste, from `files` first and `items` as the fallback (screenshots). */
export function filesFromTransfer(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files.length > 0) return Array.from(data.files);
  const found: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) found.push(file);
  }
  return found;
}

/** True when the drag carries files (not text or a link), so the overlay shows only for those. */
export function isFileDrag(data: DataTransfer | null): boolean {
  return data !== null && Array.from(data.types).includes("Files");
}

export function isRtl(element: Element | null): boolean {
  const direction = element?.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir;
  return direction === "rtl";
}

/** Moves the item with `id` by `delta` places, clamped. Returns the same array when nothing moves. */
export function moveItem<T extends { localId: string }>(
  items: readonly T[],
  id: string,
  delta: number,
): T[] {
  const from = items.findIndex((item) => item.localId === id);
  const to = Math.min(items.length - 1, Math.max(0, from + delta));
  if (from === -1 || from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/**
 * What an arrow key means for a page: the position change, or `null` for other keys. The arrows
 * follow what the user sees, so in RTL the right arrow moves a page toward the start.
 */
export function arrowToDelta(key: string, rtl: boolean): number | null {
  switch (key) {
    case "ArrowRight":
      return rtl ? -1 : 1;
    case "ArrowLeft":
      return rtl ? 1 : -1;
    case "ArrowUp":
      return -1;
    case "ArrowDown":
      return 1;
    default:
      return null;
  }
}
