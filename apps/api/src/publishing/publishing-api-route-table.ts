import {
  publishingArticleInputSchema,
  publishingArticleListSchema,
  publishingArticlePatchSchema,
  publishingArticleSchema,
  publishingCategoryInputSchema,
  publishingCategorySchema,
  publishingDeleteQuerySchema,
  publishingListQuerySchema,
  publishingMediaFetchSchema,
  publishingMediaFieldsSchema,
  publishingMediaPatchSchema,
  publishingMediaSchema,
  publishingPersonSchema,
  publishingPublishBodySchema,
  publishingRevisionListSchema,
  publishingScheduleBodySchema,
  publishingSubmitBodySchema,
  publishingTagInputSchema,
  publishingTagSchema,
  publishingValidationSchema,
} from "@wasfa/shared/schemas/publishing";
import { z } from "zod";

import type { PublishingScope } from "@wasfa/shared/publishing";

/*
 * The single list of Publishing API routes. The OpenAPI document and the agent guide are generated from
 * / checked against it, and a test compares it with the routes the Nest controllers really register
 * (method + path), so the spec, the guide and the code cannot drift apart.
 */

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDef {
  method: HttpMethod;
  /** Relative to `/publishing/v1`, OpenAPI style (`/articles/{id}`). */
  path: string;
  /** Scope the key needs; `null` for a route any valid key may call, or a public one. */
  scope: PublishingScope | null;
  auth: "key" | "public";
  /** `Idempotency-Key` is required. */
  idempotent: boolean;
  /** Accepts `If-Match: "<revision>"`. */
  ifMatch?: boolean;
  summary: string;
  tag: "Articles" | "Media" | "Taxonomy" | "Meta";
  body?: z.ZodType;
  /** `multipart/form-data`: a `file` part plus these text fields. */
  multipart?: z.ZodType;
  query?: z.ZodType;
  success: { status: number; schema?: z.ZodType; contentType?: string; description: string };
  /** Defined outside this module (the key slice); listed so the spec is complete. */
  externalOwner?: "keys";
}

const articleResponse = (status: number, description: string) => ({
  status,
  schema: publishingArticleSchema,
  description,
});

export const PUBLISHING_ROUTES: readonly RouteDef[] = [
  {
    method: "get",
    path: "/me",
    scope: null,
    auth: "key",
    idempotent: false,
    summary: "The calling key: name, scopes, can_publish, limits and today's remaining caps.",
    tag: "Meta",
    success: {
      status: 200,
      schema: z.looseObject({}),
      description: "Key details",
    },
    externalOwner: "keys",
  },
  {
    method: "get",
    path: "/openapi.json",
    scope: null,
    auth: "public",
    idempotent: false,
    summary: "This OpenAPI 3.1 document (public, cached 5 minutes).",
    tag: "Meta",
    success: { status: 200, schema: z.looseObject({}), description: "The OpenAPI document" },
  },
  {
    method: "get",
    path: "/guide",
    scope: null,
    auth: "public",
    idempotent: false,
    summary: "The agent guide: read this first (public, Markdown, cached 5 minutes).",
    tag: "Meta",
    success: {
      status: 200,
      contentType: "text/markdown",
      description: "Instructions for an AI agent",
    },
  },
  {
    method: "post",
    path: "/articles",
    scope: "content:write",
    auth: "key",
    idempotent: true,
    summary: "Create an article, guide or glossary entry (Idempotency-Key required).",
    tag: "Articles",
    body: publishingArticleInputSchema,
    success: articleResponse(
      201,
      "Created (status shows what the workflow did with desired_status)",
    ),
  },
  {
    method: "post",
    path: "/articles/validate",
    scope: "content:write",
    auth: "key",
    idempotent: false,
    summary: "Dry run: schema, quality gates and the rendered HTML; writes nothing.",
    tag: "Articles",
    body: publishingArticleInputSchema,
    success: { status: 200, schema: publishingValidationSchema, description: "Validation result" },
  },
  {
    method: "put",
    path: "/articles/by-external-id/{external_id}",
    scope: "content:write",
    auth: "key",
    idempotent: false,
    ifMatch: true,
    summary: "Create or update the article with YOUR id (recommended write; safe to repeat).",
    tag: "Articles",
    body: publishingArticleInputSchema,
    success: articleResponse(200, "Updated (201 when it was created)"),
  },
  {
    method: "get",
    path: "/articles",
    scope: "content:read",
    auth: "key",
    idempotent: false,
    summary:
      "List this key's articles (and published ones), newest update first, cursor paginated.",
    tag: "Articles",
    query: publishingListQuerySchema,
    success: {
      status: 200,
      schema: publishingArticleListSchema,
      description: "A page of articles",
    },
  },
  {
    method: "get",
    path: "/articles/{id}",
    scope: "content:read",
    auth: "key",
    idempotent: false,
    summary: "Read one article's status, quality and URLs.",
    tag: "Articles",
    success: articleResponse(200, "The article (ETag header = revision)"),
  },
  {
    method: "patch",
    path: "/articles/{id}",
    scope: "content:write",
    auth: "key",
    idempotent: false,
    ifMatch: true,
    summary: "Partial update (JSON Merge Patch: null clears a field).",
    tag: "Articles",
    body: publishingArticlePatchSchema,
    success: articleResponse(200, "Updated"),
  },
  {
    method: "post",
    path: "/articles/{id}/submit",
    scope: "content:write",
    auth: "key",
    idempotent: false,
    ifMatch: true,
    summary: "Send to medical review.",
    tag: "Articles",
    body: publishingSubmitBodySchema,
    success: articleResponse(200, "Submitted (status in_review)"),
  },
  {
    method: "post",
    path: "/articles/{id}/publish",
    scope: "content:publish",
    auth: "key",
    idempotent: false,
    ifMatch: true,
    summary:
      "Publish now, if review, quality gates and caps allow; the response status is the truth.",
    tag: "Articles",
    body: publishingPublishBodySchema,
    success: articleResponse(
      200,
      "Status published, in_review (needs a reviewer) or draft (with notes)",
    ),
  },
  {
    method: "post",
    path: "/articles/{id}/schedule",
    scope: "content:publish",
    auth: "key",
    idempotent: false,
    ifMatch: true,
    summary: "Schedule publication (5 minutes to 365 days ahead).",
    tag: "Articles",
    body: publishingScheduleBodySchema,
    success: articleResponse(200, "Scheduled"),
  },
  {
    method: "post",
    path: "/articles/{id}/unpublish",
    scope: "content:publish",
    auth: "key",
    idempotent: false,
    summary: "Take a live article down (back to draft) or cancel a schedule.",
    tag: "Articles",
    success: articleResponse(200, "Unpublished"),
  },
  {
    method: "delete",
    path: "/articles/{id}",
    scope: "content:write",
    auth: "key",
    idempotent: false,
    summary:
      "Delete a never-published draft; archive anything else (410, or 301 with redirect_to).",
    tag: "Articles",
    query: publishingDeleteQuerySchema,
    success: {
      status: 200,
      schema: z.object({ id: z.uuid(), result: z.enum(["deleted", "archived"]) }),
      description: "Deleted or archived",
    },
  },
  {
    method: "get",
    path: "/articles/{id}/revisions",
    scope: "content:read",
    auth: "key",
    idempotent: false,
    summary: "Revision history (read only).",
    tag: "Articles",
    success: { status: 200, schema: publishingRevisionListSchema, description: "Revisions" },
  },
  {
    method: "post",
    path: "/media",
    scope: "media:write",
    auth: "key",
    idempotent: true,
    summary:
      "Upload an image (multipart `file`, JPEG/PNG/WebP/AVIF, 10 MB max; Idempotency-Key required).",
    tag: "Media",
    multipart: publishingMediaFieldsSchema,
    success: {
      status: 202,
      schema: publishingMediaSchema,
      description: "Accepted: poll GET /media/{id}",
    },
  },
  {
    method: "post",
    path: "/media/fetch",
    scope: "media:write",
    auth: "key",
    idempotent: true,
    summary: "Fetch an image from an https URL (SSRF-guarded; Idempotency-Key required).",
    tag: "Media",
    body: publishingMediaFetchSchema,
    success: {
      status: 202,
      schema: publishingMediaSchema,
      description: "Accepted: poll GET /media/{id}",
    },
  },
  {
    method: "get",
    path: "/media/{id}",
    scope: "media:write",
    auth: "key",
    idempotent: false,
    summary: "Media status (processing, ready, rejected) and metadata.",
    tag: "Media",
    success: { status: 200, schema: publishingMediaSchema, description: "The media" },
  },
  {
    method: "patch",
    path: "/media/{id}",
    scope: "media:write",
    auth: "key",
    idempotent: false,
    summary:
      "Set alt text, caption, credit, licence or focal point of an image this key's owner uploaded.",
    tag: "Media",
    body: publishingMediaPatchSchema,
    success: { status: 200, schema: publishingMediaSchema, description: "Updated" },
  },
  {
    method: "get",
    path: "/categories",
    scope: "content:read",
    auth: "key",
    idempotent: false,
    summary: "Categories (slug, names, whether they need medical review).",
    tag: "Taxonomy",
    success: {
      status: 200,
      schema: z.object({ items: z.array(publishingCategorySchema) }),
      description: "Categories",
    },
  },
  {
    method: "post",
    path: "/categories",
    scope: "taxonomy:write",
    auth: "key",
    idempotent: true,
    summary: "Create a category (always requires medical review; Idempotency-Key required).",
    tag: "Taxonomy",
    body: publishingCategoryInputSchema,
    success: { status: 201, schema: publishingCategorySchema, description: "Created" },
  },
  {
    method: "get",
    path: "/tags",
    scope: "content:read",
    auth: "key",
    idempotent: false,
    summary: "Tags.",
    tag: "Taxonomy",
    success: {
      status: 200,
      schema: z.object({ items: z.array(publishingTagSchema) }),
      description: "Tags",
    },
  },
  {
    method: "post",
    path: "/tags",
    scope: "taxonomy:write",
    auth: "key",
    idempotent: true,
    summary: "Create a tag (Idempotency-Key required).",
    tag: "Taxonomy",
    body: publishingTagInputSchema,
    success: { status: 201, schema: publishingTagSchema, description: "Created" },
  },
  {
    method: "get",
    path: "/people",
    scope: "people:read",
    auth: "key",
    idempotent: false,
    summary: "Authors and reviewers (id, slug, names, role).",
    tag: "Taxonomy",
    success: {
      status: 200,
      schema: z.object({ items: z.array(publishingPersonSchema) }),
      description: "People",
    },
  },
];

/** `GET /articles/{id}` as the guide and the logs name it. */
export const routeLabel = (route: Pick<RouteDef, "method" | "path">): string =>
  `${route.method.toUpperCase()} ${route.path}`;
