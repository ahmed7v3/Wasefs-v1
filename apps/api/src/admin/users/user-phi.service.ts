import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PHI_ACCESS_SESSION_MINUTES } from "@wasfa/shared/growth";
import { redactText } from "@wasfa/shared/redact";

import { AuditService } from "../../audit/audit.service.js";
import { ChatRepo } from "../../chat/chat.repo.js";
import { messageView } from "../../chat/chat.service.js";
import { FilesService } from "../../files/files.service.js";
import { RxService } from "../../rx/rx.service.js";
import { decodeCursor, toPage, withoutCursor } from "../common/keyset.js";

import { AdminUsersRepo } from "./admin-users.repo.js";
import { AdminUserPhiRepo } from "./user-phi.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { AdminPhiSession, AdminUserPageQuery } from "@wasfa/shared/schemas/admin-user-360";
import type { FastifyRequest } from "fastify";

const MINUTE_MS = 60_000;

/**
 * Health data access (ADMIN-CONSOLE-SPEC §8.2, Decision 12). The permission is the route's; this
 * service adds the second lock: an unexpired access session of the SAME admin for the SAME user,
 * chosen with a reason. Every open of a result or transcript writes a `phi.view` audit row (ids
 * verbatim, see `RecordOptions.verbatim`) before the data leaves. Nothing here exports anything.
 */
@Injectable()
export class AdminUserPhiService {
  constructor(
    private readonly repo: AdminUserPhiRepo,
    private readonly users: AdminUsersRepo,
    private readonly rx: RxService,
    private readonly files: FilesService,
    private readonly chats: ChatRepo,
    private readonly audit: AuditService,
  ) {}

  private async requireUser(userId: string): Promise<void> {
    if (!(await this.users.find(userId))) throw new AppError(ErrorCode.NOT_FOUND);
  }

  private async requireSession(actor: AuthenticatedUser, userId: string) {
    const session = await this.repo.activeSession(actor.id, userId, new Date());
    if (!session) {
      throw new AppError(ErrorCode.FORBIDDEN, { details: { reason: "phi_session_required" } });
    }
    return session;
  }

  async startSession(
    actor: AuthenticatedUser,
    userId: string,
    input: AdminPhiSession,
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    const expiresAt = new Date(Date.now() + PHI_ACCESS_SESSION_MINUTES * MINUTE_MS);
    const session = await this.repo.createSession({
      adminId: actor.id,
      userId,
      reason: input.reason,
      note: input.note ? redactText(input.note) : null,
      expiresAt,
    });
    await this.audit.recordFor(
      request,
      {
        action: "phi.session_started",
        targetType: "user",
        targetId: userId,
        after: { sessionId: session.id, reason: session.reason },
      },
      { verbatim: true },
    );
    return { id: session.id, reason: session.reason, expiresAt: session.expiresAt.toISOString() };
  }

  async activeSession(actor: AuthenticatedUser, userId: string) {
    await this.requireUser(userId);
    const session = await this.repo.activeSession(actor.id, userId, new Date());
    return {
      session: session
        ? {
            id: session.id,
            reason: session.reason,
            expiresAt: session.expiresAt.toISOString(),
          }
        : null,
    };
  }

  async prescriptions(userId: string, query: AdminUserPageQuery) {
    await this.requireUser(userId);
    const rows = await this.repo.prescriptionPage(
      userId,
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      items: page.items.map((row) => ({
        ...withoutCursor(row),
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async openPrescription(
    actor: AuthenticatedUser,
    userId: string,
    rxId: string,
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    const session = await this.requireSession(actor, userId);
    const row = await this.repo.findPrescription(userId, rxId);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND);
    // The very mapper the customer's own result page uses.
    const view = await this.rx.view(row);
    const images = await Promise.all(
      view.files.map(async (file) => {
        // A deleted picture (retention) has no link; the reading stays. Storage that cannot sign a
        // link (outage, not configured) must not hide the reading either.
        const link = file.imageDeleted
          ? null
          : await this.files.adminPictureUrl(file.fileId).catch(() => null);
        return {
          fileId: file.fileId,
          pageNo: file.pageNo,
          url: link?.url ?? null,
          expiresInSeconds: link?.expiresInSeconds ?? null,
        };
      }),
    );
    await this.recordView(request, userId, "rx_analysis", rxId, session);
    return { view, images };
  }

  async chatList(userId: string, query: AdminUserPageQuery) {
    await this.requireUser(userId);
    const rows = await this.repo.chatPage(userId, decodeCursor(query.cursor, "uuid"), query.limit);
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    return {
      items: page.items.map((row) => ({
        ...withoutCursor(row),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async openChat(
    actor: AuthenticatedUser,
    userId: string,
    chatId: string,
    query: AdminUserPageQuery,
    request: FastifyRequest,
  ) {
    await this.requireUser(userId);
    const session = await this.requireSession(actor, userId);
    // `require` is scoped to the user: a chat of someone else looks like a missing one.
    await this.chats.require(userId, chatId);
    const rows = await this.chats.messagesPage(
      userId,
      chatId,
      decodeCursor(query.cursor, "uuid"),
      query.limit,
    );
    const page = toPage(rows, query.limit, (row) => ({ at: row.cursorAt, key: row.id }));
    await this.recordView(request, userId, "chat", chatId, session);
    return { items: page.items.map(messageView), nextCursor: page.nextCursor };
  }

  private recordView(
    request: FastifyRequest,
    userId: string,
    recordType: "rx_analysis" | "chat",
    recordId: string,
    session: { id: string; reason: string },
  ): Promise<void> {
    return this.audit.recordFor(
      request,
      {
        action: "phi.view",
        targetType: "user",
        targetId: userId,
        after: { recordType, recordId, reason: session.reason, sessionId: session.id },
      },
      { verbatim: true },
    );
  }
}
