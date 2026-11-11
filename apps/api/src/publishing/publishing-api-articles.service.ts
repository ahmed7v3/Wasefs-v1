import { Inject, Injectable } from "@nestjs/common";
import { type ContentItem } from "@wasfa/db";
import { contentPath, slugify, checkItemSlug } from "@wasfa/shared/content";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { normalizeArabic } from "@wasfa/shared/normalize";
import {
  tagInputSchema,
  type ContentItemDetail,
  type QualityGate,
} from "@wasfa/shared/schemas/content";
import {
  PUBLISHING_SCHEDULE_MAX_DAYS,
  PUBLISHING_SCHEDULE_MIN_MINUTES,
  titleIsArabic,
  type PublishingArticle,
  type PublishingDesiredStatus,
  type PublishingArticleInput,
  type PublishingArticlePatch,
  type PublishingListQuery,
  type publishingValidationSchema,
} from "@wasfa/shared/schemas/publishing";

import { decodeCursor } from "../admin/common/keyset.js";
import { AuditService } from "../audit/audit.service.js";
import { API_ENV } from "../config/config.module.js";
import { ContentRenderService } from "../content/content-render.service.js";
import { ContentItemsRepo } from "../content/items.repo.js";
import { ContentItemsService, type ContentActorCtx } from "../content/items.service.js";
import { PreviewTokenService } from "../content/preview-token.service.js";
import { PeopleService } from "../content/taxonomy/people.service.js";
import { TaxonomyService } from "../content/taxonomy/taxonomy.service.js";
import { ContentWorkflowService } from "../content/workflow.service.js";

import { apiActorFor, canPublishNow } from "./publishing-api-actor.js";
import { decidePlan, planOutcome, type PublishPlan } from "./publishing-api-decision.js";
import { forbidden, notFound, validationFailed } from "./publishing-api-errors.js";
import {
  assertSameIdentity,
  mapCreate,
  mapPatch,
  putAsPatch,
  type ResolvedRefs,
} from "./publishing-api-mapper.js";
import { describeGate, parseContentPath, qualityOf } from "./publishing-api-quality.js";
import { PublishingApiRepo } from "./publishing-api.repo.js";

import type { PublishingPrincipal } from "./publishing-principal.js";
import type { ApiEnv } from "../config/env.js";
import type { ContentStatus } from "@wasfa/shared/content/constants";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";

export type ValidationResult = z.output<typeof publishingValidationSchema>;

export interface WriteResult {
  status: 200 | 201;
  article: PublishingArticle;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const WRITE_RETRIES = 2;

/** API names for the editor's field paths, so an agent is told about `featured_media_id`, not `meta.featuredMediaId`. */
const FIELD_NAMES: Record<string, string> = {
  "meta.categoryId": "category",
  "meta.tagIds": "tags",
  "meta.primaryAuthorId": "author",
  "meta.reviewerId": "reviewer",
  "meta.featuredMediaId": "featured_media_id",
  "meta.seo.ogImageMediaId": "seo.og_media_id",
  "meta.slug": "slug",
  slug: "slug",
};
const FIELD_HINTS: Record<string, string> = {
  featured_media_id:
    "must be the id of media that is READY (poll GET /media/{id} until status is ready) and exists",
  slug: "this slug is not allowed for the type (reserved or badly formed)",
};

/** Maps the editor stack's validation errors onto the API's field names. */
export function translateContentError(error: unknown): unknown {
  if (!(error instanceof AppError) || error.code !== ErrorCode.VALIDATION_FAILED) return error;
  const raw = error.details?.fields;
  const single = error.details?.field;
  const paths = Array.isArray(raw) ? raw.map(String) : typeof single === "string" ? [single] : [];
  if (paths.length === 0) return error;
  const problems: Record<string, string> = {};
  for (const path of paths) {
    const name = FIELD_NAMES[path] ?? path;
    problems[name] = FIELD_HINTS[name] ?? "is not valid";
  }
  return validationFailed(problems);
}

const norm = (value: string): string => normalizeArabic(value.trim()).toLowerCase();

/** `If-Match: "3"`, `3` and `W/"3"` all mean revision 3; anything else is not a revision. */
export function parseIfMatch(header: string | undefined): number | null {
  if (header === undefined) return null;
  const match = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header);
  return match?.[1] === undefined ? null : Number(match[1]);
}

@Injectable()
export class PublishingApiArticlesService {
  constructor(
    private readonly items: ContentItemsService,
    private readonly repo: ContentItemsRepo,
    private readonly workflow: ContentWorkflowService,
    private readonly renderer: ContentRenderService,
    private readonly previews: PreviewTokenService,
    private readonly taxonomy: TaxonomyService,
    private readonly people: PeopleService,
    private readonly api: PublishingApiRepo,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // -------------------------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------------------------

  async get(principal: PublishingPrincipal, id: string): Promise<PublishingArticle> {
    const row = await this.readable(principal, id);
    return this.respond(principal, row.id, { created: false, notes: [] });
  }

  async list(principal: PublishingPrincipal, query: PublishingListQuery) {
    const [categories, people] = await Promise.all([
      this.taxonomy.listCategories(),
      this.people.list(),
    ]);
    let categoryId: string | undefined;
    if (query.category !== undefined) {
      const wanted = norm(query.category);
      categoryId = categories.items.find(
        (category) => norm(category.slugAr) === wanted || norm(category.slugEn ?? "") === wanted,
      )?.id;
      if (categoryId === undefined) {
        throw validationFailed({ category: "unknown category slug; GET /categories lists them" });
      }
    }
    const rows = await this.api.list(
      principal.keyId,
      query,
      categoryId,
      decodeCursor(query.cursor, "uuid"),
    );
    const page = PublishingApiRepo.page(rows, query.limit);
    const slugOf = new Map(people.items.map((person) => [person.id, person.slug]));
    return {
      items: page.items.map(({ item, revisionNumber, quality }) => {
        const gates = qualityGatesOf(quality);
        const live = item.publishedRevisionId !== null;
        return {
          id: item.id,
          external_id: item.externalId,
          type: item.type as PublishingArticle["type"],
          locale: item.locale,
          title: item.title,
          slug: item.slug,
          status: item.status,
          revision: revisionNumber,
          live,
          url: live ? this.publicUrl(item) : null,
          published_at: item.publishedAt?.toISOString() ?? null,
          updated_at: item.updatedAt.toISOString(),
          scheduled_at: item.scheduledAt?.toISOString() ?? null,
          reviewed_by:
            item.reviewedAt !== null && item.reviewerId !== null
              ? (slugOf.get(item.reviewerId) ?? null)
              : null,
          reviewed_at: item.reviewedAt?.toISOString() ?? null,
          quality: qualityOf(gates),
          word_count: item.wordCount,
          publish_on_approval: flagOf(item).publishOnApproval === true,
        };
      }),
      next_cursor: page.nextCursor,
    };
  }

  async revisions(principal: PublishingPrincipal, id: string) {
    await this.readable(principal, id);
    const rows = await this.items.listRevisions(id);
    return {
      items: rows.map((row) => ({
        number: row.number,
        kind: row.kind,
        created_at: row.createdAt,
        created_by: row.createdBy.type,
        is_approved: row.isApproved,
        is_published: row.isPublished,
      })),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------------------------

  /** `POST /articles`: always a new item. An `external_id` that already exists is refused (use PUT). */
  async create(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    input: PublishingArticleInput,
  ): Promise<WriteResult> {
    if (
      input.external_id !== undefined &&
      (await this.api.findByExternalId(principal.keyId, input.external_id)) !== undefined
    ) {
      throw new AppError(ErrorCode.CONFLICT, {
        details: {
          reason: "external_id_exists",
          hint: "use PUT /articles/by-external-id/{external_id}",
        },
      });
    }
    return this.createNew(principal, request, input);
  }

  /** `PUT /articles/by-external-id/{external_id}`: create or update, the same item every time. */
  async upsert(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    externalId: string,
    input: PublishingArticleInput,
    ifMatch: number | null,
  ): Promise<WriteResult> {
    if (input.external_id !== undefined && input.external_id !== externalId) {
      throw validationFailed({ external_id: "must match the external id in the URL" });
    }
    const existing = await this.api.findByExternalId(principal.keyId, externalId);
    if (existing === undefined) {
      return this.createNew(principal, request, { ...input, external_id: externalId });
    }
    assertSameIdentity(existing, input);
    const article = await this.apply(principal, request, existing.id, putAsPatch(input), ifMatch);
    return { status: 200, article };
  }

  async patch(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    patch: PublishingArticlePatch,
    ifMatch: number | null,
  ): Promise<PublishingArticle> {
    const row = await this.writable(principal, id);
    return this.apply(principal, request, row.id, patch, ifMatch);
  }

  /** Dry run: schema, mapping, render and gates exactly as a save would, nothing written. */
  async validate(
    principal: PublishingPrincipal,
    input: PublishingArticleInput,
  ): Promise<ValidationResult> {
    const existing =
      input.external_id === undefined
        ? undefined
        : await this.api.findByExternalId(principal.keyId, input.external_id);
    const { refs, notes: refNotes } = await this.resolveRefs(principal, null, input, {
      existingCategoryId: undefined,
      dryRun: true,
    });
    const mapped = mapCreate(input, refs, principal);
    const create = mapped.create;
    const slug = create.meta.slug ?? this.slugFromTitle(input);
    const slugTaken = await this.repo.slugTaken(input.type, input.locale, slug, existing?.id);
    const verdict = checkItemSlug(input.type, slug);

    const built = await this.renderer.build({
      itemId: existing?.id ?? null,
      translationGroupId: null,
      type: input.type,
      locale: input.locale,
      payload: create.payload,
      meta: {
        slug,
        categoryId: create.meta.categoryId,
        primaryAuthorId: create.meta.primaryAuthorId,
        reviewerId: create.meta.reviewerId,
        featuredMediaId: create.meta.featuredMediaId,
        seo: create.meta.seo,
        flags: create.meta.flags,
      },
      categoryRequiresReview: refs.categoryRequiresReview,
      approvedMatchesCurrent: false,
    });
    const quality = qualityOf(built.gates);
    if (slugTaken) {
      quality.blocking.push({
        code: "slug_taken",
        message:
          "Another item of this type and locale already uses this slug: choose a different slug.",
      });
    }
    if (verdict !== "ok") {
      quality.blocking.push({
        code: "slug_invalid",
        message: `The slug is not allowed for this type (${verdict}).`,
      });
    }
    const plan = decidePlan({
      desired: input.desired_status,
      canPublish: canPublishNow(principal),
      requiresReview: mapped.requiresReview,
      status: "draft",
      publishOnApproval: input.publish_on_approval,
      gates: built.gates,
    });
    return {
      valid: quality.blocking.length === 0,
      quality,
      word_count: built.derived.wordCount,
      html_preview: built.derived.bodyHtml,
      resolved: {
        slug,
        requires_medical_review: mapped.requiresReview,
        would_become: planOutcome(plan),
        notes: [...refNotes, ...mapped.notes, ...plan.notes],
      },
    };
  }

  async submit(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    ifMatch: number | null,
  ): Promise<PublishingArticle> {
    const row = await this.writable(principal, id);
    await this.assertRevision(row, ifMatch);
    return this.finalize(principal, request, row.id, { desired: "in_review" }, []);
  }

  async publish(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    body: { publish_on_approval?: boolean | undefined },
    ifMatch: number | null,
  ): Promise<PublishingArticle> {
    const row = await this.writable(principal, id);
    await this.assertRevision(row, ifMatch);
    return this.finalize(
      principal,
      request,
      row.id,
      { desired: "published", publishOnApproval: body.publish_on_approval },
      [],
    );
  }

  async schedule(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    scheduledAt: string,
    ifMatch: number | null,
  ): Promise<PublishingArticle> {
    assertScheduleWindow(new Date(scheduledAt), new Date());
    const row = await this.writable(principal, id);
    await this.assertRevision(row, ifMatch);
    return this.finalize(principal, request, row.id, { desired: "scheduled", scheduledAt }, []);
  }

  /** Takes a live item down (or cancels a schedule): back to draft, the URL answers 404 again. */
  async unpublish(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
  ): Promise<PublishingArticle> {
    const row = await this.writable(principal, id);
    if (!canPublishNow(principal)) throw forbidden("key_cannot_publish");
    const actor = apiActorFor(principal);
    const action =
      row.status === "scheduled" && row.publishedRevisionId === null ? "unschedule" : "unpublish";
    const outcome = await this.workflow.act(row.id, action, {}, actor);
    await this.record(
      request,
      principal,
      `content.item.${action === "unschedule" ? "unscheduled" : "unpublished"}`,
      row.id,
      {
        from: outcome.from,
        to: outcome.to,
      },
    );
    return this.respond(principal, row.id, { created: false, notes: [] });
  }

  /** Never-public drafts are deleted; anything else is archived (410, or 301 with `redirect_to`). */
  async remove(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    redirectTo: string | undefined,
  ): Promise<{ id: string; result: "deleted" | "archived" }> {
    const row = await this.writable(principal, id);
    const neverPublic = row.firstPublishedAt === null && row.publishedRevisionId === null;
    if (neverPublic && row.status === "draft") {
      const now = new Date();
      await this.repo.transaction(async (data) => {
        const locked = await data.lockItem(row.id);
        if (!locked) throw notFound();
        if (locked.status !== "draft" || locked.firstPublishedAt !== null) {
          throw new AppError(ErrorCode.CONTENT_CONFLICT);
        }
        return data.purge({ itemId: row.id, now });
      });
      await this.record(request, principal, "content.item.purged", row.id, { was_live: false });
      return { id: row.id, result: "deleted" };
    }
    // Taking something public down (or out of the review queue) is a publishing decision.
    if (!canPublishNow(principal) && !neverPublic) throw forbidden("key_cannot_publish");
    const actor = apiActorFor(principal, ["content.manage"]);
    const outcome = await this.workflow.act(
      row.id,
      "archive",
      redirectTo === undefined ? {} : { redirectTo },
      actor,
    );
    await this.record(request, principal, "content.item.archived", row.id, {
      from: outcome.from,
      redirect: redirectTo !== undefined,
    });
    return { id: row.id, result: "archived" };
  }

  // -------------------------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------------------------

  private async createNew(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    input: PublishingArticleInput,
  ): Promise<WriteResult> {
    const { refs, notes: refNotes } = await this.resolveRefs(principal, request, input, {
      existingCategoryId: undefined,
      dryRun: false,
    });
    const mapped = mapCreate(input, refs, principal);
    const actor = apiActorFor(principal);
    let detail: ContentItemDetail;
    try {
      detail = await this.items.create(
        actor,
        mapped.create,
        input.external_id === undefined ? {} : { externalId: input.external_id },
      );
    } catch (error) {
      throw translateContentError(error);
    }
    await this.record(request, principal, "content.item.created", detail.id, {
      type: detail.type,
      locale: detail.locale,
    });
    const article = await this.finalize(
      principal,
      request,
      detail.id,
      {
        desired: input.desired_status,
        scheduledAt: input.scheduled_at,
        publishOnApproval: input.publish_on_approval,
      },
      [...refNotes, ...mapped.notes],
      true,
    );
    return { status: 201, article };
  }

  /** Update path shared by PUT (existing item) and PATCH. */
  private async apply(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    patch: PublishingArticlePatch,
    ifMatch: number | null,
  ): Promise<PublishingArticle> {
    const actor = apiActorFor(principal);
    let attempt = 0;
    for (;;) {
      const row = await this.writable(principal, id);
      if (row.status === "archived") throw new AppError(ErrorCode.CONTENT_ILLEGAL_TRANSITION);
      await this.assertRevision(row, ifMatch);
      if (patch.slug !== undefined && patch.slug !== row.slug && row.firstPublishedAt !== null) {
        // Moving a public URL is a human decision (redirects, links, rankings).
        throw forbidden("slug_locked_after_publish");
      }
      const current = row.currentRevisionId
        ? await this.repo.findRevision(row.id, row.currentRevisionId)
        : undefined;
      if (!current) throw notFound();
      const { refs, notes: refNotes } = await this.resolveRefs(principal, request, patch, {
        existingCategoryId: row.categoryId,
        dryRun: false,
      });
      const mapped = mapPatch(patch, refs, principal, {
        type: row.type,
        bodyMd: current.bodyMd,
        categorySlug:
          refs.categorySlug === undefined
            ? await this.categorySlugOf(row.categoryId, principal)
            : refs.categorySlug,
      });
      try {
        if (mapped.payload !== undefined || mapped.meta !== undefined) {
          await this.items.update(actor, row.id, {
            lockVersion: row.lockVersion,
            ...(mapped.payload === undefined ? {} : { payload: mapped.payload }),
            ...(mapped.meta === undefined ? {} : { meta: mapped.meta }),
            note: "api",
          });
        }
      } catch (error) {
        // Someone saved in between. Without If-Match the write simply lands on top of theirs (history keeps both).
        if (
          ifMatch === null &&
          error instanceof AppError &&
          error.code === ErrorCode.CONTENT_CONFLICT &&
          attempt < WRITE_RETRIES
        ) {
          attempt += 1;
          continue;
        }
        throw translateContentError(error);
      }
      await this.record(request, principal, "content.item.updated", row.id, {
        payload_changed: mapped.payload !== undefined,
        meta_changed: mapped.meta !== undefined,
      });
      return this.finalize(
        principal,
        request,
        row.id,
        {
          desired: patch.desired_status ?? "draft",
          scheduledAt: patch.scheduled_at,
          publishOnApproval: patch.publish_on_approval,
        },
        [...refNotes, ...mapped.notes],
      );
    }
  }

  /**
   * Applies `desired_status` through the workflow (docs/PUBLISHING-API.md §8): `decidePlan` picks the
   * action from the key's rights, the category's review rule and the gates; `ContentWorkflowService`
   * performs it under the item lock with the key as a never-owner actor, so review, four-eyes, gates
   * and the per-key and global caps are all enforced there.
   */
  private async finalize(
    principal: PublishingPrincipal,
    request: FastifyRequest,
    id: string,
    want: {
      desired: PublishingDesiredStatus;
      scheduledAt?: string | undefined;
      publishOnApproval?: boolean | undefined;
    },
    baseNotes: string[],
    created = false,
  ): Promise<PublishingArticle> {
    const actor = apiActorFor(principal);
    const detail = await this.items.get(id, actor);
    const plan = decidePlan({
      desired: want.desired,
      canPublish: canPublishNow(principal),
      requiresReview: detail.requiresReview,
      status: detail.status,
      publishOnApproval: want.publishOnApproval,
      gates: detail.gates,
    });
    if (plan.kind === "refuse") throw await this.refusal(principal, detail, plan);

    await this.syncAutoPublishFlag(principal, actor, detail, plan);
    const outcome = await this.run(actor, id, plan, want.scheduledAt, detail);
    if (outcome !== null) {
      await this.record(request, principal, `content.item.${outcome.verb}`, id, {
        from: outcome.from,
        to: outcome.to,
      });
    }
    return this.respond(principal, id, { created, notes: [...baseNotes, ...plan.notes] });
  }

  private async run(
    actor: ContentActorCtx,
    id: string,
    plan: PublishPlan,
    scheduledAt: string | undefined,
    detail: ContentItemDetail,
  ): Promise<{ from: ContentStatus; to: ContentStatus; verb: string } | null> {
    try {
      switch (plan.kind) {
        case "submit": {
          const done = await this.workflow.act(id, "submit", {}, actor);
          return { ...done, verb: "submitted" };
        }
        case "publish": {
          const done = await this.workflow.act(id, "publish", {}, actor);
          return { ...done, verb: "published" };
        }
        case "schedule": {
          if (scheduledAt === undefined) {
            throw validationFailed({ scheduled_at: "required to schedule" });
          }
          assertScheduleWindow(new Date(scheduledAt), new Date());
          const done = await this.workflow.act(id, "schedule", { at: scheduledAt }, actor);
          return { ...done, verb: "scheduled" };
        }
        default:
          return null;
      }
    } catch (error) {
      // The gates were checked fresh under the lock and something changed since the plan: same answer as a refusal.
      if (error instanceof AppError && error.code === ErrorCode.CONTENT_GATES_BLOCK) {
        const ids = Array.isArray(error.details?.gates) ? error.details.gates.map(String) : [];
        throw this.gatesError(detail, ids);
      }
      throw error;
    }
  }

  /** Keeps `flags.publishOnApproval` in step with the latest plan (a later write cancels an earlier request). */
  private async syncAutoPublishFlag(
    principal: PublishingPrincipal,
    actor: ContentActorCtx,
    detail: ContentItemDetail,
    plan: PublishPlan,
  ): Promise<void> {
    const wanted =
      plan.kind === "submit" || plan.kind === "none" ? plan.publishOnApproval === true : false;
    if ((detail.meta.flags.publishOnApproval === true) === wanted) return;
    await this.items.update(actor, detail.id, {
      lockVersion: detail.lockVersion,
      meta: {
        flags: {
          publishOnApproval: wanted,
          publishOnApprovalCap: wanted ? principal.dailyPublishCap : null,
        },
      },
    });
  }

  private async refusal(
    principal: PublishingPrincipal,
    detail: ContentItemDetail,
    plan: Extract<PublishPlan, { kind: "refuse" }>,
  ): Promise<AppError> {
    if (plan.blocking.includes("duplicate_content")) {
      const duplicate = await this.duplicateError(principal, detail, plan.blocking);
      if (duplicate !== null) return duplicate;
    }
    return this.gatesError(detail, plan.blocking);
  }

  private gatesError(detail: ContentItemDetail, ids: string[]): AppError {
    const issues = detail.gates.filter((gate) => ids.includes(gate.id)).map(describeGate);
    return new AppError(ErrorCode.CONTENT_GATES_BLOCK, {
      details: {
        blocking: ids,
        messages: issues.map((issue) => `${issue.code}: ${issue.message}`),
        item_id: detail.id,
        status: detail.status,
        revision: detail.currentRevision.number,
        saved: true,
      },
    });
  }

  /** A near-duplicate of another page: 409 with the matching item, not a generic gate failure. */
  private async duplicateError(
    principal: PublishingPrincipal,
    detail: ContentItemDetail,
    ids: string[],
  ): Promise<AppError | null> {
    const gate = detail.gates.find((entry) => entry.id === "duplicate_content");
    const path = typeof gate?.params.matchPath === "string" ? gate.params.matchPath : null;
    const parsed = path === null ? null : parseContentPath(path);
    const match =
      parsed === null
        ? undefined
        : await this.api.findBySlug(parsed.type, parsed.locale, parsed.slug);
    if (!match) return null;
    const own = match.apiKeyId === principal.keyId;
    return new AppError(ErrorCode.CONFLICT, {
      details: {
        code: "DUPLICATE_CONTENT",
        item_id: detail.id,
        matching_item_id: match.id,
        matching_url: this.publicUrl(match),
        ...(own && match.externalId !== null
          ? {
              matching_external_id: match.externalId,
              hint: "this key already wrote it: update it with PUT /articles/by-external-id/{matching_external_id}",
            }
          : {}),
        blocking: ids,
        saved: true,
      },
    });
  }

  private async respond(
    principal: PublishingPrincipal,
    id: string,
    extra: { created: boolean; notes: string[] },
  ): Promise<PublishingArticle> {
    const actor = apiActorFor(principal);
    const [detail, row] = await Promise.all([this.items.get(id, actor), this.repo.findItem(id)]);
    if (!row) throw notFound();
    const notes = [...extra.notes];
    if (detail.live && detail.status !== "published") {
      notes.push(
        "The previous version is still live; this new revision is not public until it is published.",
      );
    }
    return {
      id: detail.id,
      external_id: row.externalId,
      type: detail.type as PublishingArticle["type"],
      locale: detail.locale,
      title: detail.title,
      slug: detail.slug,
      status: detail.status,
      revision: detail.currentRevision.number,
      live: detail.live,
      url: detail.live ? this.publicUrl(row) : null,
      preview_url: await this.previewUrl(id),
      published_at: detail.publishedAt,
      updated_at: detail.updatedAt,
      scheduled_at: detail.scheduledAt,
      reviewed_by: row.reviewedAt !== null ? (detail.reviewer?.slug ?? null) : null,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      quality: qualityOf(detail.gates),
      word_count: detail.wordCount,
      publish_on_approval: detail.meta.flags.publishOnApproval === true,
      notes,
      created: extra.created,
    };
  }

  private publicUrl(item: Pick<ContentItem, "type" | "locale" | "slug">): string {
    return `${this.env.WEB_ORIGIN[0] ?? ""}${contentPath(item.type, item.locale, item.slug)}`;
  }

  private async previewUrl(id: string): Promise<string | null> {
    try {
      return (await this.previews.create(id)).url;
    } catch (error) {
      // Previews are off without CONTENT_PREVIEW_SECRET: the article is still fine.
      if (error instanceof AppError && error.code === ErrorCode.NOT_FOUND) return null;
      throw error;
    }
  }

  private slugFromTitle(input: PublishingArticleInput): string {
    if (titleIsArabic(input.title)) {
      throw validationFailed({ slug: "an English slug is required for Arabic titles" });
    }
    return slugify(input.title);
  }

  // ---- access ------------------------------------------------------------------------------

  /** Items of this key, and anything the public can read. A page (or an unknown id) is simply not found. */
  private async readable(principal: PublishingPrincipal, id: string): Promise<ContentItem> {
    const row = UUID.test(id) ? await this.repo.findItem(id) : undefined;
    if (!row || row.type === "page") throw notFound();
    if (row.apiKeyId !== principal.keyId && row.publishedRevisionId === null) throw notFound();
    return row;
  }

  /** Writes touch only items this key created: an editor's article is out of reach (and invisible). */
  private async writable(principal: PublishingPrincipal, id: string): Promise<ContentItem> {
    const row = UUID.test(id) ? await this.repo.findItem(id) : undefined;
    if (!row || row.type === "page" || row.apiKeyId !== principal.keyId) throw notFound();
    return row;
  }

  private async assertRevision(row: ContentItem, ifMatch: number | null): Promise<void> {
    if (ifMatch === null || !row.currentRevisionId) return;
    const current = await this.repo.findRevision(row.id, row.currentRevisionId);
    if (current?.number !== ifMatch) {
      throw new AppError(ErrorCode.CONTENT_CONFLICT, {
        httpStatus: 412,
        details: { current_revision: current?.number ?? 0 },
      });
    }
  }

  private async categorySlugOf(
    categoryId: string | null,
    principal: Pick<PublishingPrincipal, "allowedCategorySlugs">,
  ): Promise<string | null> {
    if (categoryId === null) return null;
    const category = (await this.taxonomy.listCategories()).items.find(
      (entry) => entry.id === categoryId,
    );
    return category === undefined ? null : pickSlug(category, principal.allowedCategorySlugs);
  }

  // ---- reference resolution ------------------------------------------------------------------

  private async resolveRefs(
    principal: PublishingPrincipal,
    request: FastifyRequest | null,
    input: {
      category?: string | null | undefined;
      tags?: string[] | undefined;
      author?: string | null | undefined;
      reviewer?: string | null | undefined;
      translation_of?: string | undefined;
    },
    context: { existingCategoryId: string | null | undefined; dryRun: boolean },
  ): Promise<{ refs: ResolvedRefs; notes: string[] }> {
    const notes: string[] = [];
    const problems: Record<string, string> = {};
    const [categories, people] = await Promise.all([
      this.taxonomy.listCategories(),
      this.people.list(),
    ]);
    const refs: ResolvedRefs = { categoryRequiresReview: null };

    // category
    const existing = categories.items.find((entry) => entry.id === context.existingCategoryId);
    if (input.category === undefined) {
      refs.categoryRequiresReview = existing?.requiresMedicalReview ?? null;
    } else if (input.category === null) {
      refs.categoryId = null;
      refs.categorySlug = null;
    } else {
      const wanted = norm(input.category);
      const found = categories.items.find(
        (entry) => norm(entry.slugAr) === wanted || norm(entry.slugEn ?? "") === wanted,
      );
      if (found === undefined) {
        problems.category = "unknown category slug; GET /categories lists the valid ones";
      } else {
        refs.categoryId = found.id;
        refs.categorySlug = pickSlug(found, principal.allowedCategorySlugs);
        refs.categoryRequiresReview = found.requiresMedicalReview;
      }
    }

    // people
    const personRef = (value: string, field: "author" | "reviewer"): string | undefined => {
      const wanted = norm(value);
      const person = people.items.find((entry) => entry.active && norm(entry.slug) === wanted);
      const roleOk =
        person !== undefined &&
        (person.role === "both" || person.role === (field === "author" ? "author" : "reviewer"));
      if (person === undefined || !roleOk) {
        problems[field] = `unknown ${field} slug; GET /people lists the valid ones`;
        return undefined;
      }
      return person.id;
    };
    if (input.author === null) refs.authorId = null;
    else if (input.author !== undefined) {
      const id = personRef(input.author, "author");
      if (id !== undefined) refs.authorId = id;
    }
    if (input.reviewer === null) refs.reviewerId = null;
    else if (input.reviewer !== undefined) {
      const id = personRef(input.reviewer, "reviewer");
      if (id !== undefined) refs.reviewerId = id;
    }

    // tags
    if (input.tags !== undefined) {
      const tags = (await this.taxonomy.listTags()).items;
      const ids = new Set<string>();
      const unknown: string[] = [];
      for (const name of input.tags) {
        const wanted = norm(name);
        const found = tags.find((tag) =>
          [tag.slugAr, tag.slugEn, tag.nameAr, tag.nameEn].some(
            (candidate) => candidate !== null && norm(candidate) === wanted,
          ),
        );
        if (found) ids.add(found.id);
        else unknown.push(name);
      }
      if (unknown.length > 0) {
        if (!principal.scopes.includes("taxonomy:write")) {
          problems.tags = `unknown tags: ${unknown.join(", ").slice(0, 200)}. Use existing tags (GET /tags) or create them with POST /tags (needs the taxonomy:write scope).`;
        } else if (context.dryRun || request === null) {
          notes.push(
            `These tags do not exist yet and will be created: ${unknown.join(", ").slice(0, 200)}.`,
          );
        } else {
          for (const name of unknown) {
            const slug = slugify(name);
            if (slug === "") {
              problems.tags =
                "a new tag needs a name that can form a slug; create it with POST /tags";
              break;
            }
            const created = await this.taxonomy.createTag(
              principal.ownerUserId,
              request,
              tagInputSchema.parse(
                titleIsArabic(name)
                  ? { nameAr: name, slugAr: slug }
                  : { nameAr: name, nameEn: name, slugEn: slug },
              ),
            );
            ids.add(created.id);
            notes.push(`Created tag "${name.slice(0, 60)}".`);
          }
        }
      }
      refs.tagIds = [...ids];
    }

    // translation_of: an item id or one of this key's external ids
    if (input.translation_of !== undefined) {
      const source = UUID.test(input.translation_of)
        ? await this.repo.findItem(input.translation_of)
        : await this.api.findByExternalId(principal.keyId, input.translation_of);
      const visible =
        source !== undefined &&
        source.type !== "page" &&
        (source.apiKeyId === principal.keyId || source.publishedRevisionId !== null);
      if (!visible)
        problems.translation_of = "no such article (use its id, or an external_id of this key)";
      else refs.translationOfId = source.id;
    }

    if (Object.keys(problems).length > 0) throw validationFailed(problems);
    return { refs, notes };
  }

  // ---- audit -------------------------------------------------------------------------------

  /** Audit row of an API write: the actor is the key (`api_key:<id>`), recorded with the owner who issued it. */
  private record(
    request: FastifyRequest,
    principal: PublishingPrincipal,
    action: string,
    targetId: string,
    after: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    return this.audit.recordFor(
      request,
      {
        actorId: null,
        action,
        targetType: "content_item",
        targetId,
        after: {
          actor: `api_key:${principal.keyId}`,
          key_name: principal.keyName,
          owner_user_id: principal.ownerUserId,
          source: "api",
          ...after,
        },
      },
      { verbatim: true },
    );
  }
}

function flagOf(item: ContentItem): { publishOnApproval?: boolean } {
  const flags = item.flags as { publishOnApproval?: unknown };
  return { publishOnApproval: flags.publishOnApproval === true };
}

function qualityGatesOf(raw: unknown): QualityGate[] {
  return Array.isArray(raw) ? (raw as QualityGate[]) : [];
}

/** The slug of `category` the key's allow-list knows (either site's), else the Arabic-site one. */
function pickSlug(
  category: { slugAr: string; slugEn: string | null },
  allowed: readonly string[],
): string {
  if (category.slugEn !== null && allowed.includes(category.slugEn)) return category.slugEn;
  return category.slugAr;
}

/** `scheduled_at` must be 5 minutes to 365 days ahead (docs/PUBLISHING-API.md §4.5). */
export function assertScheduleWindow(at: Date, now: Date): void {
  const ms = at.getTime() - now.getTime();
  if (ms < PUBLISHING_SCHEDULE_MIN_MINUTES * MINUTE_MS) {
    throw validationFailed({
      scheduled_at: `must be at least ${String(PUBLISHING_SCHEDULE_MIN_MINUTES)} minutes in the future`,
    });
  }
  if (ms > PUBLISHING_SCHEDULE_MAX_DAYS * DAY_MS) {
    throw validationFailed({
      scheduled_at: `must be at most ${String(PUBLISHING_SCHEDULE_MAX_DAYS)} days ahead`,
    });
  }
}
