import { Injectable } from "@nestjs/common";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../../audit/audit.service.js";
import { OutboxQueue } from "../../common/outbox-queue.js";

import { traceRedirect } from "./redirect-rules.js";
import { RedirectsRepo } from "./redirects.repo.js";

import type { SlugRedirect } from "@wasfa/db";
import type { RedirectInput } from "@wasfa/shared/schemas/content";
import type { FastifyRequest } from "fastify";

const toRedirect = (row: SlugRedirect) => ({
  id: row.id,
  fromPath: row.fromPath,
  toPath: row.toPath,
  reason: row.reason,
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class RedirectsService {
  constructor(
    private readonly repo: RedirectsRepo,
    private readonly audit: AuditService,
    private readonly outbox: OutboxQueue,
  ) {}

  private async kick(key: string): Promise<void> {
    await this.outbox.kick(key).catch(() => undefined);
  }

  async list(query: { q?: string | undefined; cursor?: string | undefined; limit: number }) {
    const page = await this.repo.list(query);
    return { items: page.items.map(toRedirect), nextCursor: page.nextCursor };
  }

  /** Where a request for `path` ends up (up to 10 hops), so the editor can check a redirect. */
  async test(path: string) {
    return traceRedirect(path, await this.repo.allEdges());
  }

  private async write(
    actorId: string,
    request: FastifyRequest,
    id: string | undefined,
    input: RedirectInput,
  ) {
    const before = id === undefined ? undefined : await this.repo.find(id);
    if (id !== undefined && before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const result = await this.repo.write(id, input, actorId);
    if (result === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if (!result.ok) {
      // A path already used as a source is a conflict of paths; the other verdicts are integrity errors.
      const code =
        result.issue === "duplicate_source"
          ? ErrorCode.CONTENT_SLUG_TAKEN
          : ErrorCode.CONTENT_REDIRECT_INVALID;
      throw new AppError(code, { details: { reason: result.issue } });
    }
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: id === undefined ? "content.redirect.create" : "content.redirect.update",
        targetType: "slug_redirect",
        targetId: result.row.id,
        ...(before === undefined
          ? {}
          : {
              before: { fromPath: before.fromPath, toPath: before.toPath, reason: before.reason },
            }),
        after: {
          fromPath: result.row.fromPath,
          toPath: result.row.toPath,
          reason: result.row.reason,
          collapsed: result.repointed,
        },
      },
      { verbatim: true },
    );
    await this.kick(result.eventKey);
    return toRedirect(result.row);
  }

  create(actorId: string, request: FastifyRequest, input: RedirectInput) {
    return this.write(actorId, request, undefined, input);
  }

  update(actorId: string, request: FastifyRequest, id: string, input: RedirectInput) {
    return this.write(actorId, request, id, input);
  }

  async remove(actorId: string, request: FastifyRequest, id: string): Promise<void> {
    const removed = await this.repo.remove(id);
    if (removed === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.redirect.delete",
        targetType: "slug_redirect",
        targetId: id,
        before: {
          fromPath: removed.row.fromPath,
          toPath: removed.row.toPath,
          reason: removed.row.reason,
        },
      },
      { verbatim: true },
    );
    await this.kick(removed.eventKey);
  }
}
