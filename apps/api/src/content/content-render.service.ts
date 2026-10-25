import { Inject, Injectable } from "@nestjs/common";
import {
  contentPath,
  estimateJaccard,
  evaluateGates,
  plainForMatching,
  requiresMedicalReview,
} from "@wasfa/shared/content";
import {
  CONTENT_PATH_PREFIX,
  type ContentLocale,
  type ContentType,
} from "@wasfa/shared/content/constants";
import {
  renderContent,
  type AutoLinkTarget,
  type RenderMedia,
  type RenderResult,
} from "@wasfa/shared/content/render";

import { API_ENV } from "../config/config.module.js";
import { SettingsService } from "../settings/settings.service.js";

import { ContentItemsRepo, type MediaRole } from "./items.repo.js";

import type { ApiEnv } from "../config/env.js";
import type {
  ContentFlags,
  ContentMeta,
  ContentPayload,
  QualityGate,
  RenderPreviewInput,
  RenderPreviewResponse,
  TocEntry,
} from "@wasfa/shared/schemas/content";

/*
 * The ONE place that turns a payload into everything stored for a revision: the sanitised HTML, the
 * TOC, counts, the MinHash signature, the search text, the link/entity/media-reference rows and the
 * quality gates (CONTENT-PLATFORM §11.3). Save, restore, approve-with-edits, the publish-time gate
 * check and render-preview all come through here, so what the editor previews is what is stored.
 */

/** At most this many glossary entries are offered to the auto-linker (longest terms first). */
export const AUTOLINK_TARGET_CAP = 500;
/** Published revisions compared for near-duplicate detection. */
export const SIMILARITY_SCAN_CAP = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_PREFIXES = Object.values(CONTENT_PATH_PREFIX).filter((prefix) => prefix !== "");
const CONTENT_LINK = new RegExp(
  `^(?:/en)?(?:${CONTENT_PREFIXES.map((prefix) => prefix.replace("/", "\\/")).join("|")})(?:/|$)`,
);

/** `/blog/x/?a=1#top` -> `/blog/x`: the form that is compared with item paths and redirects. */
export function normalizeInternalPath(href: string): string {
  const bare = href.split("#")[0]?.split("?")[0] ?? href;
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
}

export interface RenderSubject {
  /** `null` while the item does not exist yet (create) or for a preview. */
  itemId: string | null;
  translationGroupId: string | null;
  type: ContentType;
  locale: ContentLocale;
  payload: ContentPayload;
  meta: Pick<
    ContentMeta,
    "slug" | "categoryId" | "primaryAuthorId" | "reviewerId" | "seo" | "flags" | "featuredMediaId"
  >;
  /** `null`: the item has no category and follows its type. */
  categoryRequiresReview: boolean | null;
  /** `reviewed_revision_id` equals the revision these gates are computed for. */
  approvedMatchesCurrent: boolean;
}

export interface BuiltRevision {
  render: RenderResult;
  derived: {
    bodyHtml: string;
    toc: TocEntry[];
    wordCount: number;
    readingMinutes: number;
    minhash: Buffer;
    quality: QualityGate[];
  };
  searchText: string;
  links: {
    href: string;
    kind: "internal" | "external";
    host: string | null;
    anchorText: string;
    targetItemId: string | null;
    rel: string;
  }[];
  entities: { kind: "drug" | "glossary"; slug: string; source: "explicit" | "auto" }[];
  mediaRefs: { mediaId: string; role: MediaRole }[];
  gates: QualityGate[];
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

@Injectable()
export class ContentRenderService {
  constructor(
    private readonly repo: ContentItemsRepo,
    private readonly settings: SettingsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** `POST render-preview`: the same renderer, nothing stored, no database-wide gate facts. */
  async preview(input: RenderPreviewInput): Promise<RenderPreviewResponse> {
    const render = await this.renderBody({
      type: input.type,
      locale: input.locale,
      bodyMd: input.bodyMd,
      flags: {
        autoLink: input.flags?.autoLink ?? true,
        sponsored: input.flags?.sponsored ?? false,
      },
      excludeItemId: null,
    });
    return {
      html: render.html,
      toc: render.toc,
      wordCount: render.wordCount,
      readingMinutes: render.readingMinutes,
      warnings: render.warnings,
    };
  }

  async renderBody(input: {
    type: ContentType;
    locale: ContentLocale;
    bodyMd: string;
    flags: Pick<ContentFlags, "autoLink" | "sponsored">;
    excludeItemId: string | null;
  }): Promise<RenderResult> {
    const settings = await this.settings.get("content");
    const glossary = await this.repo.glossaryTargets(
      input.locale,
      input.excludeItemId,
      AUTOLINK_TARGET_CAP,
    );
    const autoLinkTargets: AutoLinkTarget[] = glossary.map((entry) => ({
      kind: "glossary",
      slug: entry.slug,
      terms: [entry.title],
      path: contentPath("glossary", input.locale, entry.slug),
      title: entry.definition === "" ? entry.title : entry.definition,
    }));
    return renderContent({
      bodyMd: input.bodyMd,
      type: input.type,
      locale: input.locale,
      flags: input.flags,
      settings: { autoLink: settings.autoLink, dofollowDomains: settings.dofollowDomains },
      mediaOrigin: this.env.MEDIA_PUBLIC_ORIGIN ?? "",
      resolvers: {
        media: async (ids) => {
          const rows = await this.repo.readyMedia(ids.filter((id) => UUID.test(id)));
          return new Map<string, RenderMedia>(
            rows.map((row) => [
              row.id,
              {
                id: row.id,
                width: row.width ?? 0,
                height: row.height ?? 0,
                alt: (input.locale === "en" ? row.altEn : row.altAr) ?? "",
                caption: row.caption,
                credit: row.credit,
                variants: row.variants,
              },
            ]),
          );
        },
        // Seam for WP5: drug monographs do not exist yet, so every `{{drug:x}}` is an unknown_drug warning.
        drug: () => Promise.resolve(null),
        glossary: async (slug) => {
          const entry = await this.repo.findPublishedGlossary(input.locale, slug);
          return entry === undefined
            ? null
            : {
                term: entry.title,
                path: contentPath("glossary", input.locale, entry.slug),
                definition: entry.definition,
              };
        },
        autoLinkTargets,
      },
    });
  }

  /** Renders `subject` and gathers every derived field and gate fact. */
  async build(subject: RenderSubject): Promise<BuiltRevision> {
    const settings = await this.settings.get("content");
    const { payload, meta } = subject;
    const render = await this.renderBody({
      type: subject.type,
      locale: subject.locale,
      bodyMd: payload.bodyMd,
      flags: { autoLink: meta.flags.autoLink, sponsored: meta.flags.sponsored },
      excludeItemId: subject.itemId,
    });

    // Internal links to content pages: which exist (and are live), which are redirected, which are broken.
    const internalPaths = [
      ...new Set(
        render.links
          .filter((link) => link.internal)
          .map((link) => normalizeInternalPath(link.href))
          .filter((path) => CONTENT_LINK.test(path)),
      ),
    ];
    const pathState = await this.repo.internalPathState(internalPaths);
    const brokenInternalLinks = internalPaths.filter(
      (path) => !pathState.items.has(path) && !pathState.redirected.has(path),
    ).length;

    const [peers, titleDuplicate, descriptions, featured] = await Promise.all([
      this.repo.publishedMinhashes(subject.locale, subject.translationGroupId, SIMILARITY_SCAN_CAP),
      this.repo.similarTitleExists({
        type: subject.type,
        locale: subject.locale,
        title: payload.title,
        threshold: settings.titleSimilarityBlockAt,
        excludeItemId: subject.itemId,
      }),
      meta.seo.description.trim() === ""
        ? Promise.resolve([] as string[])
        : this.repo.publishedDescriptions(subject.locale, subject.itemId, SIMILARITY_SCAN_CAP),
      meta.featuredMediaId === null
        ? Promise.resolve([])
        : this.repo.readyMedia([meta.featuredMediaId]),
    ]);

    let similarity: { score: number; matchPath: string | null } | null = null;
    for (const peer of peers) {
      const score = estimateJaccard(render.minhash, peer.minhash);
      if (similarity === null || score > similarity.score) {
        similarity = { score, matchPath: contentPath(peer.type, peer.locale, peer.slug) };
      }
    }
    const wanted = plainForMatching(meta.seo.description);
    const descriptionDuplicate = wanted !== "" && descriptions.includes(wanted);

    const featuredRow = featured[0];
    const featuredImage =
      featuredRow === undefined
        ? null
        : {
            hasAlt:
              ((subject.locale === "en" ? featuredRow.altEn : featuredRow.altAr) ?? "").trim() !==
              "",
            width: featuredRow.width ?? 0,
          };

    const gates = evaluateGates({
      type: subject.type,
      payload,
      meta,
      featuredImage,
      render: {
        headings: render.headings,
        links: render.links,
        images: render.images,
        wordCount: render.wordCount,
        warningCodes: render.warnings.map((warning) => warning.code),
      },
      settings,
      context: {
        similarity,
        titleDuplicate,
        descriptionDuplicate,
        // Seam for WP5: `seo_keywords` does not exist yet, so no URL owns a keyword.
        keywordOwnerPath: null,
        brokenInternalLinks,
        review: {
          required: requiresMedicalReview({
            type: subject.type,
            categoryRequiresReview: subject.categoryRequiresReview,
          }),
          approvedMatchesCurrent: subject.approvedMatchesCurrent,
        },
      },
    });

    const entityKeys = new Map<string, BuiltRevision["entities"][number]>();
    for (const entity of render.entities) {
      const key = `${entity.kind}:${entity.slug}`;
      // An explicit directive outranks the auto-linker's guess for the same target.
      if (!entityKeys.has(key) || entity.source === "explicit") entityKeys.set(key, entity);
    }

    const mediaRefs = new Map<string, { mediaId: string; role: MediaRole }>();
    const addRef = (mediaId: string | null, role: MediaRole): void => {
      if (mediaId !== null) mediaRefs.set(`${mediaId}:${role}`, { mediaId, role });
    };
    for (const image of render.images) addRef(image.mediaId, "body");
    addRef(meta.featuredMediaId, "featured");
    addRef(meta.seo.ogImageMediaId, "og");

    return {
      render,
      derived: {
        bodyHtml: render.html,
        toc: render.toc,
        wordCount: render.wordCount,
        readingMinutes: render.readingMinutes,
        minhash: Buffer.from(render.minhash),
        quality: gates,
      },
      searchText: plainForMatching(
        [payload.excerpt, payload.definition, payload.bodyMd].join("\n"),
      ),
      links: render.links.map((link) => {
        const path = normalizeInternalPath(link.href);
        return {
          href: link.href,
          kind: link.internal ? ("internal" as const) : ("external" as const),
          host: link.internal ? null : hostOf(link.href),
          anchorText: link.anchor,
          targetItemId: link.internal ? (pathState.items.get(path) ?? null) : null,
          rel: link.rel,
        };
      }),
      entities: [...entityKeys.values()],
      mediaRefs: [...mediaRefs.values()],
      gates,
    };
  }
}
