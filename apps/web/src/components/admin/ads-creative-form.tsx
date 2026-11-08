"use client";

import {
  AD_CATEGORIES,
  AD_CHANNELS,
  AD_DEVICES,
  AD_LOCALES,
  AD_PLACEMENT_CATALOG,
  SERVABLE_PAGE_CLASSES,
  adminAdvertiserListSchema,
  adminCreativeSchema,
  createCreativeSchema,
  type AdChannel,
  type AdDevice,
  type AdminCreative,
  type PageClass,
} from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Button, Checkbox, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { ImagePlus, Trash2 } from "lucide-react";
import { useState } from "react";

import { tOr } from "../../lib/admin-format";
import { isoToLocalInput, localInputToIso, parseCountries } from "../../lib/ads-admin";
import { api } from "../../lib/api-client";
import { publicEnv } from "../../lib/env";
import { toApiError } from "../../lib/forms";
import { mediaObjectUrl, thumbnailKey } from "../../lib/media-upload";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { WhatsAppAdPreview } from "./ads-wa-preview";
import { MediaPickerDialog } from "./media-picker-dialog";

import type { ApiRequestError } from "../../lib/api-error";
import type { MediaAsset } from "@wasfa/shared/schemas/media";
import type { FormEvent } from "react";

export const WA_TEXT_MAX = 700;

function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * The creative editor (docs/ADS.md §6): image from the media library (with alt), title, https
 * destination, advertiser or house, category, schedule, weight, targeting, channels and, for
 * WhatsApp, the message text with a bubble preview. A new creative is always saved as a draft;
 * approval is a separate action of the list (it runs the medicine check).
 */
export function AdsCreativeForm({
  creative,
  onSaved,
  onClose,
}: {
  /** `null` creates a draft. */
  creative: AdminCreative | null;
  onSaved: () => void;
  onClose: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const advertisers = useResource("/admin/ads/advertisers", adminAdvertiserListSchema);

  const [title, setTitle] = useState(creative?.title ?? "");
  const [alt, setAlt] = useState(creative?.alt ?? "");
  const [targetUrl, setTargetUrl] = useState(creative?.targetUrl ?? "https://");
  const [advertiserId, setAdvertiserId] = useState(creative?.advertiserId ?? "");
  const [category, setCategory] = useState<string>(creative?.category ?? "house");
  const [imageMediaId, setImageMediaId] = useState<string | null>(creative?.imageMediaId ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(creative?.imageUrl ?? null);
  const [picking, setPicking] = useState(false);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(creative?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(creative?.endsAt ?? null));
  const [weight, setWeight] = useState(String(creative?.weight ?? 100));
  const [placements, setPlacements] = useState<string[]>(creative?.targeting.placements ?? []);
  const [pageClasses, setPageClasses] = useState<PageClass[]>(
    creative?.targeting.pageClasses ?? [],
  );
  const [devices, setDevices] = useState<AdDevice[]>(creative?.targeting.devices ?? []);
  const [locales, setLocales] = useState<("ar" | "en")[]>(creative?.targeting.locales ?? []);
  const [countries, setCountries] = useState((creative?.targeting.countries ?? []).join(" "));
  const [channels, setChannels] = useState<AdChannel[]>(creative?.channels ?? ["web"]);
  const [waText, setWaText] = useState(creative?.waText ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const whatsapp = channels.includes("whatsapp");

  const choose = (asset: MediaAsset) => {
    setImageMediaId(asset.id);
    const key = thumbnailKey(asset);
    setImageUrl(key ? mediaObjectUrl(key, publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN) : null);
    if (alt.trim() === "" && asset.altAr) setAlt(asset.altAr);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const body = {
      advertiserId: advertiserId === "" ? null : advertiserId,
      title,
      imageMediaId,
      alt,
      targetUrl: targetUrl.trim(),
      category,
      channels,
      waText: whatsapp && waText.trim() !== "" ? waText : null,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      weight: Number(weight),
      targeting: {
        placements,
        pageClasses,
        devices,
        locales,
        countries: parseCountries(countries),
      },
    };
    const parsed = createCreativeSchema.safeParse(body);
    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] = tOr(`admin.ads.invalid.${field}`, t("admin.ads.invalid.generic"));
      }
    }
    if (whatsapp && waText.trim() === "") next["waText"] = t("admin.ads.invalid.waText");
    if (!parsed.success || Object.keys(next).length > 0) {
      setErrors(next);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const request = creative
      ? () =>
          api(`/admin/ads/creatives/${creative.id}`, {
            method: "PATCH",
            body: parsed.data,
            schema: adminCreativeSchema,
          })
      : () =>
          api("/admin/ads/creatives", {
            method: "POST",
            body: parsed.data,
            schema: adminCreativeSchema,
          });
    reauth.run(request).then(
      () => {
        toast({
          tone: "success",
          title: t(creative ? "admin.ads.creative.saved" : "admin.ads.creative.created"),
        });
        onSaved();
        onClose();
      },
      (error: unknown) => {
        setSubmitting(false);
        setFormError(toApiError(error));
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {creative === null ? <Notice>{t("admin.ads.creative.draftNote")}</Notice> : null}
      <Field label={t("admin.ads.creative.title")} required error={errors["title"]}>
        {(control) => (
          <Input
            {...control}
            name="title"
            maxLength={120}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        )}
      </Field>

      <div className="flex flex-col gap-2">
        <span className="text-base font-semibold text-text">{t("admin.ads.creative.image")}</span>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an admin preview of a CDN variant
          <img
            src={imageUrl}
            alt={alt}
            className="max-h-40 w-auto max-w-full rounded-lg border border-border object-contain"
          />
        ) : imageMediaId ? (
          <p className="text-sm text-text-muted">{t("admin.ads.creative.imageNoPreview")}</p>
        ) : (
          <p className="text-sm text-text-muted">{t("admin.ads.creative.imageNone")}</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            name="pick-image"
            onClick={() => {
              setPicking(true);
            }}
          >
            <ImagePlus aria-hidden className="size-5" />
            {t(imageMediaId ? "admin.ads.creative.imageChange" : "admin.ads.creative.imagePick")}
          </Button>
          {imageMediaId ? (
            <Button
              type="button"
              variant="ghost"
              name="remove-image"
              onClick={() => {
                setImageMediaId(null);
                setImageUrl(null);
              }}
            >
              <Trash2 aria-hidden className="size-5" />
              {t("admin.ads.creative.imageRemove")}
            </Button>
          ) : null}
        </div>
        {errors["imageMediaId"] ? (
          <p className="text-sm text-danger">{errors["imageMediaId"]}</p>
        ) : null}
        <MediaPickerDialog open={picking} onOpenChange={setPicking} onSelect={choose} />
      </div>

      <Field
        label={t("admin.ads.creative.alt")}
        hint={t("admin.ads.creative.altHint")}
        required
        error={errors["alt"]}
      >
        {(control) => (
          <Input
            {...control}
            name="alt"
            maxLength={300}
            value={alt}
            onChange={(event) => {
              setAlt(event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.ads.creative.targetUrl")}
        hint={t("admin.ads.creative.targetUrlHint")}
        required
        error={errors["targetUrl"]}
      >
        {(control) => (
          <Input
            {...control}
            name="targetUrl"
            type="url"
            ltr
            autoComplete="off"
            value={targetUrl}
            onChange={(event) => {
              setTargetUrl(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.ads.creative.advertiser")} error={errors["advertiserId"]}>
          {(control) => (
            <Select
              {...control}
              name="advertiserId"
              value={advertiserId}
              onChange={(event) => {
                setAdvertiserId(event.target.value);
              }}
            >
              <option value="">{t("admin.ads.creative.house")}</option>
              {(advertisers.status === "ready" ? advertisers.data.items : []).map((advertiser) => (
                <option key={advertiser.id} value={advertiser.id}>
                  {advertiser.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.ads.creative.category")} error={errors["category"]}>
          {(control) => (
            <Select
              {...control}
              name="category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            >
              {AD_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.ads.category.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.ads.creative.startsAt")} error={errors["startsAt"]}>
          {(control) => (
            <Input
              {...control}
              name="startsAt"
              type="datetime-local"
              ltr
              value={startsAt}
              onChange={(event) => {
                setStartsAt(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.ads.creative.endsAt")} error={errors["endsAt"]}>
          {(control) => (
            <Input
              {...control}
              name="endsAt"
              type="datetime-local"
              ltr
              value={endsAt}
              onChange={(event) => {
                setEndsAt(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.ads.creative.weight")}
          hint={t("admin.ads.creative.weightHint")}
          error={errors["weight"]}
        >
          {(control) => (
            <Input
              {...control}
              name="weight"
              type="number"
              inputMode="numeric"
              ltr
              min={1}
              max={1000}
              value={weight}
              onChange={(event) => {
                setWeight(event.target.value);
              }}
            />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("admin.ads.creative.channels")}
        </legend>
        {AD_CHANNELS.map((channel) => (
          <Checkbox
            key={channel}
            name={`channel-${channel}`}
            label={t(`admin.ads.channel.${channel}`)}
            checked={channels.includes(channel)}
            onChange={() => {
              setChannels((current) => toggled(current, channel));
            }}
          />
        ))}
        {errors["channels"] ? <p className="text-sm text-danger">{errors["channels"]}</p> : null}
      </fieldset>

      {whatsapp ? (
        <div className="flex flex-col gap-3">
          <Field
            label={t("admin.ads.creative.waText")}
            hint={t("admin.ads.creative.waTextHint", { max: String(WA_TEXT_MAX) })}
            error={errors["waText"]}
          >
            {(control) => (
              <Textarea
                {...control}
                name="waText"
                rows={5}
                maxLength={WA_TEXT_MAX}
                value={waText}
                onChange={(event) => {
                  setWaText(event.target.value);
                }}
              />
            )}
          </Field>
          <p className="text-sm text-text-muted" data-testid="wa-counter">
            {`${String(waText.length)} / ${String(WA_TEXT_MAX)}`}
          </p>
          <WhatsAppAdPreview text={waText} url={targetUrl} />
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">
          {t("admin.ads.creative.targeting")}
        </legend>
        <p className="text-sm text-text-muted">{t("admin.ads.creative.targetingHint")}</p>
        <span className="mt-2 text-sm font-semibold text-text">
          {t("admin.ads.creative.targetPlacements")}
        </span>
        {AD_PLACEMENT_CATALOG.map((entry) => (
          <Checkbox
            key={entry.key}
            name={`placement-${entry.key}`}
            label={tOr(`admin.ads.placement.${entry.key}`, entry.key)}
            checked={placements.includes(entry.key)}
            onChange={() => {
              setPlacements((current) => toggled(current, entry.key));
            }}
          />
        ))}
        <span className="mt-2 text-sm font-semibold text-text">
          {t("admin.ads.creative.targetClasses")}
        </span>
        {SERVABLE_PAGE_CLASSES.map((pageClass) => (
          <Checkbox
            key={pageClass}
            name={`target-class-${pageClass}`}
            label={t(`admin.ads.class.${pageClass}`)}
            checked={pageClasses.includes(pageClass)}
            onChange={() => {
              setPageClasses((current) => toggled(current, pageClass));
            }}
          />
        ))}
        <span className="mt-2 text-sm font-semibold text-text">
          {t("admin.ads.creative.targetDevices")}
        </span>
        {AD_DEVICES.map((device) => (
          <Checkbox
            key={device}
            name={`target-device-${device}`}
            label={t(`admin.ads.device.${device}`)}
            checked={devices.includes(device)}
            onChange={() => {
              setDevices((current) => toggled(current, device));
            }}
          />
        ))}
        <span className="mt-2 text-sm font-semibold text-text">
          {t("admin.ads.creative.targetLocales")}
        </span>
        {AD_LOCALES.map((locale) => (
          <Checkbox
            key={locale}
            name={`target-locale-${locale}`}
            label={t(`admin.ads.locale.${locale}`)}
            checked={locales.includes(locale)}
            onChange={() => {
              setLocales((current) => toggled(current, locale));
            }}
          />
        ))}
        <Field
          label={t("admin.ads.creative.targetCountries")}
          hint={t("admin.ads.creative.targetCountriesHint")}
          error={errors["targeting"]}
        >
          {(control) => (
            <Input
              {...control}
              name="countries"
              ltr
              autoComplete="off"
              value={countries}
              onChange={(event) => {
                setCountries(event.target.value);
              }}
            />
          )}
        </Field>
      </fieldset>

      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="save" loading={submitting}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
