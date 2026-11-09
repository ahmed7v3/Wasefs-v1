"use client";

import { t } from "@wasfa/shared/i18n";
import {
  telegramAdCreativeInputSchema,
  telegramAdCreativeSchema,
  type TelegramAdCampaign,
  type TelegramAdCreative,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import {
  TELEGRAM_AD_AUDIENCES,
  TELEGRAM_AD_BODY_MAX,
  TELEGRAM_AD_BUTTONS_MAX,
  TELEGRAM_AD_HEADLINE_MAX,
  TELEGRAM_AD_LAYOUTS,
  TELEGRAM_AD_TRIGGERS,
  telegramAdButtonSchema,
  telegramAdsSettingsSchema,
  type TelegramAdLayout,
} from "@wasfa/shared/telegram-ads";
import { Button, Checkbox, Field, Input, Select, Textarea, cn, useToast } from "@wasfa/ui";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState, type FormEvent } from "react";

import { tOr } from "../../lib/admin-format";
import { isoToLocalInput, localInputToIso } from "../../lib/ads-admin";
import { api } from "../../lib/api-client";
import { publicEnv } from "../../lib/env";
import { toApiError } from "../../lib/forms";
import { mediaObjectUrl, thumbnailKey } from "../../lib/media-upload";
import { useReauth } from "../../lib/reauth";
import { ADS_BASE, moveItem, toggled } from "../../lib/telegram-ads-admin";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { MediaPickerDialog } from "./media-picker-dialog";
import { TelegramAdPreview } from "./telegram-ad-preview";

import type { ApiRequestError } from "../../lib/api-error";
import type { MediaAsset } from "@wasfa/shared/schemas/media";

/** The form never sends a status: a new creative is a draft (the server default), and the list owns approve / pause / archive. */
const creativeFormSchema = telegramAdCreativeInputSchema.omit({ status: true });

interface ButtonDraft {
  label: string;
  url: string;
}

/** Tiny drawings of the three layouts, so the choice is visual. */
function LayoutIllustration({ layout }: { layout: TelegramAdLayout }) {
  return (
    <span
      aria-hidden
      className="flex h-14 w-20 flex-col gap-1 rounded-md border border-border bg-neutral-100 p-1"
    >
      {layout === "hero" ? <span className="h-6 rounded-sm bg-primary/40" /> : null}
      {layout === "compact" ? (
        <span className="h-2 w-3/4 rounded-sm bg-neutral-400" />
      ) : (
        <>
          <span className="h-2 w-3/4 rounded-sm bg-neutral-500" />
          <span className="h-1.5 w-full rounded-sm bg-neutral-300" />
          {layout === "card" ? <span className="h-1.5 w-2/3 rounded-sm bg-neutral-300" /> : null}
        </>
      )}
      <span className="mt-auto h-2 rounded-sm bg-primary/30" />
    </span>
  );
}

/**
 * The creative editor with its live Telegram preview beside it. A new creative is a draft; approval
 * is a separate action in the list. Hero needs an image; every button link is https.
 */
export function TelegramAdCreativeForm({
  creative,
  defaultCampaignId,
  campaigns,
  onSaved,
  onClose,
}: {
  /** `null` creates a draft. */
  creative: TelegramAdCreative | null;
  defaultCampaignId: string;
  campaigns: readonly TelegramAdCampaign[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  // The preview shows the 👍 / hide buttons the bot will show, which the settings decide.
  const settings = useResource(`${ADS_BASE}/settings`, telegramAdsSettingsSchema);
  const allowReactions = settings.status === "ready" ? settings.data.allowReactions : true;
  const allowHide = settings.status === "ready" ? settings.data.allowHide : true;

  const [campaignId, setCampaignId] = useState(
    creative?.campaignId ?? (defaultCampaignId || campaigns[0]?.id || ""),
  );
  const [name, setName] = useState(creative?.name ?? "");
  const [layout, setLayout] = useState<TelegramAdLayout>(creative?.layout ?? "hero");
  const [headline, setHeadline] = useState(creative?.headline ?? "");
  const [body, setBody] = useState(creative?.body ?? "");
  const [imageMediaId, setImageMediaId] = useState<string | null>(creative?.imageMediaId ?? null);
  const [imageUrl, setImageUrl] = useState<string | null>(creative?.imageUrl ?? null);
  const [picking, setPicking] = useState(false);
  const [buttons, setButtons] = useState<ButtonDraft[]>(
    (creative?.buttons ?? []).map((button) => ({ ...button })),
  );
  const [buttonsPerRow, setButtonsPerRow] = useState<1 | 2>(creative?.buttonsPerRow ?? 1);
  const [category, setCategory] = useState(creative?.category ?? "general");
  const [weight, setWeight] = useState(creative?.weight ?? 100);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(creative?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(creative?.endsAt ?? null));
  const [locales, setLocales] = useState<("ar" | "en")[]>(creative?.targeting.locales ?? []);
  const [audience, setAudience] = useState<(typeof TELEGRAM_AD_AUDIENCES)[number]>(
    creative?.targeting.audience ?? "all",
  );
  const [triggers, setTriggers] = useState<(typeof TELEGRAM_AD_TRIGGERS)[number][]>(
    creative?.targeting.triggers ?? [],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [buttonErrors, setButtonErrors] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const choose = (asset: MediaAsset) => {
    setImageMediaId(asset.id);
    const key = thumbnailKey(asset);
    setImageUrl(key ? mediaObjectUrl(key, publicEnv.NEXT_PUBLIC_MEDIA_ORIGIN) : null);
  };

  const updateButton = (index: number, patch: Partial<ButtonDraft>) => {
    setButtons((current) =>
      current.map((button, position) => (position === index ? { ...button, ...patch } : button)),
    );
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const trimmed = buttons.map((button) => ({
      label: button.label.trim(),
      url: button.url.trim(),
    }));
    const parsed = creativeFormSchema.safeParse({
      campaignId,
      name,
      layout,
      headline,
      body,
      imageMediaId,
      buttons: trimmed,
      buttonsPerRow,
      category,
      weight,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      targeting: { locales, audience, triggers },
    });
    const next: Record<string, string> = {};
    const nextButtons: Record<number, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] = tOr(`admin.tgAds.invalid.${field}`, t("admin.tgAds.invalid.generic"));
      }
    }
    trimmed.forEach((button, index) => {
      if (telegramAdButtonSchema.safeParse(button).success) return;
      nextButtons[index] =
        button.url !== "" && !button.url.startsWith("https://")
          ? t("admin.tgAds.invalid.buttonHttps")
          : t("admin.tgAds.invalid.button");
      delete next["buttons"];
    });
    if (buttons.length > TELEGRAM_AD_BUTTONS_MAX)
      next["buttons"] = t("admin.tgAds.invalid.buttons");
    if (layout === "hero" && imageMediaId === null) {
      next["imageMediaId"] = t("admin.tgAds.invalid.heroNeedsImage");
    }
    if (campaignId === "") next["campaignId"] = t("admin.tgAds.invalid.campaignId");
    if (!parsed.success || Object.keys(next).length > 0 || Object.keys(nextButtons).length > 0) {
      setErrors(next);
      setButtonErrors(nextButtons);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setButtonErrors({});
    setFormError(null);
    const request = () =>
      creative
        ? api(`${ADS_BASE}/creatives/${creative.id}`, {
            method: "PATCH",
            body: parsed.data,
            schema: telegramAdCreativeSchema,
          })
        : api(`${ADS_BASE}/creatives`, {
            method: "POST",
            body: parsed.data,
            schema: telegramAdCreativeSchema,
          });
    reauth.run(request).then(
      () => {
        toast({
          tone: "success",
          title: t(creative ? "admin.tgAds.creative.saved" : "admin.tgAds.creative.created"),
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
        {creative === null ? <Notice>{t("admin.tgAds.creative.draftNote")}</Notice> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.tgAds.creative.campaign")} required error={errors["campaignId"]}>
            {(control) => (
              <Select
                {...control}
                name="campaignId"
                value={campaignId}
                onChange={(event) => {
                  setCampaignId(event.target.value);
                }}
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.tgAds.creative.name")} required error={errors["name"]}>
            {(control) => (
              <Input
                {...control}
                name="name"
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-text">
            {t("admin.tgAds.creative.layout")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {TELEGRAM_AD_LAYOUTS.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors duration-150 has-[:focus-visible]:shadow-focus",
                  layout === value
                    ? "border-primary bg-primary-soft"
                    : "border-border hover:bg-primary-soft/50",
                )}
              >
                <input
                  type="radio"
                  name="layout"
                  value={value}
                  checked={layout === value}
                  className="sr-only"
                  onChange={() => {
                    setLayout(value);
                  }}
                />
                <LayoutIllustration layout={value} />
                <span className="text-sm font-semibold text-text">
                  {t(`admin.tgAds.layout.${value}`)}
                </span>
                <span className="text-xs text-text-muted">
                  {t(`admin.tgAds.layout.${value}.hint`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Field
          label={t("admin.tgAds.creative.headline")}
          hint={t("admin.tgAds.counter", { count: headline.length, max: TELEGRAM_AD_HEADLINE_MAX })}
          required
          error={errors["headline"]}
        >
          {(control) => (
            <Input
              {...control}
              name="headline"
              maxLength={TELEGRAM_AD_HEADLINE_MAX}
              value={headline}
              onChange={(event) => {
                setHeadline(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label={t("admin.tgAds.creative.body")}
          hint={t("admin.tgAds.counter", { count: body.length, max: TELEGRAM_AD_BODY_MAX })}
          error={errors["body"]}
        >
          {(control) => (
            <Textarea
              {...control}
              name="body"
              rows={5}
              maxLength={TELEGRAM_AD_BODY_MAX}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-base font-semibold text-text">
            {t("admin.tgAds.creative.image")}
            {layout === "hero" ? <span className="text-danger"> *</span> : null}
          </span>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin preview of a CDN variant
            <img
              src={imageUrl}
              alt=""
              className="max-h-40 w-auto max-w-full rounded-lg border border-border object-contain"
            />
          ) : imageMediaId ? (
            <p className="text-sm text-text-muted">{t("admin.tgAds.creative.imageNoPreview")}</p>
          ) : (
            <p className="text-sm text-text-muted">
              {t(
                layout === "hero"
                  ? "admin.tgAds.creative.imageRequired"
                  : "admin.tgAds.creative.imageNone",
              )}
            </p>
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
              {t(
                imageMediaId
                  ? "admin.tgAds.creative.imageChange"
                  : "admin.tgAds.creative.imagePick",
              )}
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
                {t("admin.tgAds.creative.imageRemove")}
              </Button>
            ) : null}
          </div>
          {errors["imageMediaId"] ? (
            <p role="alert" className="text-sm text-danger">
              {errors["imageMediaId"]}
            </p>
          ) : null}
          <MediaPickerDialog open={picking} onOpenChange={setPicking} onSelect={choose} />
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold text-text">
            {t("admin.tgAds.creative.buttons")}
          </legend>
          <p className="text-sm text-text-muted">
            {t("admin.tgAds.creative.buttonsHint", { max: TELEGRAM_AD_BUTTONS_MAX })}
          </p>
          {buttons.map((button, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("admin.tgAds.creative.buttonLabel", { n: index + 1 })}>
                  {(control) => (
                    <Input
                      {...control}
                      name={`button-label-${String(index)}`}
                      maxLength={40}
                      value={button.label}
                      onChange={(event) => {
                        updateButton(index, { label: event.target.value });
                      }}
                    />
                  )}
                </Field>
                <Field
                  label={t("admin.tgAds.creative.buttonUrl", { n: index + 1 })}
                  error={buttonErrors[index]}
                >
                  {(control) => (
                    <Input
                      {...control}
                      name={`button-url-${String(index)}`}
                      type="url"
                      ltr
                      autoComplete="off"
                      value={button.url}
                      onChange={(event) => {
                        updateButton(index, { url: event.target.value });
                      }}
                    />
                  )}
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  name={`button-up-${String(index)}`}
                  disabled={index === 0}
                  aria-label={t("admin.tgAds.creative.buttonUp", { n: index + 1 })}
                  onClick={() => {
                    setButtons((current) => moveItem(current, index, index - 1));
                  }}
                >
                  <ArrowUp aria-hidden className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  name={`button-down-${String(index)}`}
                  disabled={index === buttons.length - 1}
                  aria-label={t("admin.tgAds.creative.buttonDown", { n: index + 1 })}
                  onClick={() => {
                    setButtons((current) => moveItem(current, index, index + 1));
                  }}
                >
                  <ArrowDown aria-hidden className="size-5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  name={`button-remove-${String(index)}`}
                  onClick={() => {
                    setButtons((current) => current.filter((_, position) => position !== index));
                  }}
                >
                  <Trash2 aria-hidden className="size-5" />
                  {t("admin.tgAds.creative.buttonRemove")}
                </Button>
              </div>
            </div>
          ))}
          {errors["buttons"] ? <p className="text-sm text-danger">{errors["buttons"]}</p> : null}
          <div className="flex flex-wrap items-end gap-3">
            <Button
              type="button"
              variant="secondary"
              name="add-button"
              disabled={buttons.length >= TELEGRAM_AD_BUTTONS_MAX}
              onClick={() => {
                setButtons((current) => [...current, { label: "", url: "https://" }]);
              }}
            >
              <Plus aria-hidden className="size-5" />
              {t("admin.tgAds.creative.buttonAdd")}
            </Button>
            <Field label={t("admin.tgAds.creative.perRow")} className="basis-48">
              {(control) => (
                <Select
                  {...control}
                  name="buttonsPerRow"
                  value={String(buttonsPerRow)}
                  onChange={(event) => {
                    setButtonsPerRow(event.target.value === "2" ? 2 : 1);
                  }}
                >
                  <option value="1">{t("admin.tgAds.creative.perRow1")}</option>
                  <option value="2">{t("admin.tgAds.creative.perRow2")}</option>
                </Select>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-base font-semibold text-text">
            {t("admin.tgAds.creative.targeting")}
          </legend>
          <p className="text-sm text-text-muted">{t("admin.tgAds.creative.targetingHint")}</p>
          <span className="text-sm font-semibold text-text">
            {t("admin.tgAds.creative.languages")}
          </span>
          {(["ar", "en"] as const).map((locale) => (
            <Checkbox
              key={locale}
              name={`locale-${locale}`}
              label={t(`admin.tgAds.creative.lang.${locale}`)}
              checked={locales.includes(locale)}
              onChange={() => {
                setLocales((current) => toggled(current, locale));
              }}
            />
          ))}
          <Field label={t("admin.tgAds.creative.audience")}>
            {(control) => (
              <Select
                {...control}
                name="audience"
                value={audience}
                onChange={(event) => {
                  const value = TELEGRAM_AD_AUDIENCES.find((item) => item === event.target.value);
                  setAudience(value ?? "all");
                }}
              >
                {TELEGRAM_AD_AUDIENCES.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.tgAds.audience.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <span className="text-sm font-semibold text-text">
            {t("admin.tgAds.creative.triggers")}
          </span>
          <p className="text-sm text-text-muted">{t("admin.tgAds.creative.triggersHint")}</p>
          {TELEGRAM_AD_TRIGGERS.map((trigger) => (
            <Checkbox
              key={trigger}
              name={`trigger-${trigger}`}
              label={t(`admin.tgAds.trigger.${trigger}`)}
              checked={triggers.includes(trigger)}
              onChange={() => {
                setTriggers((current) => toggled(current, trigger));
              }}
            />
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <label htmlFor="tg-ad-weight" className="text-base font-semibold text-text">
            {t("admin.tgAds.creative.weight")}: <bdi dir="ltr">{weight}</bdi>
          </label>
          <input
            id="tg-ad-weight"
            name="weight"
            type="range"
            min={1}
            max={1000}
            value={weight}
            className="w-full accent-primary"
            onChange={(event) => {
              setWeight(Number(event.target.value));
            }}
          />
          <p className="text-sm text-text-muted">{t("admin.tgAds.creative.weightHint")}</p>
          {errors["weight"] ? <p className="text-sm text-danger">{errors["weight"]}</p> : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.tgAds.creative.startsAt")} error={errors["startsAt"]}>
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
          <Field label={t("admin.tgAds.creative.endsAt")} error={errors["endsAt"]}>
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
        </div>

        <Field
          label={t("admin.tgAds.creative.category")}
          hint={t("admin.tgAds.creative.categoryHint")}
          error={errors["category"]}
        >
          {(control) => (
            <Input
              {...control}
              name="category"
              maxLength={60}
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            />
          )}
        </Field>
        <p
          className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text"
          data-testid="tg-medicine-warning"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          {t("admin.tgAds.creative.medicineWarning")}
        </p>

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

      <aside className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <TelegramAdPreview
          layout={layout}
          headline={headline}
          body={body}
          imageUrl={imageUrl}
          buttons={buttons}
          buttonsPerRow={buttonsPerRow}
          allowReactions={allowReactions}
          allowHide={allowHide}
        />
      </aside>
    </div>
  );
}
