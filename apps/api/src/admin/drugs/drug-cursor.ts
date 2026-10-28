/** Opaque page cursors of the admin drug lists: the offset of the next page, base64url-encoded. */
export const encodeDrugCursor = (offset: number): string =>
  Buffer.from(String(offset)).toString("base64url");

/** A missing or malformed cursor is the first page. */
export function decodeDrugCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, "base64url").toString();
  return /^\d{1,7}$/.test(text) ? Number(text) : 0;
}
