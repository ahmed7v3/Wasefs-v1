import { Inject, Injectable } from "@nestjs/common";
import { userNotes, users, type UserNote } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { and, desc, eq, sql } from "drizzle-orm";

import { DB, type DbHandle } from "../../common/database.js";
import { stamp } from "../common/keyset.js";

export interface NoteCursor {
  pinned: boolean;
  at: string;
  id: string;
}

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{6}Z$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeNoteCursor(cursor: NoteCursor): string {
  const flag = cursor.pinned ? "1" : "0";
  return Buffer.from(`${flag}|${cursor.at}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeNoteCursor(raw: string | undefined): NoteCursor | undefined {
  if (raw === undefined) return undefined;
  const [flag, at, id, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  if (
    rest.length > 0 ||
    (flag !== "0" && flag !== "1") ||
    at === undefined ||
    id === undefined ||
    !AT.test(at) ||
    !ID.test(id)
  ) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["cursor"] } });
  }
  return { pinned: flag === "1", at, id };
}

/** Internal notes on a user. Rows are always read through the user they belong to. */
@Injectable()
export class AdminUserNotesRepo {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  /** `limit + 1` notes: pinned first, then newest first. */
  page(userId: string, cursor: NoteCursor | undefined, limit: number) {
    return this.handle.db
      .select({
        id: userNotes.id,
        body: userNotes.body,
        pinned: userNotes.pinned,
        authorId: userNotes.authorId,
        authorName: users.name,
        createdAt: userNotes.createdAt,
        updatedAt: userNotes.updatedAt,
        cursorAt: stamp(userNotes.createdAt),
      })
      .from(userNotes)
      .leftJoin(users, eq(users.id, userNotes.authorId))
      .where(
        and(
          eq(userNotes.userId, userId),
          cursor
            ? sql`(${userNotes.pinned}, ${userNotes.createdAt}, ${userNotes.id}) < (${cursor.pinned}::boolean, ${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(userNotes.pinned), desc(userNotes.createdAt), desc(userNotes.id))
      .limit(limit + 1);
  }

  async insert(userId: string, authorId: string, body: string, pinned: boolean): Promise<UserNote> {
    const [row] = await this.handle.db
      .insert(userNotes)
      .values({ userId, authorId, body, pinned })
      .returning();
    if (!row) throw new Error("Note was not stored");
    return row;
  }

  async find(userId: string, noteId: string): Promise<UserNote | undefined> {
    const [row] = await this.handle.db
      .select()
      .from(userNotes)
      .where(and(eq(userNotes.id, noteId), eq(userNotes.userId, userId)));
    return row;
  }

  async update(
    userId: string,
    noteId: string,
    patch: { body?: string; pinned?: boolean },
  ): Promise<UserNote | undefined> {
    const [row] = await this.handle.db
      .update(userNotes)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(and(eq(userNotes.id, noteId), eq(userNotes.userId, userId)))
      .returning();
    return row;
  }

  async remove(userId: string, noteId: string): Promise<boolean> {
    const rows = await this.handle.db
      .delete(userNotes)
      .where(and(eq(userNotes.id, noteId), eq(userNotes.userId, userId)))
      .returning({ id: userNotes.id });
    return rows.length > 0;
  }
}
