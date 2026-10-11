import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/*
 * Keyset pagination for the admin lists: newest first, ties broken by the key. A cursor is
 * base64url(`<timestamp>|<key>`). The timestamp is Postgres' own text with microseconds (`stamp`),
 * not a JS Date, so rows created in the same millisecond are neither skipped nor repeated.
 */

export interface Cursor {
  at: string;
  key: string;
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{6}Z$/;
const KEYS = {
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  hex: /^[0-9a-f]{8,128}$/,
} as const;
export type CursorKeyKind = keyof typeof KEYS;

const malformed = () =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["cursor"] } });

/** `raw` is the client's `cursor` query value; a malformed one is `VALIDATION_FAILED`. */
export function decodeCursor(raw: string | undefined, kind: CursorKeyKind): Cursor | undefined {
  if (raw === undefined) return undefined;
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const [at, key] = parts;
  if (parts.length !== 2 || at === undefined || key === undefined) throw malformed();
  if (!STAMP.test(at) || Number.isNaN(Date.parse(at)) || !KEYS[kind].test(key)) throw malformed();
  return { at, key };
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at}|${cursor.key}`, "utf8").toString("base64url");
}

/** The column as exact UTC text with microseconds: what goes into a cursor. */
export function stamp(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** `(at, key) < cursor`: the rows after the cursor in a `desc, desc` ordering. */
export function afterCursor(
  atColumn: AnyColumn | SQL,
  keyColumn: AnyColumn | SQL,
  cursor: Cursor,
  kind: CursorKeyKind,
): SQL {
  const keyType = kind === "uuid" ? sql`uuid` : sql`text`;
  return sql`(${atColumn}, ${keyColumn}) < (${cursor.at}::timestamptz, ${cursor.key}::${keyType})`;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * `rows` were fetched with `limit + 1`; the extra row only says "there is another page" and its
 * predecessor (the last row shown) becomes the cursor.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}

/** Escapes `\`, `%` and `_` so user text matches literally inside `LIKE '%...%'`. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
