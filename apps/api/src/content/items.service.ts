import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { isUniqueViolation, type ContentItem, type ContentRevision } from "@wasfa/db";
import {
  allowedActions,
  contentPath,
  diffStats,
  checkItemSlug,
  diffWords,
  gateIssueCounts,
  hasBlockingIssues,
  requiresMedicalReview,
  slugify,
  statusAfterNewRevision,
  type WorkflowActor,
  type WorkflowItem,
} from "@wasfa/shared/content";
import { CONTENT_SLUG_MAX, type ContentType } from "@wasfa/shared/content/constants";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { PERMISSION_KEYS } from "@wasfa/shared/permissions";
import {
  contentFlagsSchema,
  contentPayloadSchema,
  contentSeoSchema,
  qualityGateSchema,
  type ContentItemDetail,
  type ContentItemSummary,
  type ContentListQuery,
  type ContentListResponse,
  type ContentFlags,
  type ContentMeta,
  type ContentSeo,
  type ContentMetaPatch,
  type ContentPayload,
  type CreateContentItemInput,
  type QualityGate,
  type RevisionDetail,
  type RevisionSummary,
  type UpdateContentItemInput,
  type AutosaveContentInput,
} from "@wasfa/shared/schemas/content";

import { decodeCursor } from "../admin/common/keyset.js";
import { OutboxQueue } from "../common/outbox-queue.js";
import { SettingsService } from "../settings/settings.service.js";

import {
  ContentRenderService,
  type BuiltRevision,
  type RenderSubject,
} from "./content-render.service.js";
import { ContentItemsRepo, pageOf, type ContentData, type ItemListRow } from "./items.repo.js";

import type { AuthenticatedUser } from "../common/current-user.js";

/** The caller as the workflow sees them, plus the name stamped on revisions and the publish log. */
export interface ContentActorCtx extends WorkflowActor {
  name: string;
}

export const LIST_PAGE_SIZE_DEFAULT = 25;

/** Refuses a slug that is badly formed for the type or reserved (pages); details carry only the reason. */
function assertSlugAllowed(type: ContentType, slug: string): void {
  const verdict = checkItemSlug(type, slug);
  if (verdict !== "ok") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, {
      details: { field: "slug", reason: verdict },
    });
  }
}

/** First of `base`, `base-2`, `base-3`... that is not in `taken`; stays within the slug length limit. */
export function pickFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const stem = base.slice(0, CONTENT_SLUG_MAX - suffix.length).replace(/-+$/, "");
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function compact<T extends object>(value: T | undefined): Partial<T> {
  if (value === undefined) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

type GateMeta = RenderSubject["meta"];

export function metaOf(item: ContentItem): GateMeta {
  return {
    slug: item.slug,
    categoryId: item.categoryId,
    primaryAuthorId: item.primaryAuthorId,
    reviewerId: item.reviewerId,
    featuredMediaId: item.featuredMediaId,
    seo: contentSeoSchema.parse(item.seo),
    flags: contentFlagsSchema.parse(item.flags),
  };
}

function mergeMeta(base: GateMeta, patch: ContentMetaPatch | undefined): GateMeta {
  return {
    slug: patch?.slug ?? base.slug,
    categoryId: patch?.categoryId !== undefined ? patch.categoryId : base.categoryId,
    primaryAuthorId:
      patch?.primaryAuthorId !== undefined ? patch.primaryAuthorId : base.primaryAuthorId,
    reviewerId: patch?.reviewerId !== undefined ? patch.reviewerId : base.reviewerId,
    featuredMediaId:
      patch?.featuredMediaId !== undefined ? patch.featuredMediaId : base.featuredMediaId,
    seo: { ...base.seo, ...(compact(patch?.seo) as Partial<ContentSeo>) },
    flags: { ...base.flags, ...(compact(patch?.flags) as Partial<ContentFlags>) },
  };
}

function parseGates(raw: unknown): QualityGate[] | null {
  const parsed = qualityGateSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function toSummary(row: ItemListRow, now: Date): ContentItemSummary {
  const live = row.publishedRevisionId !== null;
  const gates = parseGates(row.quality) ?? [];
  return {
    id: row.id,
    type: row.type,
    locale: row.locale,
    slug: row.slug,
    status: row.status,
    live,
    title: row.title,
    category: row.categoryId === null ? null : { id: row.categoryId, name: row.categoryName ?? "" },
    author:
      row.authorId === null
        ? null
        : { id: row.authorId, name: row.authorName ?? "", slug: row.authorSlug ?? "" },
    reviewer:
      row.reviewerId === null
        ? null
        : { id: row.reviewerId, name: row.reviewerName ?? "", slug: row.reviewerSlug ?? "" },
    source: row.source,
    // API keys arrive with WP4; the id is never exposed, only the key's name.
    apiKeyName: null,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    wordCount: row.wordCount,
    requiresReview: requiresMedicalReview({
      type: row.type,
      categoryRequiresReview: row.categoryRequiresReview,
    }),
    issues: gateIssueCounts(gates),
    reviewOverdue:
      live && row.nextReviewDue !== null && row.nextReviewDue.getTime() < now.getTime(),
  };
}

export interface AppendRevisionArgs {
  item: ContentItem;
  payload: ContentPayload;
  previousBodyMd: string;
  built: BuiltRevision;
  kind: ContentRevision["kind"];
  note: string | null;
  actor: { userId: string; name: string };
  now: Date;
  /** Write a publish-log row for the status change a new revision causes (not for approve-with-edits). */
  logStatusChange: boolean;
}

/**
 * Appends a revision to a LOCKED item and everything that follows from it: the status falls back to
 * `draft` (the live pointer stays), the item mirrors the new title/counts/search text, links, entities
 * and media references are replaced, this user's autosave is dropped. Returns the item columns the
 * caller must write (it adds `lockVersion`, `updatedAt` and any meta in the same UPDATE).
 */
export async function appendRevision(
  data: ContentData,
  args: AppendRevisionArgs,
): Promise<{ revision: ContentRevision; patch: Partial<ContentItem> }> {
  const { item, payload, built } = args;
  const number = await data.nextRevisionNumber(item.id);
  const revision = await data.insertRevision(
    {
      itemId: item.id,
      number,
      kind: args.kind,
      title: payload.title,
      excerpt: payload.excerpt,
      definition: payload.definition,
      bodyMd: payload.bodyMd,
      bodyHtml: built.derived.bodyHtml,
      toc: built.derived.toc,
      wordCount: built.derived.wordCount,
      readingMinutes: built.derived.readingMinutes,
      minhash: built.derived.minhash,
      quality: built.derived.quality,
      note: args.note,
      createdByUserId: args.actor.userId,
      createdByName: args.actor.name,
      diffStats: diffStats(diffWords(args.previousBodyMd, payload.bodyMd)),
      parentRevisionId: item.currentRevisionId,
    },
    args.now,
  );
  const next = statusAfterNewRevision({
    status: item.status,
    live: item.publishedRevisionId !== null,
  });
  await data.replaceLinks(item.id, built.links);
  await data.replaceEntities(item.id, built.entities);
  await data.replaceMediaRefs(item.id, ["featured", "body", "og"], built.mediaRefs);
  await data.deleteAutosave(item.id, args.actor.userId);
  if (args.logStatusChange && next.status !== item.status) {
    await data.insertPublishLog({
      itemId: item.id,
      revisionId: revision.id,
      fromStatus: item.status,
      toStatus: next.status,
      actorType: "user",
      actorId: args.actor.userId,
      actorName: args.actor.name,
      reason: "revised",
      at: args.now,
    });
  }
  return {
    revision,
    patch: {
      title: payload.title,
      wordCount: built.derived.wordCount,
      searchText: built.searchText,
      currentRevisionId: revision.id,
      status: next.status,
      ...(next.clearScheduledAt ? { scheduledAt: null } : {}),
    },
  };
}

/** After a commit: wake the worker so `content.changed` is drained now. Best effort, the periodic drain is the backstop. */
export async function kickOutbox(queue: OutboxQueue, key: string): Promise<void> {
  try {
    await queue.kick(key);
  } catch {
    // The row is committed; the worker's scheduled drain will pick it up.
  }
}

function conflict(
  item: Pick<ContentItem, "lockVersion" | "currentRevisionId"> | undefined,
): AppError {
  return new AppError(ErrorCode.CONTENT_CONFLICT, {
    details: {
      currentLockVersion: item?.lockVersion ?? 0,
      currentRevisionId: item?.currentRevisionId ?? null,
    },
  });
}

const invalid = (...fields: string[]) =>
  new AppError(ErrorCode.VALIDATION_FAILED, { details: { fields } });

@Injectable()
export class ContentItemsService {
  constructor(
    private readonly repo: ContentItemsRepo,
    private readonly render: ContentRenderService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxQueue,
  ) {}

  /** The request's permission set (already resolved by the auth guard) + the reviewer-profile fact. */
  async actorFor(user: AuthenticatedUser): Promise<ContentActorCtx> {
    return {
      userId: user.id,
      name: user.name,
      permissions: new Set<string>(user.isSuperAdmin ? PERMISSION_KEYS : user.permissions),
      isActiveReviewer: await this.repo.isActiveReviewer(user.id),
      isOwner: user.isSuperAdmin,
    };
  }

  async exists(id: string): Promise<boolean> {
    return (await this.repo.findItem(id)) !== undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------------------------

  async list(query: ContentListQuery): Promise<ContentListResponse> {
    const limit = query.limit ?? LIST_PAGE_SIZE_DEFAULT;
    const now = new Date();
    const rows = await this.repo.list(query, decodeCursor(query.cursor, "uuid"), limit, now);
    const page = pageOf(rows, limit);
    return { items: page.items.map((row) => toSummary(row, now)), nextCursor: page.nextCursor };
  }

  async get(id: string, actor: ContentActorCtx): Promise<ContentItemDetail> {
    const item = await this.repo.findItem(id);
    if (!item?.currentRevisionId) throw new AppError(ErrorCode.NOT_FOUND);
    const [revision, category, author, reviewer, tags, sibling, autosave, comments, submitter] =
      await Promise.all([
        this.repo.findRevision(id, item.currentRevisionId),
        item.categoryId ? this.repo.findCategory(item.categoryId) : undefined,
        item.primaryAuthorId ? this.repo.findPerson(item.primaryAuthorId) : undefined,
        item.reviewerId ? this.repo.findPerson(item.reviewerId) : undefined,
        this.repo.tagsOf(id),
        this.repo.siblingTranslation(item.translationGroupId, id),
        this.repo.findAutosave(id, actor.userId),
        this.repo.listComments(id),
        item.submittedRevisionId ? this.repo.revisionAuthor(item.submittedRevisionId) : null,
      ]);
    if (!revision) throw new AppError(ErrorCode.NOT_FOUND);

    const now = new Date();
    const payload: ContentPayload = {
      title: revision.title,
      excerpt: revision.excerpt,
      definition: revision.definition,
      bodyMd: revision.bodyMd,
    };
    const meta: ContentMeta = {
      ...metaOf(item),
      tagIds: tags.map((tag) => tag.id),
    };
    const requiresReview = requiresMedicalReview({
      type: item.type,
      categoryRequiresReview: category?.requiresMedicalReview ?? null,
    });
    const approved = item.reviewedRevisionId === item.currentRevisionId;

    // Stored gates are what the last save computed. An empty or unreadable set (an API revision, a
    // restored one) is stale: recompute now. The review gate is always re-derived, it moves with approvals.
    let gates = parseGates(revision.quality);
    if (gates === null || gates.length === 0) {
      gates = (
        await this.render.build({
          itemId: item.id,
          translationGroupId: item.translationGroupId,
          type: item.type,
          locale: item.locale,
          payload,
          meta,
          categoryRequiresReview: category?.requiresMedicalReview ?? null,
          approvedMatchesCurrent: approved,
        })
      ).gates;
    }
    gates = gates.map((gate) => (gate.id === "medical_review" ? { ...gate, ok: approved } : gate));

    const live = item.publishedRevisionId !== null;
    const workflowItem: WorkflowItem = {
      status: item.status,
      live,
      requiresReview,
      currentRevisionId: item.currentRevisionId,
      reviewedRevisionId: item.reviewedRevisionId,
      submittedBy: item.submittedBy,
      submittedRevisionAuthorId: submitter,
      scheduledAt: item.scheduledAt,
    };

    const summary = toSummary(
      {
        ...item,
        categoryId: category?.id ?? null,
        categoryName: category?.nameAr ?? null,
        categoryRequiresReview: category?.requiresMedicalReview ?? null,
        authorId: author?.id ?? null,
        authorName: author?.nameAr ?? null,
        authorSlug: author?.slug ?? null,
        reviewerId: reviewer?.id ?? null,
        reviewerName: reviewer?.nameAr ?? null,
        reviewerSlug: reviewer?.slug ?? null,
        quality: gates,
        cursorAt: "",
      },
      now,
    );

    const autosavePayload = autosave ? contentPayloadSchema.safeParse(autosave.payload) : null;
    return {
      ...summary,
      translationGroupId: item.translationGroupId,
      translation: sibling ?? null,
      payload,
      meta,
      tags,
      currentRevision: { id: revision.id, number: revision.number },
      reviewedRevisionId: item.reviewedRevisionId,
      publishedRevisionId: item.publishedRevisionId,
      hasUnpublishedChanges: live && item.publishedRevisionId !== item.currentRevisionId,
      lockVersion: item.lockVersion,
      autosave:
        autosave && autosavePayload?.success && autosave.savedAt > revision.createdAt
          ? {
              payload: autosavePayload.data,
              savedAt: autosave.savedAt.toISOString(),
              baseRevisionId: autosave.baseRevisionId,
            }
          : null,
      gates,
      comments: comments.map((comment) => ({
        id: comment.id,
        kind: comment.kind,
        comment: comment.comment,
        author: comment.authorName,
        revisionId: comment.revisionId,
        createdAt: comment.createdAt.toISOString(),
      })),
      publicPath: live ? contentPath(item.type, item.locale, item.slug) : null,
      archivedRedirectTo: item.archivedRedirectTo,
      allowedActions: allowedActions(workflowItem, actor, !hasBlockingIssues(gates), now),
    };
  }

  async listRevisions(id: string): Promise<RevisionSummary[]> {
    const item = await this.repo.findItem(id);
    if (!item) throw new AppError(ErrorCode.NOT_FOUND);
    const rows = await this.repo.listRevisions(id);
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      kind: row.kind,
      note: row.note,
      createdBy: {
        type: row.createdByApiKeyId
          ? ("api_key" as const)
          : row.createdByUserId
            ? ("user" as const)
            : ("system" as const),
        id: row.createdByUserId,
        name: row.createdByName,
      },
      createdAt: row.createdAt.toISOString(),
      diffStats: row.diffStats,
      isApproved: row.id === item.reviewedRevisionId,
      isPublished: row.id === item.publishedRevisionId,
    }));
  }

  async getRevision(id: string, revisionId: string): Promise<RevisionDetail> {
    const item = await this.repo.findItem(id);
    const revision = item ? await this.repo.findRevision(id, revisionId) : undefined;
    if (!item || !revision) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      id: revision.id,
      number: revision.number,
      kind: revision.kind,
      note: revision.note,
      createdBy: {
        type: revision.createdByApiKeyId ? "api_key" : revision.createdByUserId ? "user" : "system",
        id: revision.createdByUserId,
        name: revision.createdByName,
      },
      createdAt: revision.createdAt.toISOString(),
      diffStats: revision.diffStats,
      isApproved: revision.id === item.reviewedRevisionId,
      isPublished: revision.id === item.publishedRevisionId,
      payload: {
        title: revision.title,
        excerpt: revision.excerpt,
        definition: revision.definition,
        bodyMd: revision.bodyMd,
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------------------------

  async create(actor: ContentActorCtx, input: CreateContentItemInput): Promise<ContentItemDetail> {
    const now = new Date();
    const settings = await this.settings.get("content");

    // The twin joins its source's translation group when it can; otherwise it starts a group of its own.
    let groupId: string = randomUUID();
    if (input.translationOf !== undefined) {
      const source = await this.repo.findItem(input.translationOf);
      if (!source) throw new AppError(ErrorCode.NOT_FOUND);
      if (
        source.locale !== input.locale &&
        !(await this.repo.localeInGroup(source.translationGroupId, input.locale))
      ) {
        groupId = source.translationGroupId;
      }
    }

    const refs = input.meta;
    await this.validateRefs({
      categoryId: refs.categoryId,
      tagIds: refs.tagIds,
      primaryAuthorId: refs.primaryAuthorId,
      reviewerId: refs.reviewerId,
      featuredMediaId: refs.featuredMediaId,
      ogImageMediaId: refs.seo?.ogImageMediaId ?? null,
    });
    const category = refs.categoryId ? await this.repo.findCategory(refs.categoryId) : undefined;

    let primaryAuthorId = refs.primaryAuthorId ?? null;
    if (primaryAuthorId === null && settings.defaultAuthorId !== null) {
      const fallback = await this.repo.findPerson(settings.defaultAuthorId);
      if (fallback?.active) primaryAuthorId = fallback.id;
    }
    let reviewerId = refs.reviewerId ?? null;
    if (reviewerId === null && category?.defaultReviewerId) {
      const fallback = await this.repo.findPerson(category.defaultReviewerId);
      if (fallback?.active && fallback.role !== "author") reviewerId = fallback.id;
    }

    let slug: string;
    if (refs.slug !== undefined) {
      assertSlugAllowed(input.type, refs.slug);
      if (await this.repo.slugTaken(input.type, input.locale, refs.slug)) {
        throw new AppError(ErrorCode.CONTENT_SLUG_TAKEN);
      }
      slug = refs.slug;
    } else {
      let base = slugify(input.payload.title);
      // A page titled "About" must not land on the reserved `about` path: suffix it instead of failing.
      if (checkItemSlug(input.type, base) === "reserved") base = `${base}-page`;
      slug = pickFreeSlug(base, new Set(await this.repo.slugsLike(input.type, input.locale, base)));
    }

    const meta: GateMeta = {
      slug,
      categoryId: refs.categoryId ?? null,
      primaryAuthorId,
      reviewerId,
      featuredMediaId: refs.featuredMediaId ?? null,
      seo: refs.seo ?? contentSeoSchema.parse({}),
      flags: refs.flags ?? contentFlagsSchema.parse({}),
    };
    const built = await this.render.build({
      itemId: null,
      translationGroupId: groupId,
      type: input.type,
      locale: input.locale,
      payload: input.payload,
      meta,
      categoryRequiresReview: category?.requiresMedicalReview ?? null,
      approvedMatchesCurrent: false,
    });

    let id: string;
    try {
      id = await this.repo.transaction(async (data) => {
        const item = await data.insertItem(
          {
            type: input.type,
            locale: input.locale,
            translationGroupId: groupId,
            slug,
            title: input.payload.title,
            categoryId: meta.categoryId,
            primaryAuthorId,
            reviewerId,
            featuredMediaId: meta.featuredMediaId,
            seo: meta.seo,
            flags: meta.flags,
            wordCount: built.derived.wordCount,
            searchText: built.searchText,
          },
          now,
        );
        const { patch } = await appendRevision(data, {
          item,
          payload: input.payload,
          previousBodyMd: "",
          built,
          kind: "create",
          note: null,
          actor,
          now,
          logStatusChange: false,
        });
        await data.updateItem(item.id, { ...patch, status: "draft" });
        await data.setItemTags(item.id, [...new Set(refs.tagIds)]);
        return item.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(ErrorCode.CONTENT_SLUG_TAKEN);
      throw error;
    }
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------------------------

  async update(
    actor: ContentActorCtx,
    id: string,
    input: UpdateContentItemInput,
  ): Promise<ContentItemDetail> {
    const now = new Date();
    const item = await this.repo.findItem(id);
    if (!item?.currentRevisionId) throw new AppError(ErrorCode.NOT_FOUND);
    if (input.lockVersion !== item.lockVersion) throw conflict(item);
    const current = await this.repo.findRevision(id, item.currentRevisionId);
    if (!current) throw new AppError(ErrorCode.NOT_FOUND);

    const patchPayload = compact(input.payload);
    const payload: ContentPayload = {
      title: patchPayload.title ?? current.title,
      excerpt: patchPayload.excerpt ?? current.excerpt,
      definition: patchPayload.definition ?? current.definition,
      bodyMd: patchPayload.bodyMd ?? current.bodyMd,
    };
    const payloadChanged =
      payload.title !== current.title ||
      payload.excerpt !== current.excerpt ||
      payload.definition !== current.definition ||
      payload.bodyMd !== current.bodyMd;

    const metaPatch = input.meta;
    const meta = mergeMeta(metaOf(item), metaPatch);
    const slugChanged = metaPatch?.slug !== undefined && metaPatch.slug !== item.slug;
    if (slugChanged) assertSlugAllowed(item.type, meta.slug);
    if (slugChanged && (await this.repo.slugTaken(item.type, item.locale, meta.slug, id))) {
      throw new AppError(ErrorCode.CONTENT_SLUG_TAKEN);
    }
    await this.validateRefs({
      categoryId: metaPatch?.categoryId,
      tagIds: metaPatch?.tagIds,
      primaryAuthorId: metaPatch?.primaryAuthorId,
      reviewerId: metaPatch?.reviewerId,
      featuredMediaId: metaPatch?.featuredMediaId,
      ogImageMediaId: metaPatch?.seo?.ogImageMediaId,
    });
    const category = meta.categoryId ? await this.repo.findCategory(meta.categoryId) : undefined;

    // Only slug, category, author, featured image and SEO fields feed the gates without a new revision.
    const gateInputsChanged =
      metaPatch !== undefined &&
      (metaPatch.slug !== undefined ||
        metaPatch.categoryId !== undefined ||
        metaPatch.primaryAuthorId !== undefined ||
        metaPatch.featuredMediaId !== undefined ||
        metaPatch.seo !== undefined);
    const built =
      payloadChanged || gateInputsChanged
        ? await this.render.build({
            itemId: item.id,
            translationGroupId: item.translationGroupId,
            type: item.type,
            locale: item.locale,
            payload,
            meta,
            categoryRequiresReview: category?.requiresMedicalReview ?? null,
            approvedMatchesCurrent:
              !payloadChanged && item.reviewedRevisionId === item.currentRevisionId,
          })
        : null;

    const oldPath = contentPath(item.type, item.locale, item.slug);
    const newPath = contentPath(item.type, item.locale, meta.slug);
    const wasPublic = item.publishedRevisionId !== null || item.firstPublishedAt !== null;
    const moved = slugChanged && wasPublic;
    const eventKey = `content.changed:${id}:moved:${String(now.getTime())}`;

    try {
      await this.repo.transaction(async (data) => {
        const locked = await data.lockItem(id);
        if (locked?.lockVersion !== item.lockVersion) throw conflict(locked);

        let patch: Partial<ContentItem> = {};
        if (payloadChanged && built) {
          ({ patch } = await appendRevision(data, {
            item: locked,
            payload,
            previousBodyMd: current.bodyMd,
            built,
            kind: "save",
            note: input.note ?? null,
            actor,
            now,
            logStatusChange: true,
          }));
        } else if (built) {
          await data.updateRevisionQuality(current.id, built.gates);
          await data.replaceMediaRefs(
            id,
            ["featured", "og"],
            built.mediaRefs.filter((ref) => ref.role === "featured" || ref.role === "og"),
          );
        }
        if (metaPatch?.tagIds !== undefined)
          await data.setItemTags(id, [...new Set(metaPatch.tagIds)]);
        if (moved) {
          await data.upsertRedirect({
            fromPath: oldPath,
            toPath: newPath,
            reason: "slug_changed",
            createdBy: actor.userId,
            now,
          });
          await data.emit(
            { itemId: id, kind: "moved", paths: [newPath], oldPaths: [oldPath] },
            eventKey,
          );
        }
        await data.updateItem(id, {
          ...patch,
          slug: meta.slug,
          categoryId: meta.categoryId,
          primaryAuthorId: meta.primaryAuthorId,
          reviewerId: meta.reviewerId,
          featuredMediaId: meta.featuredMediaId,
          seo: meta.seo,
          flags: meta.flags,
          lockVersion: locked.lockVersion + 1,
          updatedAt: now,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(ErrorCode.CONTENT_SLUG_TAKEN);
      throw error;
    }
    if (moved) await kickOutbox(this.outbox, eventKey);
    return this.get(id, actor);
  }

  // -------------------------------------------------------------------------------------------
  // Autosave, restore, corrections
  // -------------------------------------------------------------------------------------------

  async autosave(
    actor: ContentActorCtx,
    id: string,
    input: AutosaveContentInput,
  ): Promise<{ savedAt: string }> {
    const item = await this.repo.findItem(id);
    if (!item) throw new AppError(ErrorCode.NOT_FOUND);
    if (input.baseRevisionId !== item.currentRevisionId) throw conflict(item);
    const now = new Date();
    await this.repo.upsertAutosave({
      itemId: id,
      userId: actor.userId,
      baseRevisionId: input.baseRevisionId,
      payload: input.payload,
      now,
    });
    return { savedAt: now.toISOString() };
  }

  async restore(
    actor: ContentActorCtx,
    id: string,
    revisionId: string,
  ): Promise<ContentItemDetail> {
    const now = new Date();
    const item = await this.repo.findItem(id);
    if (!item?.currentRevisionId) throw new AppError(ErrorCode.NOT_FOUND);
    const [source, current] = await Promise.all([
      this.repo.findRevision(id, revisionId),
      this.repo.findRevision(id, item.currentRevisionId),
    ]);
    if (!source || !current) throw new AppError(ErrorCode.NOT_FOUND);
    const category = item.categoryId ? await this.repo.findCategory(item.categoryId) : undefined;
    const payload: ContentPayload = {
      title: source.title,
      excerpt: source.excerpt,
      definition: source.definition,
      bodyMd: source.bodyMd,
    };
    const built = await this.render.build({
      itemId: item.id,
      translationGroupId: item.translationGroupId,
      type: item.type,
      locale: item.locale,
      payload,
      meta: metaOf(item),
      categoryRequiresReview: category?.requiresMedicalReview ?? null,
      approvedMatchesCurrent: false,
    });
    await this.repo.transaction(async (data) => {
      const locked = await data.lockItem(id);
      if (locked?.lockVersion !== item.lockVersion) throw conflict(locked);
      const { patch } = await appendRevision(data, {
        item: locked,
        payload,
        previousBodyMd: current.bodyMd,
        built,
        kind: "restore",
        note: `#${String(source.number)}`,
        actor,
        now,
        logStatusChange: true,
      });
      await data.updateItem(id, { ...patch, lockVersion: locked.lockVersion + 1, updatedAt: now });
    });
    return this.get(id, actor);
  }

  async addCorrection(actor: ContentActorCtx, id: string, summary: string): Promise<{ ok: true }> {
    const now = new Date();
    const item = await this.repo.findItem(id);
    if (!item) throw new AppError(ErrorCode.NOT_FOUND);
    if (item.publishedRevisionId === null) throw new AppError(ErrorCode.CONTENT_ILLEGAL_TRANSITION);
    const path = contentPath(item.type, item.locale, item.slug);
    const key = `content.changed:${id}:correction:${String(now.getTime())}`;
    await this.repo.transaction(async (data) => {
      await data.insertCorrection({ itemId: id, summary, createdBy: actor.userId, now });
      await data.emit({ itemId: id, kind: "updated", paths: [path], oldPaths: [] }, key);
    });
    await kickOutbox(this.outbox, key);
    return { ok: true };
  }

  // -------------------------------------------------------------------------------------------

  private async validateRefs(refs: {
    categoryId?: string | null | undefined;
    tagIds?: string[] | undefined;
    primaryAuthorId?: string | null | undefined;
    reviewerId?: string | null | undefined;
    featuredMediaId?: string | null | undefined;
    ogImageMediaId?: string | null | undefined;
  }): Promise<void> {
    if (refs.categoryId && !(await this.repo.findCategory(refs.categoryId))) {
      throw invalid("meta.categoryId");
    }
    if (refs.tagIds !== undefined) {
      const unique = [...new Set(refs.tagIds)];
      if ((await this.repo.existingTagIds(unique)).length !== unique.length) {
        throw invalid("meta.tagIds");
      }
    }
    if (refs.primaryAuthorId) {
      const person = await this.repo.findPerson(refs.primaryAuthorId);
      if (!person?.active) throw invalid("meta.primaryAuthorId");
    }
    if (refs.reviewerId) {
      const person = await this.repo.findPerson(refs.reviewerId);
      if (!person?.active || person.role === "author") throw invalid("meta.reviewerId");
    }
    for (const [field, mediaId] of [
      ["meta.featuredMediaId", refs.featuredMediaId],
      ["meta.seo.ogImageMediaId", refs.ogImageMediaId],
    ] as const) {
      if (mediaId && (await this.repo.readyMedia([mediaId])).length === 0) throw invalid(field);
    }
  }
}
