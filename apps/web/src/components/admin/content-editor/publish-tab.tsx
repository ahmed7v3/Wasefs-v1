"use client";

import { requiresMedicalReview } from "@wasfa/shared/content";
import { t } from "@wasfa/shared/i18n";
import { Button, Field, Select } from "@wasfa/ui";
import { CalendarClock, ExternalLink, ImageIcon, Languages, X } from "lucide-react";
import Link from "next/link";

import { ACTION_LABELS } from "../../../lib/content-editor/actions";
import { formatZoned } from "../../../lib/content-editor/zoned-time";

import { AssetThumb } from "./asset-thumb";
import { GateList } from "./gate-list";
import { EditorLiveBadge, EditorStatusBadge, UnpublishedChangesBadge } from "./status-badges";
import { SwitchRow } from "./switch-row";

import type { EditorDraft } from "../../../lib/content-editor/draft";
import type { EditorSettings } from "../../../lib/content-editor-schemas";
import type { ContentAction, ContentLocale, ContentType } from "@wasfa/shared/content/constants";
import type {
  ContentFlags,
  ContentItemDetail,
  ContentMeta,
  ContentOptions,
} from "@wasfa/shared/schemas/content";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

export interface PublishTabProps {
  detail: ContentItemDetail | null;
  draft: EditorDraft;
  type: ContentType;
  locale: ContentLocale;
  options: ContentOptions | null;
  settings: EditorSettings;
  featured: MediaAsset | null;
  readOnly: boolean;
  busy: ContentAction | null;
  onMeta: (update: (meta: ContentMeta) => ContentMeta) => void;
  onPickFeatured: () => void;
  onCreateTwin: () => void;
  onAction: (action: ContentAction) => void;
}

const FLAG_KEYS = [
  "autoLink",
  "showToc",
  "showRelated",
  "sponsored",
  "aiAssisted",
] as const satisfies readonly (keyof ContentFlags)[];

const name = (locale: ContentLocale, ar: string, en: string | null): string =>
  locale === "en" && en ? en : ar;

/** Workflow buttons the Publish tab shows (the rest live in the top bar's overflow menu). */
const TAB_ACTIONS = [
  "submit",
  "publish",
  "schedule",
  "unschedule",
  "unpublish",
] as const satisfies readonly ContentAction[];

export function PublishTab({
  detail,
  draft,
  type,
  locale,
  options,
  settings,
  featured,
  readOnly,
  busy,
  onMeta,
  onPickFeatured,
  onCreateTwin,
  onAction,
}: PublishTabProps) {
  const { meta } = draft;
  const category =
    options?.categories.find((candidate) => candidate.id === meta.categoryId) ?? null;
  const reviewRequired = requiresMedicalReview({
    type,
    categoryRequiresReview: category?.requiresMedicalReview ?? null,
  });

  const topLevel = options?.categories.filter((candidate) => candidate.parentId === null) ?? [];
  const childrenOf = (parentId: string) =>
    options?.categories.filter((candidate) => candidate.parentId === parentId) ?? [];

  const selectedTags = meta.tagIds.map((id) => ({
    id,
    label:
      options?.tags.find((tag) => tag.id === id) !== undefined
        ? name(
            locale,
            options.tags.find((tag) => tag.id === id)?.nameAr ?? "",
            options.tags.find((tag) => tag.id === id)?.nameEn ?? null,
          )
        : (detail?.tags.find((tag) => tag.id === id)?.name ?? id),
  }));
  const freeTags = options?.tags.filter((tag) => !meta.tagIds.includes(tag.id)) ?? [];
  const tagsFull = meta.tagIds.length >= 12;

  const featuredAlt = featured ? (locale === "en" ? featured.altEn : featured.altAr) : null;
  const featuredNarrow =
    featured !== null && featured.width !== null && featured.width < settings.featuredMinWidth;

  const allowed = new Set(detail?.allowedActions ?? []);
  const tabActions = TAB_ACTIONS.filter((action) => allowed.has(action));

  return (
    <div className="flex flex-col gap-6">
      {detail ? (
        <section aria-label={t("admin.editor.publish.status")} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <EditorStatusBadge status={detail.status} />
            {detail.live ? <EditorLiveBadge /> : null}
            {detail.hasUnpublishedChanges ? <UnpublishedChangesBadge /> : null}
          </div>
          {detail.scheduledAt ? (
            <p className="flex items-center gap-2 text-base text-text">
              <CalendarClock aria-hidden className="size-5 shrink-0 text-primary" />
              {t("admin.editor.publish.scheduledFor", {
                at: formatZoned(detail.scheduledAt, settings.timeZone),
              })}
            </p>
          ) : null}
          {detail.publishedAt ? (
            <p className="text-base text-text-muted">
              {t("admin.editor.publish.publishedAt", {
                at: formatZoned(detail.publishedAt, settings.timeZone),
              })}
            </p>
          ) : null}
          {detail.publicPath ? (
            <Link
              href={detail.publicPath}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center gap-2 text-base text-primary underline"
            >
              <ExternalLink aria-hidden className="size-5" />
              {t("admin.editor.publish.viewLive")}
            </Link>
          ) : null}
          {tabActions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {tabActions.map((action) => (
                <Button
                  key={action}
                  variant={action === "publish" || action === "submit" ? "primary" : "secondary"}
                  loading={busy === action}
                  disabled={busy !== null}
                  onClick={() => {
                    onAction(action);
                  }}
                >
                  {t(ACTION_LABELS[action])}
                </Button>
              ))}
            </div>
          ) : null}
        </section>
      ) : (
        <p className="rounded-lg bg-primary-soft px-4 py-3 text-base text-text">
          {t("admin.editor.publish.newHint")}
        </p>
      )}

      <section
        className="flex flex-col gap-4"
        aria-label={t("admin.editor.publish.classification")}
      >
        <Field
          label={t("admin.editor.field.category")}
          hint={t(
            reviewRequired ? "admin.editor.category.review" : "admin.editor.category.noReview",
          )}
        >
          {(control) => (
            <Select
              {...control}
              disabled={readOnly || options === null}
              value={meta.categoryId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onMeta((current) => ({ ...current, categoryId: value === "" ? null : value }));
              }}
            >
              <option value="">{t("admin.editor.category.none")}</option>
              {topLevel.map((parent) => {
                const children = childrenOf(parent.id);
                const label = name(locale, parent.nameAr, parent.nameEn);
                return children.length === 0 ? (
                  <option key={parent.id} value={parent.id}>
                    {label}
                  </option>
                ) : (
                  <optgroup key={parent.id} label={label}>
                    <option value={parent.id}>{label}</option>
                    {children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {name(locale, child.nameAr, child.nameEn)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          )}
        </Field>

        <Field
          label={t("admin.editor.field.tags")}
          hint={t("admin.editor.tags.counter", { count: meta.tagIds.length, max: 12 })}
        >
          {(control) => (
            <div className="flex flex-col gap-2">
              {selectedTags.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {selectedTags.map((tag) => (
                    <li
                      key={tag.id}
                      className="inline-flex min-h-11 items-center rounded-full bg-primary-soft ps-3 text-base text-text"
                    >
                      <bdi>{tag.label}</bdi>
                      <button
                        type="button"
                        disabled={readOnly}
                        aria-label={t("admin.editor.chips.remove", { value: tag.label })}
                        onClick={() => {
                          onMeta((current) => ({
                            ...current,
                            tagIds: current.tagIds.filter((id) => id !== tag.id),
                          }));
                        }}
                        className="inline-flex size-11 items-center justify-center rounded-full text-text-muted hover:text-danger focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        <X aria-hidden className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Select
                {...control}
                disabled={readOnly || options === null || tagsFull}
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "") return;
                  onMeta((current) => ({
                    ...current,
                    tagIds: [...current.tagIds, value].slice(0, 12),
                  }));
                }}
              >
                <option value="">{t("admin.editor.tags.add")}</option>
                {freeTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {name(locale, tag.nameAr, tag.nameEn)}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </Field>

        <Field label={t("admin.editor.field.author")}>
          {(control) => (
            <Select
              {...control}
              disabled={readOnly || options === null}
              value={meta.primaryAuthorId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onMeta((current) => ({ ...current, primaryAuthorId: value === "" ? null : value }));
              }}
            >
              <option value="">{t("admin.editor.person.none")}</option>
              {options?.authors.map((person) => (
                <option key={person.id} value={person.id}>
                  {name(locale, person.name, person.nameEn)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={t("admin.editor.field.reviewer")} hint={t("admin.editor.reviewer.hint")}>
          {(control) => (
            <Select
              {...control}
              disabled={readOnly || options === null}
              value={meta.reviewerId ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                onMeta((current) => ({ ...current, reviewerId: value === "" ? null : value }));
              }}
            >
              <option value="">{t("admin.editor.person.none")}</option>
              {options?.reviewers.map((person) => (
                <option key={person.id} value={person.id}>
                  {name(locale, person.name, person.nameEn)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </section>

      <section className="flex flex-col" aria-label={t("admin.editor.publish.flags")}>
        <h3 className="mb-1 text-base font-semibold text-text">
          {t("admin.editor.publish.flags")}
        </h3>
        {FLAG_KEYS.map((key) => (
          <SwitchRow
            key={key}
            label={t(`admin.editor.flag.${key}`)}
            hint={t(`admin.editor.flag.${key}.hint`)}
            checked={meta.flags[key]}
            disabled={readOnly}
            onChange={(checked) => {
              onMeta((current) => ({ ...current, flags: { ...current.flags, [key]: checked } }));
            }}
          />
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-label={t("admin.editor.field.featured")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.field.featured")}</h3>
        {featured ? (
          <div className="flex flex-col gap-2">
            <AssetThumb asset={featured} className="max-w-sm rounded-lg" />
            {featuredAlt === null || featuredAlt.trim() === "" ? (
              <p role="status" className="text-sm text-warning">
                {t("admin.editor.featured.noAlt")}
              </p>
            ) : (
              <p className="text-sm text-text-muted">
                <bdi>{featuredAlt}</bdi>
              </p>
            )}
            {featuredNarrow ? (
              <p role="status" className="text-sm text-warning">
                {t("admin.editor.featured.narrow", {
                  width: featured.width ?? 0,
                  min: settings.featuredMinWidth,
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-base text-text-muted">{t("admin.editor.featured.none")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={readOnly} onClick={onPickFeatured}>
            <ImageIcon aria-hidden className="size-5" />
            {t(
              meta.featuredMediaId
                ? "admin.editor.featured.change"
                : "admin.editor.featured.choose",
            )}
          </Button>
          {meta.featuredMediaId ? (
            <Button
              variant="ghost"
              disabled={readOnly}
              onClick={() => {
                onMeta((current) => ({ ...current, featuredMediaId: null }));
              }}
            >
              {t("admin.editor.featured.remove")}
            </Button>
          ) : null}
        </div>
      </section>

      {detail ? (
        <section
          className="flex flex-col gap-2 rounded-lg border border-border p-3"
          aria-label={t("admin.editor.translation.title")}
        >
          <h3 className="flex items-center gap-2 text-base font-semibold text-text">
            <Languages aria-hidden className="size-5 text-primary" />
            {t("admin.editor.translation.title")}
          </h3>
          {detail.translation ? (
            <Link
              href={`/admin/content/${detail.translation.id}`}
              className="inline-flex min-h-11 items-center text-base text-primary underline"
            >
              {t(
                detail.translation.locale === "en"
                  ? "admin.editor.translation.openEn"
                  : "admin.editor.translation.openAr",
              )}
              {" · "}
              {t(`admin.editor.status.${detail.translation.status}`)}
            </Link>
          ) : (
            <Button variant="secondary" onClick={onCreateTwin} className="self-start">
              {t(
                locale === "ar"
                  ? "admin.editor.translation.createEn"
                  : "admin.editor.translation.createAr",
              )}
            </Button>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label={t("admin.editor.gates.title")}>
        <h3 className="text-base font-semibold text-text">{t("admin.editor.gates.title")}</h3>
        <GateList gates={detail?.gates ?? []} />
      </section>
    </div>
  );
}
