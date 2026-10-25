"use client";

import { t } from "@wasfa/shared/i18n";
import {
  MEDIA_LICENCES,
  mediaAssetSchema,
  mediaUsageResponseSchema,
  type MediaAsset,
} from "@wasfa/shared/schemas/media";
import { Badge, Button, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { Clipboard, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { mediaFormSchema, type MediaFormValues } from "../../lib/content-admin-schemas";
import { publicEnv } from "../../lib/env";
import { useApiForm } from "../../lib/forms";
import { mediaObjectUrl } from "../../lib/media-upload";
import { mediaSnippet } from "../../lib/media-upload-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { SlugField } from "./content-slug-field";
import { DetailDrawer } from "./drawer";
import { MediaFocalPicker } from "./media-focal-picker";

export interface MediaAssetDrawerProps {
  asset: MediaAsset | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (asset: MediaAsset) => void;
}

/** The preview variant: the JPEG closest to 960 px wide (large enough to place a focal point on). */
function previewKey(asset: MediaAsset): string | null {
  const jpegs = asset.variants
    .filter((variant) => variant.format === "jpeg")
    .toSorted((a, b) => Math.abs(a.width - 960) - Math.abs(b.width - 960));
  return jpegs[0]?.key ?? null;
}

function initialValues(asset: MediaAsset): MediaFormValues {
  return {
    altAr: asset.altAr ?? "",
    altEn: asset.altEn ?? "",
    caption: asset.caption ?? "",
    credit: asset.credit ?? "",
    licence: asset.licence,
    licenceRef: asset.licenceRef ?? "",
    seoFilename: asset.seoFilename ?? "",
    focalX: asset.focalX,
    focalY: asset.focalY,
  };
}

function UsageList({ id }: { id: string }) {
  const usage = useResource(`/admin/media/${id}/usage`, mediaUsageResponseSchema);
  if (usage.status === "loading") return <p role="status">{t("ui.loading")}</p>;
  if (usage.status === "error") return <ErrorNotice error={usage.error} onRetry={usage.reload} />;
  const { items } = usage.data;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`usage-${id}`}>
      <h3 id={`usage-${id}`} className="text-base font-semibold text-text">
        {t("admin.media.usage.title", { count: items.length })}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-text-muted">{t("admin.media.usage.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.id}-${item.role}`}>
              <Link
                href={`/admin/content/${item.id}`}
                className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-base text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
              >
                <span className="min-w-0 break-words">{item.title}</span>
                <Badge tone="neutral">{t(`admin.media.usage.role.${item.role}`)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetForm({
  asset,
  canWrite,
  onSaved,
}: Omit<MediaAssetDrawerProps, "onClose"> & { asset: MediaAsset }) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const form = useApiForm({
    schema: mediaFormSchema,
    initial: initialValues(asset),
    submit: async (values) => {
      const saved = await reauth.run(() =>
        api(`/admin/media/${asset.id}`, {
          method: "PATCH",
          body: values,
          schema: mediaAssetSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.media.saved") });
      onSaved(saved);
    },
  });
  const announce = form.submitCount > 0;
  const key = previewKey(asset);
  const src = key ? mediaObjectUrl(key, publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN) : null;
  const altMissing = String(form.values.altAr ?? "").trim() === "";
  const licence = String(form.values.licence);

  const copySnippet = () => {
    void navigator.clipboard.writeText(mediaSnippet(asset)).then(() => {
      setCopied(true);
    });
  };

  const area = (name: "caption" | "credit" | "licenceRef", label: string, hint?: string) => (
    <Field label={label} hint={hint} error={form.errors[name]} announceError={announce}>
      {(control) => (
        <Input
          {...control}
          {...form.bind(name)}
          autoComplete="off"
          ltr={name === "licenceRef"}
          disabled={!canWrite}
        />
      )}
    </Field>
  );

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5">
      {asset.status === "rejected" ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-base text-danger">
          {tOr(
            `admin.media.reject.${asset.rejectReason ?? "unknown"}`,
            t("admin.media.reject.unknown"),
          )}
        </p>
      ) : null}

      {asset.status === "ready" ? (
        <MediaFocalPicker
          src={src}
          width={asset.width}
          height={asset.height}
          alt={String(form.values.altAr ?? "") || asset.originalFilename || ""}
          value={{ x: Number(form.values.focalX), y: Number(form.values.focalY) }}
          onChange={(point) => {
            form.setValue("focalX", point.x);
            form.setValue("focalY", point.y);
          }}
        />
      ) : null}

      {altMissing ? (
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("admin.media.altPrompt")}
        </p>
      ) : null}

      <Field
        label={t("admin.media.field.altAr")}
        hint={t("admin.media.field.altHint")}
        error={form.errors["altAr"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="altAr"
            disabled={!canWrite}
            value={String(form.values.altAr ?? "")}
            onChange={(event) => {
              form.setValue("altAr", event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.media.field.altEn")}
        error={form.errors["altEn"]}
        announceError={announce}
      >
        {(control) => (
          <Textarea
            {...control}
            name="altEn"
            ltr
            disabled={!canWrite}
            value={String(form.values.altEn ?? "")}
            onChange={(event) => {
              form.setValue("altEn", event.target.value);
            }}
          />
        )}
      </Field>
      {area("caption", t("admin.media.field.caption"))}
      {area("credit", t("admin.media.field.credit"))}

      <Field
        label={t("admin.media.field.licence")}
        hint={tOr(`admin.media.licence.${licence}.hint`, "")}
      >
        {(control) => (
          <Select {...control} {...form.bind("licence")} disabled={!canWrite}>
            {MEDIA_LICENCES.map((value) => (
              <option key={value} value={value}>
                {t(`admin.media.licence.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {area("licenceRef", t("admin.media.field.licenceRef"), t("admin.media.field.licenceRefHint"))}

      <SlugField
        name="seoFilename"
        label={t("admin.media.field.seoFilename")}
        hint={t("admin.media.field.seoFilenameHint")}
        value={String(form.values.seoFilename ?? "")}
        onChange={(value) => {
          form.setValue("seoFilename", value);
        }}
        suggestFrom={String(form.values.altEn ?? "") || String(form.values.altAr ?? "")}
        error={form.errors["seoFilename"]}
        announceError={announce}
      />

      {asset.warnings.length > 0 ? (
        <section aria-labelledby={`warnings-${asset.id}`} className="flex flex-col gap-1">
          <h3 id={`warnings-${asset.id}`} className="text-base font-semibold text-text">
            {t("admin.media.warnings")}
          </h3>
          <ul className="flex flex-col gap-1 text-sm text-warning">
            {asset.warnings.map((warning) => (
              <li key={warning}>{tOr(`admin.media.warning.${warning}`, warning)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <UsageList id={asset.id} />

      <div className="flex flex-col gap-2">
        <Button variant="secondary" name="copy-snippet" onClick={copySnippet}>
          <Clipboard aria-hidden className="size-5" />
          {t("admin.media.copySnippet")}
        </Button>
        <code
          dir="ltr"
          className="break-all rounded-lg bg-neutral-100 px-3 py-2 text-start text-sm"
        >
          {mediaSnippet({ id: asset.id, altAr: String(form.values.altAr ?? "") || asset.altAr })}
        </code>
        <p role="status" className="text-sm text-text-muted">
          {copied ? t("admin.media.copied") : ""}
        </p>
      </div>

      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      {canWrite ? (
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border bg-surface py-3">
          <Button type="submit" name="save" loading={form.submitting}>
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Detail drawer of one asset: metadata, focal point, usage, the markdown snippet. */
export function MediaAssetDrawer({ asset, canWrite, onClose, onSaved }: MediaAssetDrawerProps) {
  return (
    <DetailDrawer
      open={asset !== null}
      onClose={onClose}
      title={asset?.originalFilename ?? t("admin.media.drawer.title")}
    >
      {/* Keyed by the save time: after a save the form restarts from the stored values. */}
      {asset ? (
        <AssetForm
          key={`${asset.id}-${asset.updatedAt}`}
          asset={asset}
          canWrite={canWrite}
          onSaved={onSaved}
        />
      ) : null}
    </DetailDrawer>
  );
}
