import { Injectable } from "@nestjs/common";
import { isUniqueViolation } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../../audit/audit.service.js";
import { OutboxQueue } from "../../common/outbox-queue.js";

import { PeopleRepo, type PersonRow } from "./people.repo.js";
import {
  personAuditView,
  personDeleteBlock,
  roleChangeBlock,
  userLinkIssue,
} from "./taxonomy-rules.js";

import type { Person, PersonInput } from "@wasfa/shared/schemas/content";
import type { FastifyRequest } from "fastify";

/** The licence number is returned to admins; it is never logged or audited (only that one exists). */
const toPerson = (row: PersonRow): Person => ({
  id: row.id,
  slug: row.slug,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  role: row.role,
  credentialsAr: row.credentialsAr,
  credentialsEn: row.credentialsEn,
  licenceNumber: row.licenceNumber,
  showLicence: row.showLicence,
  bioMdAr: row.bioMdAr,
  bioMdEn: row.bioMdEn,
  photoMediaId: row.photoMediaId,
  sameAs: row.sameAs,
  userId: row.userId,
  active: row.active,
  itemCount: row.itemCount,
});

@Injectable()
export class PeopleService {
  constructor(
    private readonly repo: PeopleRepo,
    private readonly audit: AuditService,
    private readonly outbox: OutboxQueue,
  ) {}

  private async kick(key: string): Promise<void> {
    await this.outbox.kick(key).catch(() => undefined);
  }

  async list(): Promise<{ items: Person[] }> {
    return { items: (await this.repo.list()).map(toPerson) };
  }

  private async checkUserLink(selfId: string | null, userId: string | null): Promise<void> {
    const issue = userLinkIssue({
      userId,
      userExists: userId === null ? false : await this.repo.userExists(userId),
      linkedPersonId: userId === null ? null : await this.repo.idForUser(userId),
      selfId,
    });
    if (issue === "user_missing") {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["userId"] } });
    }
    if (issue === "user_taken") {
      throw new AppError(ErrorCode.CONFLICT, { details: { fields: ["userId"], reason: issue } });
    }
  }

  private mapUnique(error: unknown): unknown {
    if (isUniqueViolation(error, "content_people_slug_key")) {
      return new AppError(ErrorCode.CONTENT_SLUG_TAKEN, { details: { fields: ["slug"] } });
    }
    if (isUniqueViolation(error, "content_people_user_id_key")) {
      return new AppError(ErrorCode.CONFLICT, {
        details: { fields: ["userId"], reason: "user_taken" },
      });
    }
    return error;
  }

  async create(actorId: string, request: FastifyRequest, input: PersonInput): Promise<Person> {
    await this.checkUserLink(null, input.userId);
    try {
      const { row, eventKey } = await this.repo.insert(input);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.person.create",
          targetType: "content_person",
          targetId: row.id,
          after: personAuditView(row),
        },
        { verbatim: true },
      );
      await this.kick(eventKey);
      return toPerson({ ...row, itemCount: 0 });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(
    actorId: string,
    request: FastifyRequest,
    id: string,
    input: PersonInput,
  ): Promise<Person> {
    const before = await this.repo.find(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.checkUserLink(id, input.userId);
    if (input.role !== before.role) {
      const block = roleChangeBlock(input.role, await this.repo.references(id));
      if (block !== null) throw new AppError(ErrorCode.CONTENT_IN_USE, { details: block });
    }
    try {
      const saved = await this.repo.update(id, input);
      if (saved === undefined) throw new AppError(ErrorCode.NOT_FOUND);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.person.update",
          targetType: "content_person",
          targetId: id,
          before: personAuditView(before),
          after: personAuditView(saved.row),
        },
        { verbatim: true },
      );
      await this.kick(saved.eventKey);
      return toPerson({ ...saved.row, itemCount: before.itemCount });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async remove(actorId: string, request: FastifyRequest, id: string): Promise<void> {
    const before = await this.repo.find(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const block = personDeleteBlock(await this.repo.references(id));
    if (block !== null) throw new AppError(ErrorCode.CONTENT_IN_USE, { details: block });
    const eventKey = await this.repo.remove(id);
    if (eventKey === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.person.delete",
        targetType: "content_person",
        targetId: id,
        before: personAuditView(before),
      },
      { verbatim: true },
    );
    await this.kick(eventKey);
  }
}
