import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../../audit/audit.service.js";
import { toPage } from "../common/keyset.js";

import { AdminUsersRepo } from "./admin-users.repo.js";
import { AdminUserNotesRepo, decodeNoteCursor, encodeNoteCursor } from "./user-notes.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { UserNote } from "@wasfa/db";
import type {
  AdminNoteCreate,
  AdminNotePatch,
  AdminUserPageQuery,
} from "@wasfa/shared/schemas/admin-user-360";
import type { FastifyRequest } from "fastify";

const view = (note: UserNote, authorName: string | null) => ({
  id: note.id,
  body: note.body,
  pinned: note.pinned,
  authorId: note.authorId,
  authorName,
  createdAt: note.createdAt.toISOString(),
  updatedAt: note.updatedAt.toISOString(),
});

/**
 * Internal notes (support history). Reading and writing both need `users.read`: support writes
 * notes. The author edits the text; pinning is open to anyone who can read; the author or a super
 * admin deletes. Note text is never copied into the audit trail.
 */
@Injectable()
export class AdminUserNotesService {
  constructor(
    private readonly repo: AdminUserNotesRepo,
    private readonly users: AdminUsersRepo,
    private readonly audit: AuditService,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.users.find(userId))) throw new AppError(ErrorCode.NOT_FOUND);
  }

  async list(userId: string, query: AdminUserPageQuery) {
    await this.requireUser(userId);
    const rows = await this.repo.page(userId, decodeNoteCursor(query.cursor), query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    const last = page.items.at(-1);
    return {
      items: page.items.map((row) => ({
        id: row.id,
        body: row.body,
        pinned: row.pinned,
        authorId: row.authorId,
        authorName: row.authorName,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor:
        page.nextCursor !== null && last
          ? encodeNoteCursor({ pinned: last.pinned, at: last.cursorAt, id: last.id })
          : null,
    };
  }

  async create(
    actor: AuthenticatedUser,
    userId: string,
    input: AdminNoteCreate,
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    const note = await this.repo.insert(userId, actor.id, input.body, input.pinned);
    await this.audit.recordFor(request, {
      action: "user.note_created",
      targetType: "user",
      targetId: userId,
      after: { pinned: note.pinned },
    });
    return view(note, actor.name);
  }

  async patch(
    actor: AuthenticatedUser,
    userId: string,
    noteId: string,
    input: AdminNotePatch,
    request: FastifyRequest,
  ) {
    const note = await this.repo.find(userId, noteId);
    if (!note) throw new AppError(ErrorCode.NOT_FOUND);
    if (input.body !== undefined && note.authorId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "not_author" } });
    }
    const updated = await this.repo.update(userId, noteId, {
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
    });
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(request, {
      action: "user.note_updated",
      targetType: "user",
      targetId: userId,
      before: { pinned: note.pinned },
      after: { pinned: updated.pinned, bodyChanged: input.body !== undefined },
    });
    return view(updated, null);
  }

  async remove(actor: AuthenticatedUser, userId: string, noteId: string, request: FastifyRequest) {
    const note = await this.repo.find(userId, noteId);
    if (!note) throw new AppError(ErrorCode.NOT_FOUND);
    if (note.authorId !== actor.id && !actor.isSuperAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "not_author" } });
    }
    await this.repo.remove(userId, noteId);
    await this.audit.recordFor(request, {
      action: "user.note_deleted",
      targetType: "user",
      targetId: userId,
      before: { pinned: note.pinned },
    });
    return { deleted: true };
  }
}
