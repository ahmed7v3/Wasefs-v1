import { Injectable } from "@nestjs/common";
import { isUniqueViolation, type ContentCategory, type ContentTag } from "@wasfa/db";
import { AppError, ErrorCode } from "@wasfa/shared/errors";

import { AuditService } from "../../audit/audit.service.js";
import { OutboxQueue } from "../../common/outbox-queue.js";

import {
  categoryDepthIssue,
  categoryInUse,
  isCompleteSiblingList,
  orderCategoryTree,
  type CategoryDepthIssue,
} from "./taxonomy-rules.js";
import { TaxonomyRepo, type CategoryRow, type TagRow } from "./taxonomy.repo.js";

import type { Category, CategoryInput, Tag, TagInput } from "@wasfa/shared/schemas/content";
import type { FastifyRequest } from "fastify";

const CATEGORY_SLUGS = {
  content_categories_slug_ar_key: "slugAr",
  content_categories_slug_en_key: "slugEn",
} as const;
const TAG_SLUGS = {
  content_tags_slug_ar_key: "slugAr",
  content_tags_slug_en_key: "slugEn",
} as const;

/** `CONTENT_SLUG_TAKEN` naming the field, when the unique violation is one of `constraints`. */
export function slugTakenError(
  error: unknown,
  constraints: Readonly<Record<string, string>>,
): AppError | undefined {
  for (const [constraint, field] of Object.entries(constraints)) {
    if (isUniqueViolation(error, constraint)) {
      return new AppError(ErrorCode.CONTENT_SLUG_TAKEN, { details: { fields: [field] } });
    }
  }
  return undefined;
}

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  parentId: row.parentId,
  slugAr: row.slugAr,
  slugEn: row.slugEn,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  descriptionAr: row.descriptionAr,
  descriptionEn: row.descriptionEn,
  requiresMedicalReview: row.requiresMedicalReview,
  defaultReviewerId: row.defaultReviewerId,
  seoTitleAr: row.seoTitleAr,
  seoDescriptionAr: row.seoDescriptionAr,
  seoTitleEn: row.seoTitleEn,
  seoDescriptionEn: row.seoDescriptionEn,
  sort: row.sort,
  itemCount: row.itemCount,
});

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  slugAr: row.slugAr,
  slugEn: row.slugEn,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  descriptionAr: row.descriptionAr,
  descriptionEn: row.descriptionEn,
  itemCount: row.itemCount,
});

/** Ids, slugs and flags only: names and descriptions are free text and stay out of the trail. */
const categoryAudit = (row: ContentCategory) => ({
  parentId: row.parentId,
  slugAr: row.slugAr,
  slugEn: row.slugEn,
  requiresMedicalReview: row.requiresMedicalReview,
  defaultReviewerId: row.defaultReviewerId,
  sort: row.sort,
});
const tagAudit = (row: Pick<ContentTag, "slugAr" | "slugEn">) => ({
  slugAr: row.slugAr,
  slugEn: row.slugEn,
});

const depthError = (issue: CategoryDepthIssue) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["parentId"], reason: issue } });

@Injectable()
export class TaxonomyService {
  constructor(
    private readonly repo: TaxonomyRepo,
    private readonly audit: AuditService,
    private readonly outbox: OutboxQueue,
  ) {}

  private async kick(key: string): Promise<void> {
    await this.outbox.kick(key).catch(() => undefined);
  }

  // ---- categories ----------------------------------------------------------------------------

  async listCategories(): Promise<{ items: Category[] }> {
    return { items: orderCategoryTree(await this.repo.listCategories()).map(toCategory) };
  }

  private async checkCategory(selfId: string | null, input: CategoryInput): Promise<void> {
    const parent =
      input.parentId === null ? null : ((await this.repo.findCategory(input.parentId)) ?? null);
    const issue = categoryDepthIssue({
      selfId,
      parentId: input.parentId,
      parent,
      selfChildCount: selfId === null ? 0 : await this.repo.childCount(selfId),
    });
    if (issue !== null) throw depthError(issue);
    if (
      input.defaultReviewerId !== null &&
      !(await this.repo.personExists(input.defaultReviewerId))
    ) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { fields: ["defaultReviewerId"] },
      });
    }
  }

  async createCategory(
    actorId: string,
    request: FastifyRequest,
    input: CategoryInput,
  ): Promise<Category> {
    await this.checkCategory(null, input);
    try {
      const { row, eventKey } = await this.repo.insertCategory(input);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.category.create",
          targetType: "content_category",
          targetId: row.id,
          after: categoryAudit(row),
        },
        { verbatim: true },
      );
      await this.kick(eventKey);
      return toCategory({ ...row, itemCount: 0 });
    } catch (error) {
      throw slugTakenError(error, CATEGORY_SLUGS) ?? error;
    }
  }

  async updateCategory(
    actorId: string,
    request: FastifyRequest,
    id: string,
    input: CategoryInput,
  ): Promise<Category> {
    const before = await this.repo.findCategory(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.checkCategory(id, input);
    try {
      const saved = await this.repo.updateCategory(id, input);
      if (saved === undefined) throw new AppError(ErrorCode.NOT_FOUND);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.category.update",
          targetType: "content_category",
          targetId: id,
          before: categoryAudit(before),
          after: categoryAudit(saved.row),
        },
        { verbatim: true },
      );
      await this.kick(saved.eventKey);
      return toCategory({ ...saved.row, itemCount: before.itemCount });
    } catch (error) {
      throw slugTakenError(error, CATEGORY_SLUGS) ?? error;
    }
  }

  async deleteCategory(actorId: string, request: FastifyRequest, id: string): Promise<void> {
    const before = await this.repo.findCategory(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const inUse = categoryInUse({
      itemCount: before.itemCount,
      childCount: await this.repo.childCount(id),
    });
    if (inUse !== null) throw new AppError(ErrorCode.CONTENT_IN_USE, { details: inUse });
    const eventKey = await this.repo.deleteCategory(id);
    if (eventKey === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.category.delete",
        targetType: "content_category",
        targetId: id,
        before: categoryAudit(before),
      },
      { verbatim: true },
    );
    await this.kick(eventKey);
  }

  async reorderCategories(
    actorId: string,
    request: FastifyRequest,
    parentId: string | null,
    ids: readonly string[],
  ): Promise<{ items: Category[] }> {
    if (!isCompleteSiblingList(await this.repo.siblingIds(parentId), ids)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["ids"] } });
    }
    const eventKey = await this.repo.reorderCategories(ids);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.category.reorder",
        targetType: "content_category",
        targetId: parentId,
        after: { parentId, ids: [...ids] },
      },
      { verbatim: true },
    );
    await this.kick(eventKey);
    return this.listCategories();
  }

  // ---- tags ----------------------------------------------------------------------------------

  async listTags(): Promise<{ items: Tag[] }> {
    return { items: (await this.repo.listTags()).map(toTag) };
  }

  async createTag(actorId: string, request: FastifyRequest, input: TagInput): Promise<Tag> {
    if (input.slugAr === null && input.slugEn === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { fields: ["slugAr", "slugEn"] },
      });
    }
    try {
      const { row, eventKey } = await this.repo.insertTag(input);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.tag.create",
          targetType: "content_tag",
          targetId: row.id,
          after: tagAudit(row),
        },
        { verbatim: true },
      );
      await this.kick(eventKey);
      return toTag({ ...row, itemCount: 0 });
    } catch (error) {
      throw slugTakenError(error, TAG_SLUGS) ?? error;
    }
  }

  async updateTag(
    actorId: string,
    request: FastifyRequest,
    id: string,
    input: TagInput,
  ): Promise<Tag> {
    const before = await this.repo.findTag(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if (input.slugAr === null && input.slugEn === null) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, {
        details: { fields: ["slugAr", "slugEn"] },
      });
    }
    try {
      const saved = await this.repo.updateTag(id, input, before, actorId);
      if (saved === undefined) throw new AppError(ErrorCode.NOT_FOUND);
      await this.audit.recordFor(
        request,
        {
          actorId,
          action: "content.tag.update",
          targetType: "content_tag",
          targetId: id,
          before: tagAudit(before),
          after: { ...tagAudit(saved.row), redirects: saved.moves.length },
        },
        { verbatim: true },
      );
      await this.kick(saved.eventKey);
      return toTag({ ...saved.row, itemCount: before.itemCount });
    } catch (error) {
      throw slugTakenError(error, TAG_SLUGS) ?? error;
    }
  }

  async deleteTag(actorId: string, request: FastifyRequest, id: string): Promise<void> {
    const before = await this.repo.findTag(id);
    if (before === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    if (before.itemCount > 0) {
      throw new AppError(ErrorCode.CONTENT_IN_USE, { details: { itemCount: before.itemCount } });
    }
    const eventKey = await this.repo.deleteTag(id);
    if (eventKey === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.tag.delete",
        targetType: "content_tag",
        targetId: id,
        before: tagAudit(before),
      },
      { verbatim: true },
    );
    await this.kick(eventKey);
  }

  async mergeTags(
    actorId: string,
    request: FastifyRequest,
    fromId: string,
    intoId: string,
  ): Promise<Tag> {
    if (fromId === intoId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields: ["intoId"] } });
    }
    const [from, into] = await Promise.all([this.repo.findTag(fromId), this.repo.findTag(intoId)]);
    if (from === undefined || into === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const result = await this.repo.mergeTags(from, into, actorId);
    await this.audit.recordFor(
      request,
      {
        actorId,
        action: "content.tag.merge",
        targetType: "content_tag",
        targetId: intoId,
        before: { fromId, ...tagAudit(from) },
        after: {
          intoId,
          repointed: result.repointed,
          dropped: result.dropped,
          redirects: result.moves.length,
        },
      },
      { verbatim: true },
    );
    await this.kick(result.eventKey);
    const merged = await this.repo.findTag(intoId);
    if (merged === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    return toTag(merged);
  }
}
