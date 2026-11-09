import { requiresMedicalReview } from "@wasfa/shared/content";
import {
  contentFlagsSchema,
  contentSeoSchema,
  type ContentMetaPatch,
  type ContentPayloadPatch,
  type ContentSeo,
  type CreateContentItemInput,
} from "@wasfa/shared/schemas/content";
import {
  titleIsArabic,
  type PublishingArticleInput,
  type PublishingArticlePatch,
  type PublishingMediaFields,
} from "@wasfa/shared/schemas/publishing";

import { forbidden, validationFailed } from "./publishing-api-errors.js";
import { composeBody, countRenderedSources } from "./publishing-api-sources.js";

import type { PublishingPrincipal } from "./publishing-principal.js";
import type { PatchMediaInput } from "@wasfa/shared/schemas/media";

/*
 * API input -> the content platform's own shapes (createContentItemSchema / updateContentItemSchema).
 * Pure: the service resolves slugs to ids first (`ResolvedRefs`), this decides everything else, so every
 * rule (key defaults, restrictions, sources, seo) is unit-tested without a database. Whatever is stored
 * goes through the same render, gates and workflow as an editor's save.
 */

/** Ids the service looked up for the slugs and names in the request. `undefined` = the request did not say. */
export interface ResolvedRefs {
  categoryId?: string | null;
  categorySlug?: string | null;
  /** Of the category the item will have after this write (null: no category, the type decides). */
  categoryRequiresReview: boolean | null;
  tagIds?: string[];
  authorId?: string | null;
  reviewerId?: string | null;
  translationOfId?: string;
}

const CANONICAL_IGNORED =
  "seo.canonical_url was ignored: API keys cannot set a canonical URL in v1.";

/** A key restricted to some types or categories may not step outside them (403, not a validation error). */
export function assertPrincipalAllows(
  principal: Pick<PublishingPrincipal, "allowedTypes" | "allowedCategorySlugs">,
  target: { type: string; categorySlug: string | null | undefined },
): void {
  if (
    principal.allowedTypes.length > 0 &&
    !(principal.allowedTypes as readonly string[]).includes(target.type)
  ) {
    throw forbidden("type_not_allowed");
  }
  if (principal.allowedCategorySlugs.length > 0) {
    // A category-restricted key must name one of its categories: "no category" would sidestep the limit.
    if (
      target.categorySlug === null ||
      target.categorySlug === undefined ||
      !principal.allowedCategorySlugs.includes(target.categorySlug)
    ) {
      throw forbidden("category_not_allowed");
    }
  }
}

/** Medical categories (and guides and glossary entries) need at least one https source. */
export function assertSourcesFor(requiresReview: boolean, sourceCount: number): void {
  if (requiresReview && sourceCount < 1) {
    throw validationFailed({
      sources:
        "this content needs medical review, so at least one real https source is required (WHO, NIH/MedlinePlus, FDA, EMA, Egyptian Drug Authority, peer-reviewed).",
    });
  }
}

function seoOf(input: PublishingArticleInput["seo"]): { seo: ContentSeo; notes: string[] } {
  const notes: string[] = [];
  if (input?.canonical_url !== undefined) notes.push(CANONICAL_IGNORED);
  return {
    seo: contentSeoSchema.parse({
      ...(input?.title !== undefined ? { title: input.title } : {}),
      ...(input?.description !== undefined ? { description: input.description } : {}),
      ...(input?.focus_keyword !== undefined ? { focusKeyword: input.focus_keyword } : {}),
      ...(input?.secondary_keywords !== undefined
        ? { secondaryKeywords: input.secondary_keywords }
        : {}),
      ...(input?.robots !== undefined ? { robots: input.robots } : {}),
      ...(input?.og_title !== undefined ? { ogTitle: input.og_title } : {}),
      ...(input?.og_description !== undefined ? { ogDescription: input.og_description } : {}),
      ...(input?.og_media_id !== undefined ? { ogImageMediaId: input.og_media_id } : {}),
    }),
    notes,
  };
}

export interface MappedCreate {
  create: CreateContentItemInput;
  externalId: string | undefined;
  requiresReview: boolean;
  notes: string[];
}

export function mapCreate(
  input: PublishingArticleInput,
  refs: ResolvedRefs,
  principal: Pick<
    PublishingPrincipal,
    "allowedTypes" | "allowedCategorySlugs" | "defaultAuthorId" | "defaultFeaturedMediaId"
  >,
): MappedCreate {
  assertPrincipalAllows(principal, { type: input.type, categorySlug: refs.categorySlug });
  const requiresReview = requiresMedicalReview({
    type: input.type,
    categoryRequiresReview: refs.categoryRequiresReview,
  });
  assertSourcesFor(requiresReview, input.sources?.length ?? 0);
  const { seo, notes } = seoOf(input.seo);
  const featured = input.featured_media_id ?? principal.defaultFeaturedMediaId ?? null;
  if (input.featured_media_id === undefined && featured !== null) {
    notes.push("No featured_media_id was sent: the key's default featured image was used.");
  }
  const authorId = refs.authorId ?? principal.defaultAuthorId ?? null;
  if (refs.authorId === undefined && authorId !== null) {
    notes.push("No author was sent: the key's default author was used.");
  }
  return {
    create: {
      type: input.type,
      locale: input.locale,
      ...(refs.translationOfId !== undefined ? { translationOf: refs.translationOfId } : {}),
      payload: {
        title: input.title,
        excerpt: input.excerpt ?? "",
        definition: input.definition ?? "",
        bodyMd: composeBody(input.body_markdown, input.sources),
      },
      meta: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        categoryId: refs.categoryId ?? null,
        tagIds: refs.tagIds ?? [],
        primaryAuthorId: authorId,
        reviewerId: refs.reviewerId ?? null,
        featuredMediaId: featured,
        seo,
        flags: contentFlagsSchema.parse({
          ...(input.flags?.auto_link !== undefined ? { autoLink: input.flags.auto_link } : {}),
          ...(input.flags?.show_toc !== undefined ? { showToc: input.flags.show_toc } : {}),
          ...(input.flags?.show_related !== undefined
            ? { showRelated: input.flags.show_related }
            : {}),
          aiAssisted: input.ai_assisted ?? false,
        }),
      },
    },
    externalId: input.external_id,
    requiresReview,
    notes,
  };
}

/** A PUT is the full document: on an existing item it behaves as a patch of every field the body names. */
export function putAsPatch(input: PublishingArticleInput): PublishingArticlePatch {
  const patch: Record<string, unknown> = {
    title: input.title,
    body_markdown: input.body_markdown,
    desired_status: input.desired_status,
  };
  const optional: Record<string, unknown> = {
    slug: input.slug,
    excerpt: input.excerpt,
    definition: input.definition,
    category: input.category,
    tags: input.tags,
    author: input.author,
    reviewer: input.reviewer,
    featured_media_id: input.featured_media_id,
    seo: input.seo,
    sources: input.sources,
    ai_assisted: input.ai_assisted,
    flags: input.flags,
    scheduled_at: input.scheduled_at,
    publish_on_approval: input.publish_on_approval,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) patch[key] = value;
  }
  return patch as PublishingArticlePatch;
}

/** `type` and `locale` are part of an item's identity (its URL): they cannot change. */
export function assertSameIdentity(
  existing: { type: string; locale: string },
  input: { type: string; locale: string },
): void {
  const problems: Record<string, string> = {};
  if (existing.type !== input.type) problems.type = "cannot change after creation";
  if (existing.locale !== input.locale) problems.locale = "cannot change after creation";
  if (Object.keys(problems).length > 0) throw validationFailed(problems);
}

export interface ExistingForPatch {
  type: "article" | "guide" | "glossary" | "page";
  bodyMd: string;
  categorySlug: string | null;
}

export interface MappedPatch {
  payload: ContentPayloadPatch | undefined;
  meta: ContentMetaPatch | undefined;
  requiresReview: boolean;
  notes: string[];
}

/** JSON Merge Patch: a present key replaces, `null` clears, an absent key is untouched. */
export function mapPatch(
  patch: PublishingArticlePatch,
  refs: ResolvedRefs,
  principal: Pick<PublishingPrincipal, "allowedTypes" | "allowedCategorySlugs">,
  existing: ExistingForPatch,
): MappedPatch {
  const categorySlug = refs.categorySlug === undefined ? existing.categorySlug : refs.categorySlug;
  assertPrincipalAllows(principal, { type: existing.type, categorySlug });
  const requiresReview = requiresMedicalReview({
    type: existing.type,
    categoryRequiresReview: refs.categoryRequiresReview,
  });
  const notes: string[] = [];

  const payload: ContentPayloadPatch = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.excerpt !== undefined) payload.excerpt = patch.excerpt;
  if (patch.definition !== undefined) payload.definition = patch.definition;
  if (patch.body_markdown !== undefined || patch.sources !== undefined) {
    payload.bodyMd = composeBody(
      patch.body_markdown ?? existing.bodyMd,
      patch.sources,
      existing.bodyMd,
    );
  }
  // A patch that does not touch the body, the sources or the category must not trip over an old item.
  if (payload.bodyMd !== undefined || refs.categoryId !== undefined) {
    assertSourcesFor(requiresReview, countRenderedSources(payload.bodyMd ?? existing.bodyMd));
  }

  const meta: ContentMetaPatch = {};
  if (patch.slug !== undefined) meta.slug = patch.slug;
  if (refs.categoryId !== undefined) meta.categoryId = refs.categoryId;
  if (refs.tagIds !== undefined) meta.tagIds = refs.tagIds;
  if (refs.authorId !== undefined) meta.primaryAuthorId = refs.authorId;
  if (refs.reviewerId !== undefined) meta.reviewerId = refs.reviewerId;
  if (patch.featured_media_id !== undefined) meta.featuredMediaId = patch.featured_media_id;
  if (patch.seo !== undefined) {
    const seo = patch.seo;
    if (seo.canonical_url !== undefined) notes.push(CANONICAL_IGNORED);
    const mapped: NonNullable<ContentMetaPatch["seo"]> = {};
    if (seo.title !== undefined) mapped.title = seo.title ?? "";
    if (seo.description !== undefined) mapped.description = seo.description ?? "";
    if (seo.focus_keyword !== undefined) mapped.focusKeyword = seo.focus_keyword ?? "";
    if (seo.secondary_keywords !== undefined) {
      mapped.secondaryKeywords = seo.secondary_keywords ?? [];
    }
    if (seo.robots !== undefined) mapped.robots = seo.robots ?? "index";
    if (seo.og_title !== undefined) mapped.ogTitle = seo.og_title ?? "";
    if (seo.og_description !== undefined) mapped.ogDescription = seo.og_description ?? "";
    if (seo.og_media_id !== undefined) mapped.ogImageMediaId = seo.og_media_id;
    if (Object.keys(mapped).length > 0) meta.seo = mapped;
  }
  const flags: NonNullable<ContentMetaPatch["flags"]> = {};
  if (patch.flags?.auto_link !== undefined) flags.autoLink = patch.flags.auto_link;
  if (patch.flags?.show_toc !== undefined) flags.showToc = patch.flags.show_toc;
  if (patch.flags?.show_related !== undefined) flags.showRelated = patch.flags.show_related;
  if (patch.ai_assisted !== undefined) flags.aiAssisted = patch.ai_assisted;
  if (Object.keys(flags).length > 0) meta.flags = flags;

  return {
    payload: Object.keys(payload).length > 0 ? payload : undefined,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
    requiresReview,
    notes,
  };
}

/** Media metadata of the API -> the media library's patch. */
export function mapMediaMeta(fields: Partial<PublishingMediaFields>): PatchMediaInput {
  const patch: PatchMediaInput = {};
  if (fields.alt !== undefined) {
    patch.altAr = fields.alt;
    // A Latin-only alt with no English one doubles as the English alt (English articles gate on it).
    if (fields.alt_en === undefined && !titleIsArabic(fields.alt)) patch.altEn = fields.alt;
  }
  if (fields.alt_en !== undefined) patch.altEn = fields.alt_en;
  if (fields.caption !== undefined) patch.caption = fields.caption;
  if (fields.credit !== undefined) patch.credit = fields.credit;
  if (fields.licence !== undefined) patch.licence = fields.licence;
  if (fields.licence_ref !== undefined) patch.licenceRef = fields.licence_ref;
  if (fields.filename_hint !== undefined) patch.seoFilename = fields.filename_hint;
  if (fields.focal_point !== undefined) {
    patch.focalX = Math.round(fields.focal_point.x * 100);
    patch.focalY = Math.round(fields.focal_point.y * 100);
  }
  return patch;
}
