import { Inject, Injectable } from "@nestjs/common";
import { CONTENT_LIMITS } from "@wasfa/shared/content/constants";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../../audit/audit.service.js";
import { OutboxQueue } from "../../common/outbox-queue.js";

import {
  applyTagMode,
  bulkScheduleVerdict,
  distinctIds,
  scheduleSeriesTimes,
  shapeBulkResults,
  type BulkOutcome,
} from "./bulk-rules.js";
import { CONTENT_BULK_PORT, type ContentBulkPort } from "./bulk.port.js";
import { BulkRepo } from "./bulk.repo.js";

import type { AuthenticatedUser } from "../../common/current-user.js";
import type { BulkActionInput } from "@wasfa/shared/schemas/content";
import type { FastifyRequest } from "fastify";

const codeOf = (error: unknown): string => (error instanceof AppError ? error.code : "INTERNAL");

@Injectable()
export class BulkService {
  constructor(
    private readonly repo: BulkRepo,
    private readonly audit: AuditService,
    private readonly outbox: OutboxQueue,
    @Inject(CONTENT_BULK_PORT) private readonly port: ContentBulkPort,
  ) {}

  async run(actor: AuthenticatedUser, request: FastifyRequest, body: BulkActionInput) {
    const ids = distinctIds(body.ids);
    const found = new Set((await this.repo.items(ids)).map((row) => row.id));
    const outcomes = new Map<string, BulkOutcome>();
    const present = ids.filter((id) => found.has(id));

    switch (body.action) {
      case "set_category": {
        if (body.categoryId !== null && !(await this.repo.categoryExists(body.categoryId))) {
          throw new AppError(ErrorCode.NOT_FOUND, { details: { fields: ["categoryId"] } });
        }
        for (const id of await this.repo.setCategory(present, body.categoryId)) {
          outcomes.set(id, { ok: true });
        }
        break;
      }
      case "set_reviewer": {
        if (body.reviewerId !== null && !(await this.repo.reviewerEligible(body.reviewerId))) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["reviewerId"] } });
        }
        for (const id of await this.repo.setReviewer(present, body.reviewerId)) {
          outcomes.set(id, { ok: true });
        }
        break;
      }
      case "set_tags": {
        const wanted = distinctIds(body.tagIds);
        if ((await this.repo.existingTagIds(wanted)).size !== wanted.length) {
          throw new AppError(ErrorCode.NOT_FOUND, { details: { fields: ["tagIds"] } });
        }
        const current = await this.repo.tagIdsOf(present);
        const plans = new Map<string, string[]>();
        for (const id of present) {
          const next = applyTagMode(current.get(id) ?? [], body.mode, wanted);
          if (next.length > CONTENT_LIMITS.tagsPerItemMax) {
            outcomes.set(id, { ok: false, code: ErrorCode.VALIDATION_FAILED });
          } else {
            plans.set(id, next);
          }
        }
        for (const id of await this.repo.replaceTags(plans)) outcomes.set(id, { ok: true });
        break;
      }
      case "schedule_series": {
        const rows = new Map((await this.repo.items(present)).map((row) => [row.id, row]));
        const times = scheduleSeriesTimes(new Date(body.startAt), body.everyHours, present.length);
        let slot = 0;
        for (const id of present) {
          const row = rows.get(id);
          if (row === undefined) continue;
          const verdict = bulkScheduleVerdict(row);
          if (!verdict.ok) {
            outcomes.set(id, verdict);
            continue;
          }
          try {
            await this.port.schedule(id, times[slot++] ?? new Date(body.startAt), actor);
            outcomes.set(id, { ok: true });
          } catch (error) {
            outcomes.set(id, { ok: false, code: codeOf(error) });
          }
        }
        break;
      }
      case "unpublish":
      case "archive": {
        for (const id of present) {
          try {
            if (body.action === "unpublish") await this.port.unpublish(id, actor);
            else await this.port.archive(id, body.redirectTo, actor);
            outcomes.set(id, { ok: true });
          } catch (error) {
            outcomes.set(id, { ok: false, code: codeOf(error) });
          }
        }
        break;
      }
    }

    const results = shapeBulkResults(body.ids, outcomes);
    await this.audit.recordFor(
      request,
      {
        actorId: actor.id,
        action: "content.bulk",
        targetType: "content_item",
        after: {
          action: body.action,
          ids,
          succeeded: results.filter((result) => result.ok).length,
          failed: results.filter((result) => !result.ok).length,
        },
      },
      { verbatim: true },
    );
    // Item-level events were written in the repo transaction; one kick drains them.
    await this.outbox.kick(`content-bulk:${request.id}`).catch(() => undefined);
    return { results };
  }
}
