"use client";

import { t } from "@wasfa/shared/i18n";
import {
  TELEGRAM_AD_TRIGGERS,
  telegramAdsSettingsSchema,
  type TelegramAdsSettings,
} from "@wasfa/shared/telegram-ads";
import { Button, Card, CardTitle, Checkbox, Field, Input, cn, useToast } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ADS_BASE, policySentence, toggled } from "../../lib/telegram-ads-admin";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ResourceBoundary } from "./resource-boundary";
import { TelegramAdsShell } from "./telegram-ads-shell";

import type { ApiRequestError } from "../../lib/api-error";

type LimitKey =
  "probability" | "maxPerChatPerDay" | "maxPerChatPerWeek" | "minGapMinutes" | "globalDailyLimit";

const LIMITS: readonly {
  key: LimitKey;
  /** What the number input shows is `value * scale` (probability is stored 0-1, shown 0-100). */
  scale: number;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "probability", scale: 100, min: 0, max: 100, step: 5 },
  { key: "maxPerChatPerDay", scale: 1, min: 1, max: 1_000_000_000, step: 1 },
  { key: "maxPerChatPerWeek", scale: 1, min: 1, max: 1_000_000_000, step: 1 },
  { key: "minGapMinutes", scale: 1, min: 0, max: 100_000, step: 5 },
  { key: "globalDailyLimit", scale: 1, min: 1, max: 1_000_000_000, step: 100 },
];

/** One limit: a switch ("enforce") and a number that is disabled and muted while the limit is off. */
function LimitRow({
  limitKey,
  scale,
  min,
  max,
  step,
  limit,
  disabled,
  onChange,
}: {
  limitKey: LimitKey;
  scale: number;
  min: number;
  max: number;
  step: number;
  limit: { enabled: boolean; value: number };
  disabled: boolean;
  onChange: (next: { enabled: boolean; value: number }) => void;
}) {
  const off = !limit.enabled;
  const shown = Math.round(limit.value * scale * 1_000) / 1_000;
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
      data-testid={`limit-${limitKey}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold text-text">{t(`admin.tgAds.limit.${limitKey}`)}</p>
        <Checkbox
          role="switch"
          name={`${limitKey}-enabled`}
          label={t("admin.tgAds.limit.enforce")}
          checked={limit.enabled}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...limit, enabled: event.target.checked });
          }}
        />
      </div>
      <p className="text-sm text-text-muted">{t(`admin.tgAds.limit.${limitKey}.help`)}</p>
      <Field
        label={t(`admin.tgAds.limit.${limitKey}.field`)}
        hint={off ? t("admin.tgAds.limit.offLabel") : undefined}
      >
        {(control) => (
          <Input
            {...control}
            name={`${limitKey}-value`}
            type="number"
            inputMode="decimal"
            ltr
            min={min}
            max={max}
            step={step}
            disabled={disabled || off}
            className={cn(off && "opacity-50")}
            value={off ? "" : String(shown)}
            placeholder={off ? t("admin.tgAds.limit.offLabel") : undefined}
            onChange={(event) => {
              const typed = Number(event.target.value);
              onChange({ ...limit, value: Number.isFinite(typed) ? typed / scale : limit.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

export function TelegramAdsSettingsForm({
  initial,
  canWrite,
  onSaved,
}: {
  initial: TelegramAdsSettings;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<TelegramAdsSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiRequestError | null>(null);
  const [invalid, setInvalid] = useState(false);
  const disabled = busy || !canWrite;

  const setLimit = (key: LimitKey, next: { enabled: boolean; value: number }) => {
    setDraft((current) => ({ ...current, [key]: next }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = telegramAdsSettingsSchema.safeParse(draft);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    setFailure(null);
    reauth
      .run(() =>
        api(`${ADS_BASE}/settings`, {
          method: "PUT",
          body: parsed.data,
          schema: telegramAdsSettingsSchema,
        }),
      )
      .then(
        () => {
          setBusy(false);
          toast({ tone: "success", title: t("admin.tgAds.settings.saved") });
          onSaved();
        },
        (error: unknown) => {
          setBusy(false);
          setFailure(toApiError(error));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Card
        elevation="flat"
        className="flex flex-col gap-1 border-s-4 border-s-primary"
        data-testid="tg-policy"
      >
        <CardTitle>{t("admin.tgAds.policy.title")}</CardTitle>
        <p className="text-base text-text">{policySentence(draft)}</p>
      </Card>

      <Card elevation="flat" className="flex flex-col gap-2">
        <Checkbox
          role="switch"
          name="ads-enabled"
          label={t("admin.tgAds.settings.enabled")}
          checked={draft.enabled}
          disabled={disabled}
          onChange={(event) => {
            setDraft((current) => ({ ...current, enabled: event.target.checked }));
          }}
        />
        <p className="text-sm text-text-muted">{t("admin.tgAds.settings.enabledHelp")}</p>
        <p className="text-sm text-text-muted">{t("admin.tgAds.settings.floor")}</p>
      </Card>

      <section className="flex flex-col gap-3" aria-label={t("admin.tgAds.settings.limits")}>
        <h2 className="font-heading text-xl font-semibold text-text">
          {t("admin.tgAds.settings.limits")}
        </h2>
        <p className="text-sm text-text-muted">{t("admin.tgAds.settings.limitsHelp")}</p>
        {LIMITS.map((entry) => (
          <LimitRow
            key={entry.key}
            limitKey={entry.key}
            scale={entry.scale}
            min={entry.min}
            max={entry.max}
            step={entry.step}
            limit={draft[entry.key]}
            disabled={disabled}
            onChange={(next) => {
              setLimit(entry.key, next);
            }}
          />
        ))}
      </section>

      <Card elevation="flat" className="flex flex-col gap-3" data-testid="limit-quietHours">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("admin.tgAds.quiet.title")}</CardTitle>
          <Checkbox
            role="switch"
            name="quiet-enabled"
            label={t("admin.tgAds.limit.enforce")}
            checked={draft.quietHours.enabled}
            disabled={disabled}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                quietHours: { ...current.quietHours, enabled: event.target.checked },
              }));
            }}
          />
        </div>
        <p className="text-sm text-text-muted">
          {draft.quietHours.enabled ? t("admin.tgAds.quiet.help") : t("admin.tgAds.limit.offLabel")}
        </p>
        <div className={cn("grid gap-4 sm:grid-cols-3", !draft.quietHours.enabled && "opacity-50")}>
          <Field label={t("admin.tgAds.quiet.start")}>
            {(control) => (
              <Input
                {...control}
                name="quiet-start"
                type="time"
                ltr
                disabled={disabled || !draft.quietHours.enabled}
                value={draft.quietHours.start}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, start: event.target.value },
                  }));
                }}
              />
            )}
          </Field>
          <Field label={t("admin.tgAds.quiet.end")}>
            {(control) => (
              <Input
                {...control}
                name="quiet-end"
                type="time"
                ltr
                disabled={disabled || !draft.quietHours.enabled}
                value={draft.quietHours.end}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, end: event.target.value },
                  }));
                }}
              />
            )}
          </Field>
          <Field label={t("admin.tgAds.quiet.timezone")}>
            {(control) => (
              <Input
                {...control}
                name="quiet-timezone"
                ltr
                maxLength={64}
                disabled={disabled || !draft.quietHours.enabled}
                value={draft.quietHours.timezone}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    quietHours: { ...current.quietHours, timezone: event.target.value },
                  }));
                }}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card elevation="flat" className="flex flex-col gap-2">
        <CardTitle>{t("admin.tgAds.triggers.title")}</CardTitle>
        <p className="text-sm text-text-muted">{t("admin.tgAds.triggers.help")}</p>
        {TELEGRAM_AD_TRIGGERS.map((trigger) => (
          <div key={trigger} className="flex flex-col">
            <Checkbox
              name={`trigger-${trigger}`}
              label={t(`admin.tgAds.trigger.${trigger}`)}
              checked={draft.triggers.includes(trigger)}
              disabled={disabled}
              onChange={() => {
                setDraft((current) => ({
                  ...current,
                  triggers: toggled(current.triggers, trigger),
                }));
              }}
            />
            <p className="ps-9 text-sm text-text-muted">
              {t(`admin.tgAds.trigger.${trigger}.help`)}
            </p>
          </div>
        ))}
      </Card>

      <Card elevation="flat" className="flex flex-col gap-2">
        <Checkbox
          role="switch"
          name="allow-hide"
          label={t("admin.tgAds.settings.allowHide")}
          checked={draft.allowHide}
          disabled={disabled}
          onChange={(event) => {
            setDraft((current) => ({ ...current, allowHide: event.target.checked }));
          }}
        />
        <p className="text-sm text-text-muted">{t("admin.tgAds.settings.allowHideHelp")}</p>
        <Checkbox
          role="switch"
          name="allow-reactions"
          label={t("admin.tgAds.settings.allowReactions")}
          checked={draft.allowReactions}
          disabled={disabled}
          onChange={(event) => {
            setDraft((current) => ({ ...current, allowReactions: event.target.checked }));
          }}
        />
        <p className="text-sm text-text-muted">{t("admin.tgAds.settings.allowReactionsHelp")}</p>
      </Card>

      {invalid ? <Notice tone="warning">{t("admin.tgAds.settings.invalid")}</Notice> : null}
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" name="ads-settings-save" loading={busy}>
            {t("admin.tgAds.settings.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** `/admin/telegram/ads/settings`: every delivery limit is a switch plus a number; off means no limit. */
export function TelegramAdsSettingsView({ canWrite }: { canWrite: boolean }) {
  const settings = useResource(`${ADS_BASE}/settings`, telegramAdsSettingsSchema);
  return (
    <TelegramAdsShell title={t("admin.tgAds.settings.title")}>
      <ResourceBoundary resource={settings}>
        {(data) => (
          <TelegramAdsSettingsForm initial={data} canWrite={canWrite} onSaved={settings.reload} />
        )}
      </ResourceBoundary>
    </TelegramAdsShell>
  );
}
