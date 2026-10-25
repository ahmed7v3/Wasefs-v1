import { z } from "zod";

import {
  CONTENT_ACTIONS,
  CONTENT_LIMITS,
  CONTENT_LOCALES,
  CONTENT_SLUG_MAX,
  CONTENT_PAGE_SLUG_MAX,
  CONTENT_PAGE_SLUG_PATTERN,
  CONTENT_SLUG_PATTERN,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  CONTENT_TYPES,
  PERSON_ROLES,
  QUALITY_GATE_IDS,
  REDIRECT_REASONS,
  REVISION_KINDS,
} from "../content/constants.js";

import { cursorQuerySchema } from "./admin.js";
import { mediaVariantSchema } from "./media.js";

/*
 * The content platform's HTTP contract (Phase 4, WP3; docs/CONTENT-PLATFORM.md). One file for the admin
 * API (`/admin/content/*`) and the public read API (`/public/content/*`), so the web app, the API and the
 * Publishing API (WP4) validate the same shapes. Additive changes only once a consumer exists: a renamed
 * or removed field breaks the other apps at compile time, which is the point of sharing it.
 *
 * Conventions: ids are uuids; instants are ISO strings; paths are site-relative (`/blog/x`, `/en/blog/x`);
 * unknown keys are stripped by zod; every free-text field has a length bound (CONTENT_LIMITS).
 */

const id = z.uuid();
const isoInstant = z.iso.datetime({ offset: true });
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const contentTypeSchema = z.enum(CONTENT_TYPES);
export const contentLocaleSchema = z.enum(CONTENT_LOCALES);
export const contentStatusSchema = z.enum(CONTENT_STATUSES);
export const contentActionSchema = z.enum(CONTENT_ACTIONS);
export const contentSourceSchema = z.enum(CONTENT_SOURCES);
export const revisionKindSchema = z.enum(REVISION_KINDS);

export const contentSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(CONTENT_SLUG_MAX)
  .regex(CONTENT_SLUG_PATTERN, "lower-case ascii words joined by hyphens");

/**
 * The slug of a content ITEM. Pages may be paths (`features/x`), so the format allows `/`; which types
 * may use it, and the reserved names, are enforced per type by `checkItemSlug` in the API.
 */
export const contentItemSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(CONTENT_PAGE_SLUG_MAX)
  .regex(
    CONTENT_PAGE_SLUG_PATTERN,
    "lower-case ascii words joined by hyphens (pages: up to 3 segments)",
  );

/** A site-relative path: starts with one `/`, no scheme, no `//`, no whitespace (open-redirect safe). */
export const sitePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^\/(?!\/)[^\s\\]*$/, "site-relative path");

// ---------------------------------------------------------------------------------------------
// Editable pieces
// ---------------------------------------------------------------------------------------------

/** SEO fields (CONTENT-PLATFORM §3 `seo` jsonb); item-level, never part of the reviewed payload. */
export const contentSeoSchema = z.object({
  title: z.string().trim().max(CONTENT_LIMITS.metaTitleMax).default(""),
  description: z.string().trim().max(CONTENT_LIMITS.metaDescriptionMax).default(""),
  /** Admin-only override, for syndicated content. A site path or an https URL. */
  canonical: z.string().trim().max(500).default(""),
  robots: z.enum(["index", "noindex"]).default("index"),
  focusKeyword: z.string().trim().max(120).default(""),
  secondaryKeywords: z
    .array(z.string().trim().min(1).max(120))
    .max(CONTENT_LIMITS.secondaryKeywordsMax)
    .default([]),
  ogTitle: z.string().trim().max(CONTENT_LIMITS.metaTitleMax).default(""),
  ogDescription: z.string().trim().max(CONTENT_LIMITS.metaDescriptionMax).default(""),
  ogImageMediaId: id.nullable().default(null),
});
export type ContentSeo = z.output<typeof contentSeoSchema>;

export const contentFlagsSchema = z.object({
  autoLink: z.boolean().default(true),
  showToc: z.boolean().default(false),
  showRelated: z.boolean().default(true),
  sponsored: z.boolean().default(false),
  /** Adds the editorial note «كُتب بمساعدة أدوات ذكاء اصطناعي» (SEO-GEO §9.6). */
  aiAssisted: z.boolean().default(false),
});
export type ContentFlags = z.output<typeof contentFlagsSchema>;

/** The REVIEWED fields: changing any of them creates a revision and sends the item back to `draft`. */
export const contentPayloadSchema = z.object({
  title: z.string().trim().min(1).max(CONTENT_LIMITS.titleMax),
  excerpt: z.string().trim().max(CONTENT_LIMITS.excerptMax).default(""),
  /** Glossary entries only: the one-sentence definition shown in lists and in `DefinedTerm`. */
  definition: z.string().trim().max(CONTENT_LIMITS.definitionMax).default(""),
  bodyMd: z.string().max(CONTENT_LIMITS.bodyMdMax).default(""),
});
export type ContentPayload = z.output<typeof contentPayloadSchema>;

/** Item-level metadata: applies live immediately, never needs re-review (CONTENT-PLATFORM §4.1). */
export const contentMetaSchema = z.object({
  slug: contentItemSlugSchema,
  categoryId: id.nullable().default(null),
  tagIds: z.array(id).max(CONTENT_LIMITS.tagsPerItemMax).default([]),
  primaryAuthorId: id.nullable().default(null),
  reviewerId: id.nullable().default(null),
  featuredMediaId: id.nullable().default(null),
  seo: contentSeoSchema.default(() => contentSeoSchema.parse({})),
  flags: contentFlagsSchema.default(() => contentFlagsSchema.parse({})),
});
export type ContentMeta = z.output<typeof contentMetaSchema>;

// ---------------------------------------------------------------------------------------------
// Quality gates (computed on every save; blocking only on schedule/publish)
// ---------------------------------------------------------------------------------------------

export const qualityGateSchema = z.object({
  id: z.enum(QUALITY_GATE_IDS),
  level: z.enum(["block", "warn", "info"]),
  /** `true` = passes. A failing `block` gate stops publish; a failing `warn` is shown. */
  ok: z.boolean(),
  /** Structured facts for the message (counts, thresholds, the matching URL), never prose. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type QualityGate = z.output<typeof qualityGateSchema>;

// ---------------------------------------------------------------------------------------------
// Admin: items
// ---------------------------------------------------------------------------------------------

export const createContentItemSchema = z.object({
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  /** Create the English twin of an existing Arabic item (or the reverse): joins its translation group. */
  translationOf: id.optional(),
  payload: contentPayloadSchema,
  meta: contentMetaSchema.partial({ slug: true }),
});
export type CreateContentItemInput = z.output<typeof createContentItemSchema>;

/*
 * Patch shapes: every field optional and WITHOUT its default. `schema.partial()` keeps the defaults
 * (zod 4 applies a default inside an optional), so a patch of `{ title }` would reset the excerpt,
 * the body, the category... to their defaults. These unwrap the defaults so an absent key stays absent.
 */
export const contentPayloadPatchSchema = z.object({
  title: contentPayloadSchema.shape.title.optional(),
  excerpt: contentPayloadSchema.shape.excerpt.unwrap().optional(),
  definition: contentPayloadSchema.shape.definition.unwrap().optional(),
  bodyMd: contentPayloadSchema.shape.bodyMd.unwrap().optional(),
});
export type ContentPayloadPatch = z.output<typeof contentPayloadPatchSchema>;

export const contentSeoPatchSchema = z.object({
  title: contentSeoSchema.shape.title.unwrap().optional(),
  description: contentSeoSchema.shape.description.unwrap().optional(),
  canonical: contentSeoSchema.shape.canonical.unwrap().optional(),
  robots: contentSeoSchema.shape.robots.unwrap().optional(),
  focusKeyword: contentSeoSchema.shape.focusKeyword.unwrap().optional(),
  secondaryKeywords: contentSeoSchema.shape.secondaryKeywords.unwrap().optional(),
  ogTitle: contentSeoSchema.shape.ogTitle.unwrap().optional(),
  ogDescription: contentSeoSchema.shape.ogDescription.unwrap().optional(),
  ogImageMediaId: contentSeoSchema.shape.ogImageMediaId.unwrap().optional(),
});

export const contentFlagsPatchSchema = z.object({
  autoLink: contentFlagsSchema.shape.autoLink.unwrap().optional(),
  showToc: contentFlagsSchema.shape.showToc.unwrap().optional(),
  showRelated: contentFlagsSchema.shape.showRelated.unwrap().optional(),
  sponsored: contentFlagsSchema.shape.sponsored.unwrap().optional(),
  aiAssisted: contentFlagsSchema.shape.aiAssisted.unwrap().optional(),
});

export const contentMetaPatchSchema = z.object({
  slug: contentItemSlugSchema.optional(),
  categoryId: contentMetaSchema.shape.categoryId.unwrap().optional(),
  tagIds: contentMetaSchema.shape.tagIds.unwrap().optional(),
  primaryAuthorId: contentMetaSchema.shape.primaryAuthorId.unwrap().optional(),
  reviewerId: contentMetaSchema.shape.reviewerId.unwrap().optional(),
  featuredMediaId: contentMetaSchema.shape.featuredMediaId.unwrap().optional(),
  seo: contentSeoPatchSchema.optional(),
  flags: contentFlagsPatchSchema.optional(),
});
export type ContentMetaPatch = z.output<typeof contentMetaPatchSchema>;

export const updateContentItemSchema = z
  .object({
    /** The `lockVersion` the editor loaded; a mismatch answers `CONFLICT` with the newer revision. */
    lockVersion: z.number().int().min(0),
    payload: contentPayloadPatchSchema.optional(),
    meta: contentMetaPatchSchema.optional(),
    note: z.string().trim().max(CONTENT_LIMITS.noteMax).optional(),
  })
  .refine((body) => body.payload !== undefined || body.meta !== undefined, {
    message: "nothing to change",
  });
export type UpdateContentItemInput = z.output<typeof updateContentItemSchema>;

export const autosaveContentSchema = z.object({
  baseRevisionId: id,
  payload: contentPayloadSchema,
});
export type AutosaveContentInput = z.output<typeof autosaveContentSchema>;

/** `POST /admin/content/render-preview`: the same renderer as save, nothing stored. */
export const renderPreviewSchema = z.object({
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  bodyMd: z.string().max(CONTENT_LIMITS.bodyMdMax),
  flags: contentFlagsSchema.partial().optional(),
});
export type RenderPreviewInput = z.output<typeof renderPreviewSchema>;

export const tocEntrySchema = z.object({
  id: z.string().min(1).max(160),
  text: z.string().max(300),
  level: z.number().int().min(2).max(4),
});
export type TocEntry = z.output<typeof tocEntrySchema>;

export const renderPreviewResponseSchema = z.object({
  html: z.string(),
  toc: z.array(tocEntrySchema),
  wordCount: z.number().int(),
  readingMinutes: z.number().int(),
  /** Directive/entity/media problems found while rendering (unknown `{{drug:x}}`, missing media id...). */
  warnings: z.array(z.object({ code: z.string(), detail: z.string().optional() })),
});
export type RenderPreviewResponse = z.output<typeof renderPreviewResponseSchema>;

/** Body of `POST /admin/content/items/:id/actions/:action`. Fields not used by an action are ignored. */
export const contentActionBodySchema = z.object({
  lockVersion: z.number().int().min(0).optional(),
  /** `request_changes` requires it (internal, never public); `approve` and `submit` may carry one. */
  comment: z.string().trim().max(CONTENT_LIMITS.commentMax).optional(),
  /** `schedule`: a future instant. The worker publishes it within a minute of this time. */
  at: isoInstant.optional(),
  /** `archive`: where the old URL should 301 to; absent = 410 Gone (404 if it was never published). */
  redirectTo: sitePathSchema.optional(),
  /** `approve` with minor edits by the reviewer (attributed to the reviewer, recorded as a revision). */
  edits: contentPayloadPatchSchema.optional(),
});
export type ContentActionBody = z.output<typeof contentActionBodySchema>;

export const contentActionParamsSchema = z.object({ id, action: contentActionSchema });

export const contentIdParamSchema = z.object({ id });

/** Permanent delete: the owner retypes the item's title as a guard against a wrong item. */
export const contentPurgeBodySchema = z.object({ confirmTitle: z.string().min(1).max(300) });
export type ContentPurgeBody = z.output<typeof contentPurgeBodySchema>;
export const contentRevisionParamsSchema = z.object({ id, revisionId: id });

export const personRefSchema = z.object({ id, name: z.string(), slug: z.string() });
export const namedRefSchema = z.object({ id, name: z.string() });

/** One row of the admin list. */
export const contentItemSummarySchema = z.object({
  id,
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  slug: z.string(),
  status: contentStatusSchema,
  /** `published_revision_id` is set: the public can see (a version of) it. */
  live: z.boolean(),
  title: z.string(),
  category: namedRefSchema.nullable(),
  author: personRefSchema.nullable(),
  reviewer: personRefSchema.nullable(),
  source: contentSourceSchema,
  apiKeyName: z.string().nullable(),
  scheduledAt: isoInstant.nullable(),
  publishedAt: isoInstant.nullable(),
  updatedAt: isoInstant,
  wordCount: z.number().int(),
  requiresReview: z.boolean(),
  /** Counts of failing gates on the working revision. */
  issues: z.object({ block: z.number().int(), warn: z.number().int() }),
  reviewOverdue: z.boolean(),
});
export type ContentItemSummary = z.output<typeof contentItemSummarySchema>;

export const contentListQuerySchema = cursorQuerySchema.extend({
  type: contentTypeSchema.optional(),
  status: contentStatusSchema.optional(),
  locale: contentLocaleSchema.optional(),
  categoryId: id.optional(),
  authorId: id.optional(),
  reviewerId: id.optional(),
  source: contentSourceSchema.optional(),
  apiKeyId: id.optional(),
  /** Title/slug/body full-text and title trigram search. */
  q: z.string().trim().min(1).max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  live: z.coerce.boolean().optional(),
  reviewOverdue: z.coerce.boolean().optional(),
  hasIssues: z.coerce.boolean().optional(),
  scheduledFrom: z.iso.date().optional(),
  scheduledTo: z.iso.date().optional(),
  /** UTC day range of the LIVE version's publish time (`published_at`), for the calendar. */
  publishedFrom: z.iso.date().optional(),
  publishedTo: z.iso.date().optional(),
});
export type ContentListQuery = z.output<typeof contentListQuerySchema>;

export const contentListResponseSchema = z.object({
  items: z.array(contentItemSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ContentListResponse = z.output<typeof contentListResponseSchema>;

export const revisionActorSchema = z.object({
  type: z.enum(["user", "api_key", "system"]),
  id: z.string().nullable(),
  name: z.string(),
});

export const revisionSummarySchema = z.object({
  id,
  number: z.number().int(),
  kind: revisionKindSchema,
  note: z.string().nullable(),
  createdBy: revisionActorSchema,
  createdAt: isoInstant,
  diffStats: z.object({ added: z.number().int(), removed: z.number().int() }),
  isApproved: z.boolean(),
  isPublished: z.boolean(),
});
export type RevisionSummary = z.output<typeof revisionSummarySchema>;

export const revisionDetailSchema = revisionSummarySchema.extend({ payload: contentPayloadSchema });
export type RevisionDetail = z.output<typeof revisionDetailSchema>;

export const reviewCommentSchema = z.object({
  id,
  kind: z.enum(["request_changes", "approve", "note"]),
  comment: z.string(),
  author: z.string(),
  revisionId: id,
  createdAt: isoInstant,
});

/** Everything the editor needs in one read. */
export const contentItemDetailSchema = contentItemSummarySchema.extend({
  translationGroupId: id,
  /** The twin in the other locale, when one exists. */
  translation: z
    .object({ id, locale: contentLocaleSchema, slug: z.string(), status: contentStatusSchema })
    .nullable(),
  payload: contentPayloadSchema,
  meta: contentMetaSchema,
  tags: z.array(namedRefSchema),
  currentRevision: z.object({ id, number: z.number().int() }),
  reviewedRevisionId: id.nullable(),
  publishedRevisionId: id.nullable(),
  /** The current revision differs from the published one: the editor shows "unpublished changes". */
  hasUnpublishedChanges: z.boolean(),
  lockVersion: z.number().int(),
  /** A newer autosave by this user exists (the editor offers to restore it). */
  autosave: z
    .object({ payload: contentPayloadSchema, savedAt: isoInstant, baseRevisionId: id })
    .nullable(),
  gates: z.array(qualityGateSchema),
  comments: z.array(reviewCommentSchema),
  /** Path of the live page when live, else null. */
  publicPath: sitePathSchema.nullable(),
  archivedRedirectTo: sitePathSchema.nullable(),
  /** Tells the UI which action buttons to show (computed by the workflow state machine for THIS user). */
  allowedActions: z.array(contentActionSchema),
  /** The platform owner may delete the item permanently (DELETE /admin/content/items/:id). */
  canPurge: z.boolean(),
});
export type ContentItemDetail = z.output<typeof contentItemDetailSchema>;

export const previewTokenResponseSchema = z.object({
  url: z.string(),
  expiresAt: isoInstant,
});

export const createCorrectionSchema = z.object({
  summary: z.string().trim().min(5).max(500),
});

export const duplicateCheckResponseSchema = z.object({
  /** Highest similarity found against published items of the same locale, with the match's path. */
  similarity: z.number().min(0).max(1),
  matchPath: sitePathSchema.nullable(),
});

// ---------------------------------------------------------------------------------------------
// Admin: bulk actions and the review inbox
// ---------------------------------------------------------------------------------------------

export const bulkActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_category"),
    ids: z.array(id).min(1).max(100),
    categoryId: id.nullable(),
  }),
  z.object({
    action: z.literal("set_tags"),
    ids: z.array(id).min(1).max(100),
    mode: z.enum(["add", "remove", "replace"]),
    tagIds: z.array(id).max(CONTENT_LIMITS.tagsPerItemMax),
  }),
  z.object({
    action: z.literal("set_reviewer"),
    ids: z.array(id).min(1).max(100),
    reviewerId: id.nullable(),
  }),
  z.object({
    action: z.literal("schedule_series"),
    ids: z.array(id).min(1).max(100),
    /** First instant, then one item every `everyHours` hours, in the given order. */
    startAt: isoInstant,
    everyHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 14),
  }),
  z.object({ action: z.literal("unpublish"), ids: z.array(id).min(1).max(100) }),
  z.object({
    action: z.literal("archive"),
    ids: z.array(id).min(1).max(100),
    redirectTo: sitePathSchema.optional(),
  }),
]);
export type BulkActionInput = z.output<typeof bulkActionSchema>;

export const bulkResultSchema = z.object({
  /** One entry per requested id, in order; an item that could not change says why (a gate, a state). */
  results: z.array(z.object({ id, ok: z.boolean(), code: z.string().optional() })),
});

export const reviewInboxQuerySchema = cursorQuerySchema.extend({
  categoryId: id.optional(),
  mine: z.coerce.boolean().optional(),
});

// ---------------------------------------------------------------------------------------------
// Admin: taxonomy, people, redirects
// ---------------------------------------------------------------------------------------------

const slugOrNull = contentSlugSchema.nullable();

export const categoryInputSchema = z.object({
  parentId: id.nullable().default(null),
  slugAr: contentSlugSchema,
  slugEn: slugOrNull.default(null),
  nameAr: z.string().trim().min(1).max(100),
  nameEn: nullableText(100).default(null),
  descriptionAr: z.string().trim().max(2000).default(""),
  descriptionEn: z.string().trim().max(2000).default(""),
  requiresMedicalReview: z.boolean().default(true),
  defaultReviewerId: id.nullable().default(null),
  seoTitleAr: z.string().trim().max(CONTENT_LIMITS.metaTitleMax).default(""),
  seoDescriptionAr: z.string().trim().max(CONTENT_LIMITS.metaDescriptionMax).default(""),
  seoTitleEn: z.string().trim().max(CONTENT_LIMITS.metaTitleMax).default(""),
  seoDescriptionEn: z.string().trim().max(CONTENT_LIMITS.metaDescriptionMax).default(""),
  sort: z.number().int().min(0).max(100_000).default(0),
});
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const categorySchema = categoryInputSchema.extend({ id, itemCount: z.number().int() });
export type Category = z.output<typeof categorySchema>;

export const reorderCategoriesSchema = z.object({
  /** The full ordered list of sibling ids under one parent (null = top level). */
  parentId: id.nullable(),
  ids: z.array(id).min(1).max(200),
});

export const tagInputSchema = z.object({
  slugAr: slugOrNull.default(null),
  slugEn: slugOrNull.default(null),
  nameAr: z.string().trim().min(1).max(100),
  nameEn: nullableText(100).default(null),
  descriptionAr: z.string().trim().max(2000).default(""),
  descriptionEn: z.string().trim().max(2000).default(""),
});
export type TagInput = z.output<typeof tagInputSchema>;
export const tagSchema = tagInputSchema.extend({ id, itemCount: z.number().int() });
export type Tag = z.output<typeof tagSchema>;
export const mergeTagsSchema = z.object({ fromId: id, intoId: id });

export const personInputSchema = z.object({
  slug: contentSlugSchema,
  nameAr: z.string().trim().min(1).max(120),
  nameEn: nullableText(120).default(null),
  role: z.enum(PERSON_ROLES),
  credentialsAr: z.string().trim().max(400).default(""),
  credentialsEn: z.string().trim().max(400).default(""),
  licenceNumber: nullableText(60).default(null),
  showLicence: z.boolean().default(false),
  bioMdAr: z.string().trim().max(5000).default(""),
  bioMdEn: z.string().trim().max(5000).default(""),
  photoMediaId: id.nullable().default(null),
  sameAs: z
    .array(z.url({ protocol: /^https$/ }))
    .max(8)
    .default([]),
  /** Links the profile to an account: a reviewer can only approve when their account is linked. */
  userId: id.nullable().default(null),
  active: z.boolean().default(true),
});
export type PersonInput = z.output<typeof personInputSchema>;
export const personSchema = personInputSchema.extend({ id, itemCount: z.number().int() });
export type Person = z.output<typeof personSchema>;

export const redirectInputSchema = z.object({
  fromPath: sitePathSchema,
  toPath: sitePathSchema,
  reason: z.enum(REDIRECT_REASONS).default("manual"),
});
export type RedirectInput = z.output<typeof redirectInputSchema>;
export const redirectSchema = redirectInputSchema.extend({ id, createdAt: isoInstant });
export const redirectTestQuerySchema = z.object({ path: sitePathSchema });
export const redirectTestResponseSchema = z.object({
  /** Where a request for `path` ends up; `chain` lists every hop (more than one hop = a chain to fix). */
  finalPath: sitePathSchema.nullable(),
  chain: z.array(sitePathSchema),
  loop: z.boolean(),
});

// Additive (API-1b): list envelopes, the editor option lists, the review inbox row and link suggestions.

export const categoryListResponseSchema = z.object({ items: z.array(categorySchema) });
export const tagListResponseSchema = z.object({ items: z.array(tagSchema) });
export const personListResponseSchema = z.object({ items: z.array(personSchema) });

export const redirectListQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
});
export const redirectListResponseSchema = z.object({
  items: z.array(redirectSchema),
  nextCursor: z.string().nullable(),
});

/** `GET /admin/content/options`: small lists for the editor's pickers, one round trip. */
export const contentOptionsSchema = z.object({
  categories: z.array(
    z.object({
      id,
      parentId: id.nullable(),
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      slugAr: z.string(),
      slugEn: z.string().nullable(),
      requiresMedicalReview: z.boolean(),
      defaultReviewer: personRefSchema.nullable(),
    }),
  ),
  tags: z.array(
    z.object({
      id,
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      slugAr: z.string().nullable(),
      slugEn: z.string().nullable(),
    }),
  ),
  authors: z.array(personRefSchema.extend({ nameEn: z.string().nullable() })),
  reviewers: z.array(personRefSchema.extend({ nameEn: z.string().nullable() })),
});
export type ContentOptions = z.output<typeof contentOptionsSchema>;

export const reviewInboxItemSchema = z.object({
  id,
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  slug: z.string(),
  title: z.string(),
  category: namedRefSchema.nullable(),
  author: personRefSchema.nullable(),
  reviewer: personRefSchema.nullable(),
  submittedAt: isoInstant,
  /** Whole hours since submission. */
  ageHours: z.number().int(),
  /** Words added/removed since the last approved revision (all words are "added" for a first review). */
  diffStats: z.object({ added: z.number().int(), removed: z.number().int() }),
  /** Another revision was approved before: the reviewer only needs to read the diff. */
  hasApprovedBefore: z.boolean(),
});
export type ReviewInboxItem = z.output<typeof reviewInboxItemSchema>;
export const reviewInboxResponseSchema = z.object({
  items: z.array(reviewInboxItemSchema),
  nextCursor: z.string().nullable(),
});

export const linkSuggestionsQuerySchema = z.object({
  itemId: id,
  q: z.string().trim().min(1).max(100),
  locale: contentLocaleSchema,
});
export const linkSuggestionsResponseSchema = z.object({
  items: z
    .array(z.object({ title: z.string(), path: sitePathSchema, type: contentTypeSchema }))
    .max(8),
});

// ---------------------------------------------------------------------------------------------
// Public read API (`/public/content/*`): what the web app caches with tags and renders
// ---------------------------------------------------------------------------------------------

export const publicImageSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  focalX: z.number().int(),
  focalY: z.number().int(),
  blurDataUrl: z.string().nullable(),
  variants: z.array(mediaVariantSchema),
  alt: z.string(),
  caption: z.string().nullable(),
  credit: z.string().nullable(),
});
export type PublicImage = z.output<typeof publicImageSchema>;

export const publicPersonSchema = z.object({
  slug: z.string(),
  name: z.string(),
  credentials: z.string(),
  path: sitePathSchema,
  photo: publicImageSchema.nullable(),
});
export type PublicPerson = z.output<typeof publicPersonSchema>;

export const publicTaxonRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  path: sitePathSchema,
});

export const publicItemCardSchema = z.object({
  id,
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  slug: z.string(),
  path: sitePathSchema,
  title: z.string(),
  excerpt: z.string(),
  definition: z.string(),
  publishedAt: isoInstant,
  contentUpdatedAt: isoInstant,
  readingMinutes: z.number().int(),
  category: publicTaxonRefSchema.nullable(),
  author: z.object({ name: z.string(), path: sitePathSchema }).nullable(),
  image: publicImageSchema.nullable(),
});
export type PublicItemCard = z.output<typeof publicItemCardSchema>;

export const publicItemSchema = publicItemCardSchema.extend({
  bodyHtml: z.string(),
  toc: z.array(tocEntrySchema),
  wordCount: z.number().int(),
  firstPublishedAt: isoInstant,
  tags: z.array(publicTaxonRefSchema),
  author: publicPersonSchema.nullable(),
  reviewer: publicPersonSchema
    .extend({ reviewedAt: isoInstant, licence: z.string().nullable() })
    .nullable(),
  corrections: z.array(z.object({ summary: z.string(), at: isoInstant })),
  seo: z.object({
    title: z.string(),
    description: z.string(),
    canonical: z.string().nullable(),
    robots: z.enum(["index", "noindex"]),
    ogTitle: z.string(),
    ogDescription: z.string(),
    ogImage: publicImageSchema.nullable(),
  }),
  flags: contentFlagsSchema,
  /** Counterpart paths for hreflang; only locales where a published twin exists. */
  alternates: z.object({ ar: sitePathSchema.nullable(), en: sitePathSchema.nullable() }),
  related: z.array(publicItemCardSchema),
});
export type PublicItem = z.output<typeof publicItemSchema>;

/** `GET /public/content/resolve`: one round trip answers 200 / 301 / 410 / 404 for a path. */
export const publicResolveQuerySchema = z.object({
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  slug: z
    .string()
    .trim()
    .min(1)
    .max(CONTENT_SLUG_MAX * 2),
});
export const publicResolveResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item"), item: publicItemSchema }),
  z.object({ kind: z.literal("redirect"), to: sitePathSchema }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("not_found") }),
]);
export type PublicResolveResponse = z.output<typeof publicResolveResponseSchema>;

export const publicListQuerySchema = z.object({
  type: contentTypeSchema,
  locale: contentLocaleSchema,
  categorySlug: z.string().trim().max(CONTENT_SLUG_MAX).optional(),
  tagSlug: z.string().trim().max(CONTENT_SLUG_MAX).optional(),
  authorSlug: z.string().trim().max(CONTENT_SLUG_MAX).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CONTENT_LIMITS.pageSizeMax).default(12),
});
export type PublicListQuery = z.output<typeof publicListQuerySchema>;

export const publicListResponseSchema = z.object({
  items: z.array(publicItemCardSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PublicListResponse = z.output<typeof publicListResponseSchema>;

/** Category / tag / author landing data: the entity, an intro and whether it may be indexed. */
export const publicTaxonomyPageQuerySchema = z.object({
  kind: z.enum(["category", "tag", "author"]),
  locale: contentLocaleSchema,
  slug: z.string().trim().min(1).max(CONTENT_SLUG_MAX),
});
export const publicTaxonomyPageSchema = z.object({
  kind: z.enum(["category", "tag", "author"]),
  slug: z.string(),
  name: z.string(),
  path: sitePathSchema,
  /** Markdown-free plain intro for categories/tags; sanitised HTML for people (`bio`). */
  introHtml: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  /** Tag pages are indexable only with enough posts and an intro (SEO-GEO §2). */
  indexable: z.boolean(),
  itemCount: z.number().int(),
  person: publicPersonSchema
    .extend({ sameAs: z.array(z.string()), bioHtml: z.string() })
    .nullable(),
  alternates: z.object({ ar: sitePathSchema.nullable(), en: sitePathSchema.nullable() }),
});
export type PublicTaxonomyPage = z.output<typeof publicTaxonomyPageSchema>;

export const publicTaxonomyListQuerySchema = z.object({
  kind: z.enum(["category", "tag", "author"]),
  locale: contentLocaleSchema,
});
export const publicTaxonomyListSchema = z.object({
  items: z.array(publicTaxonRefSchema.extend({ itemCount: z.number().int() })),
});

/** Glossary hub: every published entry, compact (hundreds, not thousands). */
export const publicGlossaryIndexSchema = z.object({
  items: z.array(
    z.object({ slug: z.string(), path: sitePathSchema, term: z.string(), definition: z.string() }),
  ),
});

/** The small maps the web proxy keeps in memory to answer 301 and 410 without rendering a page. */
export const publicPathStateSchema = z.object({
  redirects: z.record(z.string(), sitePathSchema),
  gone: z.array(sitePathSchema),
});
export type PublicPathState = z.output<typeof publicPathStateSchema>;

export const publicSitemapQuerySchema = z.object({
  kind: z.enum(["article", "guide", "glossary", "page", "category", "tag", "author"]),
  locale: contentLocaleSchema,
  page: z.coerce.number().int().min(1).default(1),
});
export const publicSitemapResponseSchema = z.object({
  /** At most 10,000 per page; `hasMore` says to ask for the next one. */
  urls: z.array(
    z.object({
      path: sitePathSchema,
      lastmod: isoInstant,
      alternates: z.object({ ar: sitePathSchema.nullable(), en: sitePathSchema.nullable() }),
      image: z.object({ url: z.string(), alt: z.string() }).nullable(),
    }),
  ),
  hasMore: z.boolean(),
});

/** `GET /public/content/preview/:token`: a draft or a revision rendered through the real template. */
export const publicPreviewResponseSchema = z.object({
  item: publicItemSchema,
  expiresAt: isoInstant,
  /** Always true for a revision that is not the published one. */
  isDraft: z.boolean(),
});

// ---------------------------------------------------------------------------------------------
// Web cache revalidation (API/worker -> web, HMAC-signed; CONTENT-PLATFORM §4.3, WP3 security)
// ---------------------------------------------------------------------------------------------

/** Cache tags the web's data cache uses for content; the API sends these, the web only validates shape. */
export const CONTENT_CACHE_TAGS = {
  item: (id: string) => `content:item:${id}`,
  list: (type: string, locale: string) => `content:list:${type}:${locale}`,
  taxonomy: (locale: string) => `content:taxonomy:${locale}`,
  pathState: "content:path-state",
  glossary: (locale: string) => `content:glossary:${locale}`,
  sitemap: (kind: string) => `sitemap:${kind}`,
  feed: (locale: string) => `content:feed:${locale}`,
} as const;

/**
 * Payload of the outbox topic `content.changed` (CONTENT-PLATFORM §11.5). The API and the db publish
 * helpers write it in the business transaction; the worker drains it and derives the cache tags, the
 * IndexNow URLs and the sitemap kinds from it. `itemId` is null for changes that touch no single item
 * (`taxonomy`: a category/tag/person edit, `redirects`: a manual redirect edit). `paths` are the public
 * URLs that now exist or changed, `oldPaths` the ones that stopped being valid (a 301 or 410 from now on).
 */
export const CONTENT_CHANGE_KINDS = [
  "published",
  "unpublished",
  "updated",
  "archived",
  "moved",
  "taxonomy",
  "redirects",
] as const;
export const contentChangedPayloadSchema = z.object({
  itemId: id.nullable(),
  kind: z.enum(CONTENT_CHANGE_KINDS),
  paths: z.array(sitePathSchema).max(100).default([]),
  oldPaths: z.array(sitePathSchema).max(100).default([]),
});
export type ContentChangedPayload = z.output<typeof contentChangedPayloadSchema>;
/** Outbox topic name, one constant for the writers (api, db helpers) and the reader (worker). */
export const CONTENT_CHANGED_TOPIC = "content.changed";

export const REVALIDATE_MAX_TAGS = 50;
export const REVALIDATE_WINDOW_SECONDS = 300;

export const revalidateRequestSchema = z.object({
  tags: z
    .array(z.string().regex(/^[a-z0-9:_.-]{1,120}$/))
    .min(1)
    .max(REVALIDATE_MAX_TAGS),
  /** Unix seconds when the request was signed; older than the window is a replay and is refused. */
  timestamp: z.number().int(),
});
export type RevalidateRequest = z.output<typeof revalidateRequestSchema>;
