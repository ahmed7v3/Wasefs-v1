import { z } from "zod";

import { CONTENT_LOCALES } from "../content/constants.js";
import { PUBLISHING_CONTENT_TYPES, PUBLISHING_DEFAULTS } from "../publishing.js";

import { MEDIA_LICENCES } from "./media.js";

/*
 * The wire contract of the Publishing API (docs/PUBLISHING-API.md §4 and §7): snake_case JSON in and
 * out. These schemas validate the requests AND generate the OpenAPI document, so the spec cannot drift
 * from the code. Inputs are strict: an AI agent that misspells a field (`bodyMarkdown`) is told, instead
 * of having it silently dropped.
 */

export const PUBLISHING_DESIRED_STATUSES = [
  "draft",
  "in_review",
  "scheduled",
  "published",
] as const;
export type PublishingDesiredStatus = (typeof PUBLISHING_DESIRED_STATUSES)[number];

/** Statuses a response can show: the working copy's status (`approved` = reviewed, not yet live). */
export const PUBLISHING_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;

export const PUBLISHING_EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const PUBLISHING_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PUBLISHING_TAGS_MAX = 10;
export const PUBLISHING_SCHEDULE_MIN_MINUTES = 5;
export const PUBLISHING_SCHEDULE_MAX_DAYS = 365;

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

/** The title contains Arabic letters: the API cannot derive a Latin slug from it (no transliteration in v1). */
export function titleIsArabic(title: string): boolean {
  return ARABIC_LETTER.test(title);
}

export const SLUG_REQUIRED_MESSAGE =
  "Arabic titles need an explicit English slug (a-z, 0-9 and hyphens, 3-80 characters): this API does not transliterate.";

const externalId = z
  .string()
  .regex(PUBLISHING_EXTERNAL_ID_PATTERN, "1-128 chars of A-Z a-z 0-9 . _ : -");
const instant = z.iso.datetime({ offset: true });
const mediaId = z.uuid();

const slug = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(PUBLISHING_SLUG_PATTERN, "lower-case a-z, 0-9 and single hyphens");

const markdownBytes = (value: string): boolean =>
  new TextEncoder().encode(value).length <= PUBLISHING_DEFAULTS.maxMarkdownBytes;

export const publishingSourceSchema = z.strictObject({
  title: z.string().trim().min(3).max(200),
  url: z
    .string()
    .trim()
    .max(500)
    .pipe(z.url({ protocol: /^https$/, error: "must be an https URL" })),
  publisher: z.string().trim().min(1).max(120).optional(),
  accessed_at: z.union([z.iso.date(), instant]).optional(),
});
export type PublishingSource = z.output<typeof publishingSourceSchema>;

export const publishingSeoSchema = z.strictObject({
  title: z.string().trim().max(120),
  description: z.string().trim().max(320),
  focus_keyword: z.string().trim().max(120),
  secondary_keywords: z.array(z.string().trim().min(1).max(120)).max(10),
  /** Only honoured for keys allowed to set it; otherwise the server ignores it with a note. */
  canonical_url: z.string().trim().max(500),
  robots: z.enum(["index", "noindex"]),
  og_title: z.string().trim().max(120),
  og_description: z.string().trim().max(320),
  og_media_id: mediaId,
});
export type PublishingSeo = z.output<typeof publishingSeoSchema>;

export const publishingFlagsSchema = z.strictObject({
  auto_link: z.boolean(),
  show_toc: z.boolean(),
  show_related: z.boolean(),
});

/** Merge-patch form of `seo`: null clears a field. */
const seoPatch = z.strictObject({
  title: publishingSeoSchema.shape.title.nullable().optional(),
  description: publishingSeoSchema.shape.description.nullable().optional(),
  focus_keyword: publishingSeoSchema.shape.focus_keyword.nullable().optional(),
  secondary_keywords: publishingSeoSchema.shape.secondary_keywords.nullable().optional(),
  canonical_url: publishingSeoSchema.shape.canonical_url.nullable().optional(),
  robots: publishingSeoSchema.shape.robots.nullable().optional(),
  og_title: publishingSeoSchema.shape.og_title.nullable().optional(),
  og_description: publishingSeoSchema.shape.og_description.nullable().optional(),
  og_media_id: publishingSeoSchema.shape.og_media_id.nullable().optional(),
});

/** Fields of an article as an integrator sends them. Required-ness is applied by the create/patch schemas. */
const fields = {
  type: z.enum(PUBLISHING_CONTENT_TYPES),
  locale: z.enum(CONTENT_LOCALES),
  translation_of: z.string().trim().min(1).max(128),
  title: z.string().trim().min(2).max(110),
  slug,
  excerpt: z.string().trim().max(300),
  body_markdown: z
    .string()
    .refine(markdownBytes, `at most ${String(PUBLISHING_DEFAULTS.maxMarkdownBytes)} bytes`),
  definition: z.string().trim().max(300),
  category: z.string().trim().min(1).max(120),
  tags: z.array(z.string().trim().min(1).max(100)).max(PUBLISHING_TAGS_MAX),
  author: z.string().trim().min(1).max(120),
  reviewer: z.string().trim().min(1).max(120),
  featured_media_id: mediaId,
  seo: publishingSeoSchema.partial(),
  sources: z.array(publishingSourceSchema).max(30),
  ai_assisted: z.boolean(),
  flags: publishingFlagsSchema.partial(),
  desired_status: z.enum(PUBLISHING_DESIRED_STATUSES),
  scheduled_at: instant,
  publish_on_approval: z.boolean(),
};

/** Length rules that depend on the type: glossary entries are short by nature. */
function typeRules(
  value: { type?: string | undefined; title?: string | undefined; excerpt?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  const glossary = value.type === "glossary";
  if (value.title !== undefined && !glossary && value.title.length < 10) {
    ctx.addIssue({ code: "custom", path: ["title"], message: "title must be 10-110 characters" });
  }
  if (
    value.excerpt !== undefined &&
    value.excerpt !== "" &&
    !glossary &&
    value.excerpt.length < 50
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["excerpt"],
      message: "excerpt must be 50-300 characters",
    });
  }
}

/** `POST /articles`, `PUT /articles/by-external-id/{id}`, `POST /articles/validate`. */
export const publishingArticleInputSchema = z
  .strictObject({
    type: fields.type,
    locale: fields.locale,
    translation_of: fields.translation_of.optional(),
    external_id: externalId.optional(),
    title: fields.title,
    slug: fields.slug.optional(),
    excerpt: fields.excerpt.optional(),
    body_markdown: fields.body_markdown,
    definition: fields.definition.optional(),
    category: fields.category.optional(),
    tags: fields.tags.optional(),
    author: fields.author.optional(),
    reviewer: fields.reviewer.optional(),
    featured_media_id: fields.featured_media_id.optional(),
    seo: fields.seo.optional(),
    sources: fields.sources.optional(),
    ai_assisted: fields.ai_assisted.optional(),
    flags: fields.flags.optional(),
    desired_status: fields.desired_status.default("draft"),
    scheduled_at: fields.scheduled_at.optional(),
    publish_on_approval: fields.publish_on_approval.optional(),
  })
  .superRefine((value, ctx) => {
    typeRules(value, ctx);
    if (value.type !== "glossary" && (value.excerpt === undefined || value.excerpt === "")) {
      ctx.addIssue({
        code: "custom",
        path: ["excerpt"],
        message: "excerpt is required (50-300 characters)",
      });
    }
    if (value.type === "glossary" && (value.definition ?? "") === "") {
      ctx.addIssue({
        code: "custom",
        path: ["definition"],
        message: "definition is required for glossary entries",
      });
    }
    if (value.slug === undefined && titleIsArabic(value.title)) {
      ctx.addIssue({ code: "custom", path: ["slug"], message: SLUG_REQUIRED_MESSAGE });
    }
    if (value.desired_status === "scheduled" && value.scheduled_at === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_at"],
        message: "scheduled_at is required with desired_status scheduled",
      });
    }
  });
export type PublishingArticleInput = z.output<typeof publishingArticleInputSchema>;

/**
 * `PATCH /articles/{id}` (JSON Merge Patch): a present key replaces, `null` clears where clearing is
 * meaningful, an absent key is untouched. `type` and `locale` cannot change.
 */
export const publishingArticlePatchSchema = z
  .strictObject({
    title: fields.title.optional(),
    slug: fields.slug.optional(),
    excerpt: fields.excerpt.optional(),
    body_markdown: fields.body_markdown.optional(),
    definition: fields.definition.optional(),
    category: fields.category.nullable().optional(),
    tags: fields.tags.optional(),
    author: fields.author.nullable().optional(),
    reviewer: fields.reviewer.nullable().optional(),
    featured_media_id: fields.featured_media_id.nullable().optional(),
    seo: seoPatch.optional(),
    sources: fields.sources.optional(),
    ai_assisted: fields.ai_assisted.optional(),
    flags: fields.flags.optional(),
    desired_status: fields.desired_status.optional(),
    scheduled_at: fields.scheduled_at.optional(),
    publish_on_approval: fields.publish_on_approval.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.title !== undefined && value.title.length < 2) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "title is too short" });
    }
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: "custom", path: [], message: "nothing to change" });
    }
    if (value.desired_status === "scheduled" && value.scheduled_at === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_at"],
        message: "scheduled_at is required with desired_status scheduled",
      });
    }
  });
export type PublishingArticlePatch = z.output<typeof publishingArticlePatchSchema>;

export const publishingSubmitBodySchema = z.strictObject({}).default({});

export const publishingPublishBodySchema = z
  .strictObject({ publish_on_approval: z.boolean().optional() })
  .default({});

export const publishingScheduleBodySchema = z.strictObject({ scheduled_at: instant });

export const publishingDeleteQuerySchema = z.object({
  /** Site-relative path: a published item then 301s there instead of answering 410. */
  redirect_to: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^\/(?!\/)[^\s\\]*$/, "site-relative path")
    .optional(),
});

export const publishingListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  status: z.enum(PUBLISHING_STATUSES).optional(),
  type: z.enum(PUBLISHING_CONTENT_TYPES).optional(),
  locale: z.enum(CONTENT_LOCALES).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  updated_since: instant.optional(),
  external_id: externalId.optional(),
});
export type PublishingListQuery = z.output<typeof publishingListQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const publishingQualityIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type PublishingQualityIssue = z.output<typeof publishingQualityIssueSchema>;

export const publishingQualitySchema = z.object({
  /** Failing gates that stop publishing: fix every one before asking to publish. */
  blocking: z.array(publishingQualityIssueSchema),
  warnings: z.array(publishingQualityIssueSchema),
});

export const publishingArticleSchema = z.object({
  id: z.uuid(),
  external_id: z.string().nullable(),
  type: z.enum(PUBLISHING_CONTENT_TYPES),
  locale: z.enum(CONTENT_LOCALES),
  title: z.string(),
  slug: z.string(),
  status: z.enum(PUBLISHING_STATUSES),
  /** Revision number of the working copy; the ETag. */
  revision: z.number().int(),
  /** Some version of the item is public. `status` is about the working copy. */
  live: z.boolean(),
  /** Absolute public URL while live, else null. */
  url: z.string().nullable(),
  preview_url: z.string().nullable(),
  published_at: z.string().nullable(),
  updated_at: z.string(),
  scheduled_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  quality: publishingQualitySchema,
  word_count: z.number().int(),
  publish_on_approval: z.boolean(),
  /** Why the result differs from what was asked (key cannot publish, review needed, ...). */
  notes: z.array(z.string()),
  created: z.boolean(),
});
export type PublishingArticle = z.output<typeof publishingArticleSchema>;

export const publishingArticleListSchema = z.object({
  items: z.array(publishingArticleSchema.omit({ preview_url: true, notes: true, created: true })),
  next_cursor: z.string().nullable(),
});

export const publishingValidationSchema = z.object({
  valid: z.boolean(),
  quality: publishingQualitySchema,
  word_count: z.number().int(),
  /** Sanitised HTML exactly as it would render. */
  html_preview: z.string(),
  resolved: z.object({
    slug: z.string(),
    requires_medical_review: z.boolean(),
    would_become: z.enum(PUBLISHING_STATUSES),
    notes: z.array(z.string()),
  }),
});

export const publishingRevisionSchema = z.object({
  number: z.number().int(),
  kind: z.string(),
  created_at: z.string(),
  created_by: z.enum(["user", "api_key", "system"]),
  is_approved: z.boolean(),
  is_published: z.boolean(),
});
export const publishingRevisionListSchema = z.object({ items: z.array(publishingRevisionSchema) });

// ---------------------------------------------------------------------------------------------
// Media, taxonomy, people
// ---------------------------------------------------------------------------------------------

const mediaMeta = {
  alt: z.string().trim().min(1).max(300).optional(),
  alt_en: z.string().trim().min(1).max(300).optional(),
  decorative: z.boolean().optional(),
  caption: z.string().trim().max(300).optional(),
  credit: z.string().trim().max(200).optional(),
  licence: z.enum(MEDIA_LICENCES).optional(),
  licence_ref: z.string().trim().max(300).optional(),
  filename_hint: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(PUBLISHING_SLUG_PATTERN, "lower-case ascii words joined by hyphens")
    .optional(),
  focal_point: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional(),
};

/** Alt text is required unless the image is decorative (the content gate would block publishing without it). */
function altRule(
  value: {
    alt?: string | undefined;
    alt_en?: string | undefined;
    decorative?: boolean | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.decorative !== true && value.alt === undefined && value.alt_en === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["alt"],
      message: "alt is required unless decorative is true",
    });
  }
}

export const publishingMediaFetchSchema = z
  .strictObject({
    source_url: z.string().trim().max(2000),
    ...mediaMeta,
  })
  .superRefine(altRule);
export type PublishingMediaFetch = z.output<typeof publishingMediaFetchSchema>;

/** Text fields of the multipart upload (the file itself is the `file` part). */
export const publishingMediaFieldsSchema = z.strictObject(mediaMeta).superRefine(altRule);
export type PublishingMediaFields = z.output<typeof publishingMediaFieldsSchema>;

export const publishingMediaPatchSchema = z
  .strictObject({ ...mediaMeta })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "nothing to change" });

export const publishingMediaSchema = z.object({
  id: z.uuid(),
  status: z.enum(["processing", "ready", "rejected"]),
  deduplicated: z.boolean().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  mime: z.string().nullable().optional(),
  alt: z.string().nullable().optional(),
  alt_en: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  credit: z.string().nullable().optional(),
  licence: z.string().optional(),
  reject_reason: z.string().nullable().optional(),
});

export const publishingCategorySchema = z.object({
  id: z.uuid(),
  /** The Arabic-site slug; `slug_en` is the English-site one. Either is accepted in requests. */
  slug: z.string(),
  slug_en: z.string().nullable(),
  name_ar: z.string(),
  name_en: z.string().nullable(),
  parent_slug: z.string().nullable(),
  requires_medical_review: z.boolean(),
});
export const publishingCategoryInputSchema = z.strictObject({
  slug: slug,
  name_ar: z.string().trim().min(1).max(100),
  name_en: z.string().trim().min(1).max(100).optional(),
  parent: z.string().trim().min(1).max(120).optional(),
});

export const publishingTagSchema = z.object({
  id: z.uuid(),
  slug: z.string().nullable(),
  name_ar: z.string(),
  name_en: z.string().nullable(),
});
export const publishingTagInputSchema = z.strictObject({
  name_ar: z.string().trim().min(1).max(100),
  name_en: z.string().trim().min(1).max(100).optional(),
  slug: slug.optional(),
});

export const publishingPersonSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name_ar: z.string(),
  name_en: z.string().nullable(),
  role: z.enum(["author", "reviewer", "both"]),
});

export const publishingIdParamSchema = z.object({ id: z.uuid() });
export const publishingExternalIdParamSchema = z.object({ external_id: externalId });

/** The platform error body, as documented to integrators. */
export const publishingErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  ref: z.string().optional(),
});
