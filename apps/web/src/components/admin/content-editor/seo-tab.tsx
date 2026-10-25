"use client";

import { checkItemSlug, contentPath, slugify } from "@wasfa/shared/content";
import { t, type MessageKey } from "@wasfa/shared/i18n";
import { Button, Field, Input, Select, Textarea } from "@wasfa/ui";
import { CircleCheck, ImageIcon, Lightbulb, Wand2 } from "lucide-react";
import { useMemo } from "react";

import { formatNumber } from "../../../lib/admin-format";
import { seoChecklist, type ChecklistItem } from "../../../lib/content-editor/seo-checklist";
import {
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
  codePointLength,
} from "../../../lib/content-editor/snippet";
import { buildStructuredData } from "../../../lib/content-editor/structured-data";
import { useLinkSuggestions } from "../../../lib/content-editor/use-link-suggestions";

import { AssetThumb } from "./asset-thumb";
import { ChipsInput } from "./chips-input";
import { SnippetPreview } from "./snippet-preview";

import type { EditorDraft } from "../../../lib/content-editor/draft";
import type { EditorSettings } from "../../../lib/content-editor-schemas";
import type { ContentLocale, ContentType } from "@wasfa/shared/content/constants";
import type {
  ContentItemDetail,
  ContentMeta,
  ContentOptions,
  ContentSeo,
} from "@wasfa/shared/schemas/content";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface SeoTabProps {
  detail: ContentItemDetail | null;
  draft: EditorDraft;
  /** The body as the checklist should read it (deferred while typing). */
  bodyMd: string;
  type: ContentType;
  locale: ContentLocale;
  settings: EditorSettings;
  permissions: readonly string[];
  options: ContentOptions | null;
  readOnly: boolean;
  slugTaken: boolean;
  /** The current selection / heading, for the link suggestions. */
  linkQuery: string;
  origin: string;
  featured: MediaAsset | null;
  ogImage: MediaAsset | null;
  onMeta: (update: (meta: ContentMeta) => ContentMeta) => void;
  onPickOgImage: () => void;
  onInsertLink: (anchor: string, path: string) => void;
}

const CHECK_KEYS = {
  focus_keyword: "admin.editor.seo.check.focus_keyword",
  keyword_title: "admin.editor.seo.check.keyword_title",
  keyword_intro: "admin.editor.seo.check.keyword_intro",
  keyword_h2: "admin.editor.seo.check.keyword_h2",
  keyword_slug: "admin.editor.seo.check.keyword_slug",
  keyword_description: "admin.editor.seo.check.keyword_description",
  meta_title: "admin.editor.seo.check.meta_title",
  meta_description: "admin.editor.seo.check.meta_description",
  headings: "admin.editor.seo.check.headings",
  internal_links: "admin.editor.seo.check.internal_links",
  image_alts: "admin.editor.seo.check.image_alts",
  length: "admin.editor.seo.check.length",
  duplicate: "admin.editor.seo.check.duplicate",
  unique_meta: "admin.editor.seo.check.unique_meta",
  readability: "admin.editor.seo.check.readability",
} as const satisfies Record<ChecklistItem["id"], MessageKey>;

const WHY_KEYS = {
  focus_keyword: "admin.editor.seo.why.focus_keyword",
  keyword_title: "admin.editor.seo.why.keyword_title",
  keyword_intro: "admin.editor.seo.why.keyword_intro",
  keyword_h2: "admin.editor.seo.why.keyword_h2",
  keyword_slug: "admin.editor.seo.why.keyword_slug",
  keyword_description: "admin.editor.seo.why.keyword_description",
  meta_title: "admin.editor.seo.why.meta_title",
  meta_description: "admin.editor.seo.why.meta_description",
  headings: "admin.editor.seo.why.headings",
  internal_links: "admin.editor.seo.why.internal_links",
  image_alts: "admin.editor.seo.why.image_alts",
  length: "admin.editor.seo.why.length",
  duplicate: "admin.editor.seo.why.duplicate",
  unique_meta: "admin.editor.seo.why.unique_meta",
  readability: "admin.editor.seo.why.readability",
} as const satisfies Record<ChecklistItem["id"], MessageKey>;

function Counter({ value, min, max }: { value: number; min?: number; max: number }) {
  const ok = value <= max && value >= (min ?? 0);
  return (
    <span className={ok ? "text-text-muted" : "text-warning"}>
      {t("admin.editor.seo.counter", { count: formatNumber(value), max: formatNumber(max) })}
      {min !== undefined
        ? ` · ${t("admin.editor.seo.counterMin", { min: formatNumber(min) })}`
        : ""}
    </span>
  );
}

export function SeoTab({
  detail,
  draft,
  bodyMd,
  type,
  locale,
  settings,
  permissions,
  options,
  readOnly,
  slugTaken,
  linkQuery,
  origin,
  featured,
  ogImage,
  onMeta,
  onPickOgImage,
  onInsertLink,
}: SeoTabProps) {
  const { meta, payload } = draft;
  const seo = meta.seo;
  const canManage = permissions.includes("content.manage");

  const setSeo = (patch: Partial<ContentSeo>): void => {
    onMeta((current) => ({ ...current, seo: { ...current.seo, ...patch } }));
  };

  const featuredAlt = featured ? (locale === "en" ? featured.altEn : featured.altAr) : null;
  const checklist = useMemo(
    () =>
      seoChecklist({
        type,
        title: payload.title,
        bodyMd,
        slug: meta.slug,
        seo,
        featuredAltMissing: meta.featuredMediaId
          ? featured !== null && (featuredAlt ?? "").trim() === ""
          : null,
        gates: detail?.gates ?? [],
        minWords: settings.minWords,
      }),
    [
      type,
      payload.title,
      bodyMd,
      meta.slug,
      meta.featuredMediaId,
      seo,
      featured,
      featuredAlt,
      detail?.gates,
      settings.minWords,
    ],
  );

  const effectiveTitle = seo.title.trim() || payload.title.trim();
  const path = detail?.publicPath ?? (meta.slug ? contentPath(type, locale, meta.slug) : "/");
  const description = seo.description.trim() || payload.excerpt.trim();
  const slugChanged = detail !== null && meta.slug !== detail.meta.slug;
  const wasPublished = detail !== null && (detail.live || detail.publishedAt !== null);
  const slugSuggestion = slugify(payload.title);
  // An empty slug means "let the server generate it"; anything typed is checked with the shared rule
  // (pages may use up to three segments, every other type one).
  const slugVerdict = meta.slug.trim() === "" ? "ok" : checkItemSlug(type, meta.slug.trim());
  const slugError =
    slugVerdict === "ok"
      ? slugTaken
        ? t("admin.editor.error.CONTENT_SLUG_TAKEN")
        : undefined
      : t(`admin.editor.seo.slug.${slugVerdict}`);

  const suggestions = useLinkSuggestions(detail?.id ?? null, linkQuery, locale);

  const person = (id: string | null) => {
    const found =
      options?.authors.find((candidate) => candidate.id === id) ??
      options?.reviewers.find((candidate) => candidate.id === id);
    return found ? { name: found.name, slug: found.slug } : null;
  };
  // Small and cheap: built on every render so it never lags the fields it mirrors.
  const structured = buildStructuredData({
    type,
    locale,
    slug: meta.slug,
    title: payload.title,
    excerpt: payload.excerpt,
    definition: payload.definition,
    seoTitle: seo.title,
    seoDescription: seo.description,
    publishedAt: detail?.publishedAt ?? null,
    updatedAt: detail?.updatedAt ?? null,
    author: person(meta.primaryAuthorId),
    reviewer: person(meta.reviewerId),
    publicPath: detail?.publicPath ?? null,
    featuredMediaId: meta.featuredMediaId,
    origin,
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4" aria-label={t("admin.editor.seo.keywords")}>
        <Field
          label={t("admin.editor.seo.focusKeyword")}
          hint={t("admin.editor.seo.focusKeyword.hint")}
        >
          {(control) => (
            <Input
              {...control}
              dir="auto"
              disabled={readOnly}
              maxLength={120}
              value={seo.focusKeyword}
              onChange={(event) => {
                setSeo({ focusKeyword: event.target.value });
              }}
            />
          )}
        </Field>
        <ChipsInput
          label={t("admin.editor.seo.secondary")}
          values={seo.secondaryKeywords}
          max={10}
          disabled={readOnly}
          onChange={(secondaryKeywords) => {
            setSeo({ secondaryKeywords });
          }}
        />
      </section>

      <section className="flex flex-col gap-4" aria-label={t("admin.editor.seo.search")}>
        <Field
          label={t("admin.editor.seo.title")}
          hint={<Counter value={codePointLength(seo.title)} max={SEO_TITLE_MAX} />}
        >
          {(control) => (
            <Input
              {...control}
              dir="auto"
              disabled={readOnly}
              maxLength={120}
              placeholder={payload.title}
              value={seo.title}
              onChange={(event) => {
                setSeo({ title: event.target.value });
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.editor.seo.description")}
          hint={
            <Counter
              value={codePointLength(seo.description)}
              min={SEO_DESCRIPTION_MIN}
              max={SEO_DESCRIPTION_MAX}
            />
          }
        >
          {(control) => (
            <Textarea
              {...control}
              dir="auto"
              rows={3}
              disabled={readOnly}
              maxLength={320}
              value={seo.description}
              onChange={(event) => {
                setSeo({ description: event.target.value });
              }}
            />
          )}
        </Field>
        <SnippetPreview
          title={effectiveTitle}
          description={description}
          origin={origin}
          path={path}
          locale={locale}
        />
      </section>

      <section className="flex flex-col gap-3" aria-label={t("admin.editor.seo.slug")}>
        <Field
          label={t("admin.editor.seo.slug")}
          hint={t("admin.editor.seo.slug.hint", { path })}
          error={slugError}
          announceError={slugError !== undefined}
        >
          {(control) => (
            <div className="flex items-start gap-2">
              <Input
                {...control}
                ltr
                autoComplete="off"
                spellCheck={false}
                disabled={readOnly}
                value={meta.slug}
                onChange={(event) => {
                  onMeta((current) => ({ ...current, slug: event.target.value.toLowerCase() }));
                }}
              />
              <Button
                variant="secondary"
                disabled={readOnly || slugSuggestion === "" || slugSuggestion === meta.slug}
                onClick={() => {
                  onMeta((current) => ({ ...current, slug: slugSuggestion }));
                }}
                className="shrink-0"
              >
                <Wand2 aria-hidden className="size-5" />
                {t("admin.editor.seo.slug.suggest")}
              </Button>
            </div>
          )}
        </Field>
        {wasPublished ? (
          <p role={slugChanged ? "alert" : undefined} className="text-sm text-warning">
            {t("admin.editor.seo.slug.redirectWarning")}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-label={t("admin.editor.seo.checklist")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.seo.checklist")}</h3>
        <ul className="flex flex-col gap-3">
          {checklist.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-2"
              data-check={item.id}
              data-status={item.status}
            >
              {item.status === "pass" ? (
                <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
              ) : (
                <Lightbulb aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
              )}
              <div className="min-w-0">
                <p className="text-base text-text">
                  <span className="font-semibold">
                    {t(
                      item.status === "pass" ? "admin.editor.seo.pass" : "admin.editor.seo.improve",
                    )}
                    {": "}
                  </span>
                  {t(CHECK_KEYS[item.id], toParams(item.params))}
                </p>
                <p className="text-sm text-text-muted">{t(WHY_KEYS[item.id])}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-label={t("admin.editor.seo.links")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.seo.links")}</h3>
        {detail === null ? (
          <p className="text-sm text-text-muted">{t("admin.editor.seo.links.saveFirst")}</p>
        ) : suggestions.items.length === 0 ? (
          <p role="status" className="text-sm text-text-muted">
            {suggestions.loading
              ? t("admin.editor.seo.links.loading")
              : t("admin.editor.seo.links.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {suggestions.items.map((item) => (
              <li
                key={item.path}
                className="flex items-center justify-between gap-2 rounded-lg border border-border ps-3"
              >
                <span className="min-w-0 py-2">
                  <bdi className="block truncate text-base text-text">{item.title}</bdi>
                  <span dir="ltr" className="block truncate text-start text-sm text-text-muted">
                    {item.path}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  disabled={readOnly}
                  onClick={() => {
                    onInsertLink(linkQuery.trim() || item.title, item.path);
                  }}
                  aria-label={t("admin.editor.seo.links.insertFor", { title: item.title })}
                >
                  {t("admin.editor.seo.links.insert")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-4" aria-label={t("admin.editor.seo.advanced")}>
          <h3 className="text-base font-semibold text-text">{t("admin.editor.seo.advanced")}</h3>
          <Field
            label={t("admin.editor.seo.canonical")}
            hint={t("admin.editor.seo.canonical.hint")}
          >
            {(control) => (
              <Input
                {...control}
                ltr
                disabled={readOnly}
                maxLength={500}
                value={seo.canonical}
                onChange={(event) => {
                  setSeo({ canonical: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={t("admin.editor.seo.robots")}>
            {(control) => (
              <Select
                {...control}
                disabled={readOnly}
                value={seo.robots}
                onChange={(event) => {
                  setSeo({ robots: event.target.value === "noindex" ? "noindex" : "index" });
                }}
              >
                <option value="index">{t("admin.editor.seo.robots.index")}</option>
                <option value="noindex">{t("admin.editor.seo.robots.noindex")}</option>
              </Select>
            )}
          </Field>
        </section>
      ) : null}

      <section className="flex flex-col gap-4" aria-label={t("admin.editor.seo.social")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.seo.social")}</h3>
        <Field label={t("admin.editor.seo.ogTitle")}>
          {(control) => (
            <Input
              {...control}
              dir="auto"
              disabled={readOnly}
              maxLength={120}
              placeholder={effectiveTitle}
              value={seo.ogTitle}
              onChange={(event) => {
                setSeo({ ogTitle: event.target.value });
              }}
            />
          )}
        </Field>
        <Field label={t("admin.editor.seo.ogDescription")}>
          {(control) => (
            <Textarea
              {...control}
              dir="auto"
              rows={2}
              disabled={readOnly}
              maxLength={320}
              placeholder={description}
              value={seo.ogDescription}
              onChange={(event) => {
                setSeo({ ogDescription: event.target.value });
              }}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={readOnly} onClick={onPickOgImage}>
            <ImageIcon aria-hidden className="size-5" />
            {t(
              seo.ogImageMediaId
                ? "admin.editor.seo.ogImage.change"
                : "admin.editor.seo.ogImage.choose",
            )}
          </Button>
          {seo.ogImageMediaId ? (
            <Button
              variant="ghost"
              disabled={readOnly}
              onClick={() => {
                setSeo({ ogImageMediaId: null });
              }}
            >
              {t("admin.editor.featured.remove")}
            </Button>
          ) : null}
        </div>
        <figure
          data-testid="og-card"
          className="flex max-w-sm flex-col overflow-hidden rounded-lg border border-border bg-surface"
        >
          {(ogImage ?? featured) ? (
            <AssetThumb asset={(ogImage ?? featured) as MediaAsset} className="rounded-none" />
          ) : null}
          <figcaption dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-0.5 p-3">
            <span dir="ltr" className="truncate text-start text-xs uppercase text-text-muted">
              {safeHost(origin)}
            </span>
            <span className="break-words text-base font-semibold text-text">
              {seo.ogTitle.trim() || effectiveTitle || t("admin.editor.snippet.noTitle")}
            </span>
            <span className="break-words text-sm text-text-muted">
              {seo.ogDescription.trim() || description}
            </span>
          </figcaption>
        </figure>
      </section>

      <details className="rounded-lg border border-border p-3">
        <summary className="min-h-11 cursor-pointer text-base font-semibold text-text">
          {t("admin.editor.seo.structured")}{" "}
          <span className="text-sm font-normal text-text-muted">
            ({t("admin.editor.seo.structured.approx")})
          </span>
        </summary>
        <pre
          dir="ltr"
          className="mt-2 max-h-96 overflow-auto rounded-md bg-neutral-100 p-3 text-start text-xs text-text"
        >
          {JSON.stringify(structured, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function toParams(params: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "number" ? formatNumber(value) : value;
  }
  return out;
}

function safeHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
