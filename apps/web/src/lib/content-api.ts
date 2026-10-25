import "server-only";

import {
  CONTENT_CACHE_TAGS,
  publicGlossaryIndexSchema,
  publicListResponseSchema,
  publicPathStateSchema,
  publicPreviewResponseSchema,
  publicResolveResponseSchema,
  publicSitemapResponseSchema,
  publicTaxonomyListSchema,
  publicTaxonomyPageSchema,
  type PublicListQuery,
  type PublicListResponse,
  type PublicPathState,
  type PublicResolveResponse,
  type PublicTaxonomyPage,
} from "@wasfa/shared/schemas/content";

import { publicEnv } from "./env";
import { serverEnv } from "./server-env";

import type { Locale } from "./locale";
import type { ContentType } from "@wasfa/shared/content/constants";
import type { z } from "zod";

/*
 * The web app's reader for the public content API (`/public/content/*`, CONTENT-PLATFORM §11.4/§11.5).
 * Every call goes through Next's data cache with tags, so a publish (signed `/api/revalidate`) refreshes
 * exactly what changed. Failure policy: an outage (network, timeout, 5xx, a body that does not parse)
 * THROWS, so the page answers 500 and crawlers retry; it must never be turned into a 404, which would
 * de-index live pages. Only an explicit "not found" answer becomes `null` / `{ kind: "not_found" }`.
 */

export type TaxonomyKind = "category" | "tag" | "author";
export type SitemapKind = "article" | "guide" | "glossary" | "page" | "category" | "tag" | "author";

export type PublicPreviewResponse = z.output<typeof publicPreviewResponseSchema>;
export type PublicTaxonomyList = z.output<typeof publicTaxonomyListSchema>;
export type PublicGlossaryIndex = z.output<typeof publicGlossaryIndexSchema>;
export type PublicSitemapResponse = z.output<typeof publicSitemapResponseSchema>;

/** The API answers in milliseconds; past this the page fails fast instead of hanging a render. */
export const CONTENT_API_TIMEOUT_MS = 3_000;
export const CONTENT_REVALIDATE_SECONDS = 3_600;

export class ContentApiError extends Error {
  constructor(
    readonly route: string,
    readonly reason: string,
  ) {
    super(`Content API ${route} failed: ${reason}`);
    this.name = "ContentApiError";
  }
}

interface FetchOptions {
  tags?: readonly string[];
  /** Skip the data cache (previews, the unbounded space of page paths). */
  noStore?: boolean;
  /** A 404 is an answer, not an outage. */
  notFoundIsNull?: boolean;
}

async function fetchContent<S extends z.ZodType>(
  route: string,
  params: Record<string, string | number | undefined>,
  schema: S,
  options: FetchOptions & { notFoundIsNull: true },
): Promise<z.output<S> | null>;
async function fetchContent<S extends z.ZodType>(
  route: string,
  params: Record<string, string | number | undefined>,
  schema: S,
  options?: FetchOptions,
): Promise<z.output<S>>;
async function fetchContent<S extends z.ZodType>(
  route: string,
  params: Record<string, string | number | undefined>,
  schema: S,
  options: FetchOptions = {},
): Promise<z.output<S> | null> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const qs = query.size > 0 ? `?${query.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`${serverEnv.API_INTERNAL_URL}/public/content/${route}${qs}`, {
      headers: { Accept: "application/json" },
      ...(options.noStore
        ? { cache: "no-store" as const }
        : {
            next: {
              revalidate: CONTENT_REVALIDATE_SECONDS,
              tags: [...(options.tags ?? [])],
            },
          }),
      signal: AbortSignal.timeout(CONTENT_API_TIMEOUT_MS),
    });
  } catch {
    throw new ContentApiError(route, "unreachable");
  }
  if (response.status === 404 && options.notFoundIsNull) return null;
  if (!response.ok) throw new ContentApiError(route, `status ${String(response.status)}`);
  const parsed = schema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) throw new ContentApiError(route, "unexpected body");
  return parsed.data;
}

const listTags = (type: ContentType, locale: Locale): string[] => [
  CONTENT_CACHE_TAGS.list(type, locale),
  CONTENT_CACHE_TAGS.taxonomy(locale),
];

/** One round trip answers item / redirect / gone / not_found for a slug. */
export function resolveContent(
  type: ContentType,
  locale: Locale,
  slug: string,
): Promise<PublicResolveResponse> {
  return fetchContent(
    "resolve",
    { type, locale, slug },
    publicResolveResponseSchema,
    // Pages own arbitrary top-level paths: an unbounded key space must not fill the data cache.
    type === "page"
      ? { noStore: true }
      : { tags: [...listTags(type, locale), CONTENT_CACHE_TAGS.pathState] },
  );
}

export function listContent(query: PublicListQuery): Promise<PublicListResponse> {
  return fetchContent(
    "list",
    {
      type: query.type,
      locale: query.locale,
      categorySlug: query.categorySlug,
      tagSlug: query.tagSlug,
      authorSlug: query.authorSlug,
      page: query.page,
      pageSize: query.pageSize,
    },
    publicListResponseSchema,
    {
      tags: [
        ...listTags(query.type, query.locale),
        ...(query.type === "article" ? [CONTENT_CACHE_TAGS.feed(query.locale)] : []),
      ],
    },
  );
}

export function getTaxonomyPage(
  kind: TaxonomyKind,
  locale: Locale,
  slug: string,
): Promise<PublicTaxonomyPage | null> {
  return fetchContent("taxonomy-page", { kind, locale, slug }, publicTaxonomyPageSchema, {
    tags: [CONTENT_CACHE_TAGS.taxonomy(locale)],
    notFoundIsNull: true,
  });
}

export function getTaxonomyList(kind: TaxonomyKind, locale: Locale): Promise<PublicTaxonomyList> {
  return fetchContent("taxonomy-list", { kind, locale }, publicTaxonomyListSchema, {
    tags: [CONTENT_CACHE_TAGS.taxonomy(locale)],
  });
}

export function getGlossaryIndex(locale: Locale): Promise<PublicGlossaryIndex> {
  return fetchContent("glossary-index", { locale }, publicGlossaryIndexSchema, {
    tags: [CONTENT_CACHE_TAGS.glossary(locale), CONTENT_CACHE_TAGS.list("glossary", locale)],
  });
}

/** A signed preview token → the draft rendered like a live item; `null` for an unknown or expired token. */
export function getPreview(token: string): Promise<PublicPreviewResponse | null> {
  return fetchContent(`preview/${encodeURIComponent(token)}`, {}, publicPreviewResponseSchema, {
    noStore: true,
    notFoundIsNull: true,
  });
}

/** The 301/410 maps the proxy answers from (kept in process for a minute by `lib/path-state.ts`). */
export function getPublicPathState(): Promise<PublicPathState> {
  return fetchContent("path-state", {}, publicPathStateSchema, {
    tags: [CONTENT_CACHE_TAGS.pathState],
  });
}

export function getSitemapPage(
  kind: SitemapKind,
  locale: Locale,
  page: number,
): Promise<PublicSitemapResponse> {
  return fetchContent("sitemap", { kind, locale, page }, publicSitemapResponseSchema, {
    tags: [CONTENT_CACHE_TAGS.sitemap(kind)],
  });
}

/**
 * Which content sections have at least one published entry in `locale`, for the navigation only: it
 * hides «المدونة» until there is something to read. An error answers "none" (a missing link is
 * harmless; throwing here would take every marketing page down with the API).
 */
export async function hasPublicContent(
  locale: Locale,
): Promise<{ blog: boolean; guides: boolean; glossary: boolean }> {
  try {
    const [blog, guides, glossary] = await Promise.all(
      (["article", "guide", "glossary"] as const).map((type) =>
        listContent({ type, locale, page: 1, pageSize: 1 }),
      ),
    );
    return {
      blog: (blog?.total ?? 0) > 0,
      guides: (guides?.total ?? 0) > 0,
      glossary: (glossary?.total ?? 0) > 0,
    };
  } catch {
    return { blog: false, guides: false, glossary: false };
  }
}

/** Public URL of a published media object (`media/<sha256>/<width>.<ext>`); "" while no origin is configured. */
export function mediaUrl(key: string): string {
  const origin = publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN;
  return origin ? `${origin.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}` : "";
}
