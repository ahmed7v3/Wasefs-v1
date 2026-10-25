import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { contentPath } from "@wasfa/shared/content";
import { verifyPreviewToken } from "@wasfa/shared/content/preview-token";
import { renderContent } from "@wasfa/shared/content/render";
import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { sitePathSchema } from "@wasfa/shared/schemas/content";

import { LocalCache } from "../../common/local-cache.js";
import { API_ENV } from "../../config/config.module.js";

import {
  PATH_STATE_CAP,
  SITEMAP_PAGE_SIZE,
  TAG_MIN_ITEMS,
  authorIndexable,
  authorPath,
  categoryPath,
  categorySlug,
  localized,
  personBio,
  personName,
  pickRelated,
  publicPerson,
  shapePathState,
  sitemapEntry,
  tagIndexable,
  tagPath,
  tagSlug,
  toCard,
  toItem,
} from "./public-content.mapper.js";
import { PublicContentRepo, type PublicContentStore } from "./public-content.repo.js";

import type { ItemParts, ItemRow, TwinPaths } from "./public-content.types.js";
import type { ApiEnv } from "../../config/env.js";
import type { ContentLocale } from "@wasfa/shared/content/constants";
import type {
  PublicItem,
  PublicListQuery,
  PublicListResponse,
  PublicPathState,
  PublicTaxonomyPage,
  PublicResolveResponse,
} from "@wasfa/shared/schemas/content";

const INTRO_TTL_MS = 5 * 60 * 1000;
const MAX_SNIPPET = 160;

type Sitemap = ReturnType<typeof sitemapEntry>;

/** Plain-text excerpt of a Markdown description, for meta descriptions when no SEO text is set. */
function snippet(markdown: string): string {
  const plain = markdown
    .replace(/[#*_`>[\]()!~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > MAX_SNIPPET ? `${plain.slice(0, MAX_SNIPPET - 1).trimEnd()}…` : plain;
}

/**
 * The public read API (Phase 4 WP3): what the web app renders and caches. Only published rows are
 * reachable here; the single exception is `preview`, gated by a verified HMAC token.
 */
@Injectable()
export class PublicContentService {
  private readonly intros = new LocalCache<string>(INTRO_TTL_MS);

  constructor(
    @Inject(PublicContentRepo) private readonly repo: PublicContentStore,
    @Inject(API_ENV)
    private readonly env: Pick<ApiEnv, "MEDIA_PUBLIC_ORIGIN" | "CONTENT_PREVIEW_SECRET">,
  ) {}

  // --- item -------------------------------------------------------------------------------------

  async resolve(query: {
    type: ItemRow["type"];
    locale: ContentLocale;
    slug: string;
  }): Promise<PublicResolveResponse> {
    // A page slug is the whole path below the root; tolerate stray slashes from the router.
    const slug = query.type === "page" ? query.slug.replace(/^\/+|\/+$/g, "") : query.slug;
    const item = await this.repo.findItem(query.type, query.locale, slug);
    if (item?.publishedRevisionId) {
      const built = await this.buildItem(item, item.publishedRevisionId);
      if (built !== undefined) return { kind: "item", item: built };
    }
    const fromPath = contentPath(query.type, query.locale, slug);
    const to = await this.repo.redirectFor(fromPath);
    if (to !== null && sitePathSchema.safeParse(to).success) return { kind: "redirect", to };
    if (item?.status === "archived" && item.firstPublishedAt !== null) {
      // The archive normally writes a redirect row; honour the item-level target if the row is missing.
      if (item.archivedRedirectTo && sitePathSchema.safeParse(item.archivedRedirectTo).success) {
        return { kind: "redirect", to: item.archivedRedirectTo };
      }
      return { kind: "gone" };
    }
    return { kind: "not_found" };
  }

  private async buildItem(item: ItemRow, revisionId: string): Promise<PublicItem | undefined> {
    const parts = await this.repo.itemParts(item, revisionId);
    if (parts === undefined) return undefined;
    return toItem(parts, await this.related(parts));
  }

  private async related(parts: ItemParts) {
    const flags = parts.item.flags;
    if (flags["showRelated"] === false) return [];
    const candidates = await this.repo.relatedCandidates(
      parts.item,
      parts.tags.map((tag) => tag.id),
    );
    const ids = pickRelated(candidates, parts.item.id);
    return (await this.repo.cardsByIds(ids)).map(toCard);
  }

  async list(query: PublicListQuery): Promise<PublicListResponse> {
    const { locale } = query;
    const filter: Parameters<PublicContentStore["list"]>[0] = {
      type: query.type,
      locale,
      page: query.page,
      pageSize: query.pageSize,
    };
    const empty = { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    if (query.categorySlug !== undefined) {
      const category = await this.repo.findCategory(query.categorySlug, locale);
      if (category === undefined) return empty;
      filter.categoryId = category.id;
    }
    if (query.tagSlug !== undefined) {
      const tag = await this.repo.findTag(query.tagSlug, locale);
      if (tag === undefined) return empty;
      filter.tagId = tag.id;
    }
    if (query.authorSlug !== undefined) {
      const author = await this.repo.findAuthor(query.authorSlug);
      if (author === undefined) return empty;
      filter.authorId = author.person.id;
    }
    const { rows, total } = await this.repo.list(filter);
    return { items: rows.map(toCard), total, page: query.page, pageSize: query.pageSize };
  }

  // --- taxonomy ---------------------------------------------------------------------------------

  /** Markdown -> sanitised HTML with no auto-links and no resolvers (descriptions cannot embed entities). */
  async renderIntro(markdown: string, locale: ContentLocale): Promise<string> {
    if (markdown.trim() === "") return "";
    const key = createHash("sha256").update(`${locale}\0${markdown}`).digest("hex");
    const cached = this.intros.get(key);
    if (cached !== undefined) return cached;
    const result = await renderContent({
      bodyMd: markdown,
      type: "page",
      locale,
      flags: { autoLink: false },
      settings: {
        autoLink: { enabled: false, maxPerTarget: 1, minWordsBetween: 0 },
        dofollowDomains: [],
      },
      resolvers: {
        media: () => Promise.resolve(new Map()),
        drug: () => Promise.resolve(null),
        glossary: () => Promise.resolve(null),
        autoLinkTargets: [],
      },
      mediaOrigin: this.env.MEDIA_PUBLIC_ORIGIN ?? "",
    });
    this.intros.set(key, result.html);
    return result.html;
  }

  async taxonomyPage(query: {
    kind: "category" | "tag" | "author";
    locale: ContentLocale;
    slug: string;
  }): Promise<PublicTaxonomyPage> {
    const { locale, slug } = query;
    if (query.kind === "category") {
      const row = await this.repo.findCategory(slug, locale);
      if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
      const description = locale === "en" ? row.descriptionEn : row.descriptionAr;
      const name = localized(row.nameAr, row.nameEn, locale);
      const seoTitle = locale === "en" ? row.seoTitleEn : row.seoTitleAr;
      const seoDescription = locale === "en" ? row.seoDescriptionEn : row.seoDescriptionAr;
      return {
        kind: "category",
        slug,
        name,
        path: categoryPath(locale, slug),
        introHtml: await this.renderIntro(description, locale),
        seoTitle: seoTitle || name,
        seoDescription: seoDescription || snippet(description),
        indexable: true,
        itemCount: await this.repo.countPublished(locale, { categoryId: row.id }),
        person: null,
        alternates: {
          ar: categoryPath("ar", row.slugAr),
          en: row.slugEn === null ? null : categoryPath("en", row.slugEn),
        },
      };
    }
    if (query.kind === "tag") {
      const row = await this.repo.findTag(slug, locale);
      if (row === undefined) throw new AppError(ErrorCode.NOT_FOUND);
      const description = locale === "en" ? row.descriptionEn : row.descriptionAr;
      const name = localized(row.nameAr, row.nameEn, locale);
      const itemCount = await this.repo.countPublished(locale, { tagId: row.id });
      return {
        kind: "tag",
        slug,
        name,
        path: tagPath(locale, slug),
        introHtml: await this.renderIntro(description, locale),
        seoTitle: name,
        seoDescription: snippet(description),
        indexable: tagIndexable(row, locale, itemCount),
        itemCount,
        person: null,
        alternates: {
          ar: row.slugAr === null ? null : tagPath("ar", row.slugAr),
          en: row.slugEn === null ? null : tagPath("en", row.slugEn),
        },
      };
    }
    const found = await this.repo.findAuthor(slug);
    if (found === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const { person, photo } = found;
    const bio = personBio(person, locale);
    const bioHtml = await this.renderIntro(bio, locale);
    const name = personName(person, locale);
    return {
      kind: "author",
      slug,
      name,
      path: authorPath(locale, slug),
      introHtml: bioHtml,
      seoTitle: name,
      seoDescription: snippet(bio),
      indexable: authorIndexable(person, locale),
      itemCount: await this.repo.countPublished(locale, { authorId: person.id }),
      person: {
        ...publicPerson(person, photo, locale),
        sameAs: person.sameAs.filter((url) => url.startsWith("https://")),
        bioHtml,
      },
      alternates: { ar: authorPath("ar", slug), en: authorPath("en", slug) },
    };
  }

  async taxonomyList(query: { kind: "category" | "tag" | "author"; locale: ContentLocale }) {
    const { locale } = query;
    if (query.kind === "category") {
      const rows = await this.repo.listCategories(locale, 1);
      return {
        items: rows.flatMap(({ row, itemCount }) => {
          const slug = categorySlug(row, locale);
          return slug === null
            ? []
            : [
                {
                  slug,
                  name: localized(row.nameAr, row.nameEn, locale),
                  path: categoryPath(locale, slug),
                  itemCount,
                },
              ];
        }),
      };
    }
    if (query.kind === "tag") {
      const rows = await this.repo.listTags(locale, 1);
      return {
        items: rows.flatMap(({ row, itemCount }) => {
          const slug = tagSlug(row, locale);
          return slug === null
            ? []
            : [
                {
                  slug,
                  name: localized(row.nameAr, row.nameEn, locale),
                  path: tagPath(locale, slug),
                  itemCount,
                },
              ];
        }),
      };
    }
    const rows = await this.repo.listAuthors(locale, 1);
    return {
      items: rows.map(({ row, itemCount }) => ({
        slug: row.slug,
        name: personName(row, locale),
        path: authorPath(locale, row.slug),
        itemCount,
      })),
    };
  }

  async glossaryIndex(locale: ContentLocale) {
    const rows = await this.repo.glossaryIndex(locale);
    return {
      items: rows.map((row) => ({
        slug: row.slug,
        path: contentPath("glossary", locale, row.slug),
        term: row.title,
        definition: row.definition,
      })),
    };
  }

  // --- proxy maps and sitemaps ------------------------------------------------------------------

  async pathState(): Promise<PublicPathState> {
    const [redirects, gone] = await Promise.all([
      this.repo.redirects(PATH_STATE_CAP),
      this.repo.gonePaths(PATH_STATE_CAP),
    ]);
    return shapePathState(redirects, gone);
  }

  async sitemap(query: {
    kind: "article" | "guide" | "glossary" | "page" | "category" | "tag" | "author";
    locale: ContentLocale;
    page: number;
  }): Promise<{ urls: Sitemap[]; hasMore: boolean }> {
    const { kind, locale, page } = query;
    const origin = this.env.MEDIA_PUBLIC_ORIGIN;
    const offset = (page - 1) * SITEMAP_PAGE_SIZE;

    if (kind === "category" || kind === "tag" || kind === "author") {
      const entries = await this.taxonomySitemapEntries(kind, locale);
      const slice = entries.slice(offset, offset + SITEMAP_PAGE_SIZE);
      return {
        urls: slice.map((entry) => sitemapEntry({ ...entry, image: null, locale }, origin)),
        hasMore: entries.length > offset + SITEMAP_PAGE_SIZE,
      };
    }

    const rows = await this.repo.sitemapItems(kind, locale, offset, SITEMAP_PAGE_SIZE + 1);
    const hasMore = rows.length > SITEMAP_PAGE_SIZE;
    const pageRows = rows.slice(0, SITEMAP_PAGE_SIZE);
    const twins = await this.repo.publishedTwins([
      ...new Set(pageRows.map((row) => row.item.translationGroupId)),
    ]);
    const byGroup = new Map<string, TwinPaths>();
    for (const twin of twins) {
      const paths = byGroup.get(twin.translationGroupId) ?? { ar: null, en: null };
      paths[twin.locale] = contentPath(twin.type, twin.locale, twin.slug);
      byGroup.set(twin.translationGroupId, paths);
    }
    return {
      urls: pageRows.map(({ item, image }) => {
        const path = contentPath(item.type, item.locale, item.slug);
        const alternates = { ...(byGroup.get(item.translationGroupId) ?? { ar: null, en: null }) };
        alternates[item.locale] = path;
        return sitemapEntry(
          {
            path,
            lastmod: item.contentUpdatedAt ?? item.publishedAt ?? item.updatedAt,
            alternates,
            image,
            locale,
          },
          origin,
        );
      }),
      hasMore,
    };
  }

  private async taxonomySitemapEntries(
    kind: "category" | "tag" | "author",
    locale: ContentLocale,
  ): Promise<{ path: string; lastmod: Date; alternates: TwinPaths }[]> {
    const later = (a: Date, b: Date | null) => (b !== null && b > a ? b : a);
    if (kind === "category") {
      return (await this.repo.listCategories(locale, 1)).map(({ row, lastItemUpdatedAt }) => ({
        path: categoryPath(locale, categorySlug(row, locale) ?? row.slugAr),
        lastmod: later(row.updatedAt, lastItemUpdatedAt),
        alternates: {
          ar: categoryPath("ar", row.slugAr),
          en: row.slugEn === null ? null : categoryPath("en", row.slugEn),
        },
      }));
    }
    if (kind === "tag") {
      return (await this.repo.listTags(locale, TAG_MIN_ITEMS)).flatMap(
        ({ row, itemCount, lastItemUpdatedAt }) => {
          const slug = tagSlug(row, locale);
          if (slug === null || !tagIndexable(row, locale, itemCount)) return [];
          return [
            {
              path: tagPath(locale, slug),
              lastmod: later(row.updatedAt, lastItemUpdatedAt),
              alternates: {
                ar: row.slugAr === null ? null : tagPath("ar", row.slugAr),
                en: row.slugEn === null ? null : tagPath("en", row.slugEn),
              },
            },
          ];
        },
      );
    }
    return (await this.repo.listAuthors(locale, 0)).flatMap(({ row, lastItemUpdatedAt }) =>
      authorIndexable(row, locale)
        ? [
            {
              path: authorPath(locale, row.slug),
              lastmod: later(row.updatedAt, lastItemUpdatedAt),
              alternates: { ar: authorPath("ar", row.slug), en: authorPath("en", row.slug) },
            },
          ]
        : [],
    );
  }

  // --- preview ----------------------------------------------------------------------------------

  /** A draft or specific revision through the same mapper as the live page; 404 for anything invalid. */
  async preview(token: string, now: Date = new Date()) {
    const secret = this.env.CONTENT_PREVIEW_SECRET;
    if (secret === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    const payload = verifyPreviewToken(secret, token, now);
    if (payload === null) throw new AppError(ErrorCode.NOT_FOUND);
    const item = await this.repo.findItemById(payload.itemId);
    const revisionId = payload.revisionId ?? item?.currentRevisionId ?? null;
    if (item === undefined || revisionId === null) throw new AppError(ErrorCode.NOT_FOUND);
    const built = await this.buildItem(item, revisionId);
    if (built === undefined) throw new AppError(ErrorCode.NOT_FOUND);
    return {
      item: built,
      expiresAt: new Date(payload.expiresAt * 1000).toISOString(),
      isDraft: revisionId !== item.publishedRevisionId,
    };
  }
}
