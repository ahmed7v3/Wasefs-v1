"use client";

import {
  AD_WHATSAPP_TRIGGERS,
  adsSettingsSchema,
  adsWhatsappSettingsSchema,
  type AdWhatsappTrigger,
  type AdsSettings,
} from "@wasfa/shared/ads";
import { t } from "@wasfa/shared/i18n";
import { Button, Checkbox, Field, Input, useToast } from "@wasfa/ui";
import { useState } from "react";

import { tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ResourceBoundary } from "./resource-boundary";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

type WhatsappSettings = AdsSettings["whatsapp"];

function WhatsappForm({
  initial,
  canWrite,
  onSaved,
}: {
  initial: WhatsappSettings;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [triggers, setTriggers] = useState<AdWhatsappTrigger[]>(initial.triggers);
  const [probability, setProbability] = useState(String(Math.round(initial.probability * 100)));
  const [maxPerUserPerDay, setMaxPerUserPerDay] = useState(String(initial.maxPerUserPerDay));
  const [minGapHours, setMinGapHours] = useState(String(initial.minGapHours));
  const [globalDailyLimit, setGlobalDailyLimit] = useState(String(initial.globalDailyLimit));
  const [quietFrom, setQuietFrom] = useState(initial.quietHours.from);
  const [quietTo, setQuietTo] = useState(initial.quietHours.to);
  const [timezone, setTimezone] = useState(initial.quietHours.timezone);
  const [allowOptOut, setAllowOptOut] = useState(initial.allowOptOut);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const num = (
    name: string,
    label: string,
    value: string,
    set: (value: string) => void,
    hint?: string,
  ) => (
    <Field label={label} hint={hint} error={errors[name]}>
      {(control) => (
        <Input
          {...control}
          name={name}
          type="number"
          inputMode="numeric"
          ltr
          disabled={!canWrite}
          value={value}
          onChange={(event) => {
            set(event.target.value);
          }}
        />
      )}
    </Field>
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !canWrite) return;
    const parsed = adsWhatsappSettingsSchema.safeParse({
      enabled,
      triggers,
      probability: Number(probability) / 100,
      maxPerUserPerDay: Number(maxPerUserPerDay),
      minGapHours: Number(minGapHours),
      globalDailyLimit: Number(globalDailyLimit),
      quietHours: { from: quietFrom, to: quietTo, timezone },
      allowOptOut,
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            t("admin.ads.invalid.generic"),
          ]),
        ),
      );
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    reauth
      .run(() =>
        api("/admin/ads/settings", {
          method: "PATCH",
          body: { whatsapp: parsed.data },
          schema: adsSettingsSchema,
        }),
      )
      .then(
        () => {
          setSubmitting(false);
          toast({ tone: "success", title: t("admin.ads.wa.saved") });
          onSaved();
        },
        (error: unknown) => {
          setSubmitting(false);
          setFormError(toApiError(error));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5">
      <Notice>{t("admin.ads.wa.intro")}</Notice>
      <Checkbox
        name="enabled"
        label={t("admin.ads.wa.enabled")}
        checked={enabled}
        disabled={!canWrite}
        onChange={(event) => {
          setEnabled(event.target.checked);
        }}
      />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-base font-semibold text-text">{t("admin.ads.wa.triggers")}</legend>
        {AD_WHATSAPP_TRIGGERS.map((trigger) => (
          <Checkbox
            key={trigger}
            name={`trigger-${trigger}`}
            label={tOr(`admin.ads.placement.whatsapp.${trigger.replace(":", ".")}`, trigger)}
            checked={triggers.includes(trigger)}
            disabled={!canWrite}
            onChange={() => {
              setTriggers((current) =>
                current.includes(trigger)
                  ? current.filter((item) => item !== trigger)
                  : [...current, trigger],
              );
            }}
          />
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {num(
          "probability",
          t("admin.ads.wa.probability"),
          probability,
          setProbability,
          t("admin.ads.wa.probabilityHint"),
        )}
        {num(
          "maxPerUserPerDay",
          t("admin.ads.wa.maxPerUserPerDay"),
          maxPerUserPerDay,
          setMaxPerUserPerDay,
        )}
        {num("minGapHours", t("admin.ads.wa.minGapHours"), minGapHours, setMinGapHours)}
        {num(
          "globalDailyLimit",
          t("admin.ads.wa.globalDailyLimit"),
          globalDailyLimit,
          setGlobalDailyLimit,
        )}
        <Field label={t("admin.ads.wa.quietFrom")} error={errors["quietHours"]}>
          {(control) => (
            <Input
              {...control}
              name="quietFrom"
              type="time"
              ltr
              disabled={!canWrite}
              value={quietFrom}
              onChange={(event) => {
                setQuietFrom(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.ads.wa.quietTo")}>
          {(control) => (
            <Input
              {...control}
              name="quietTo"
              type="time"
              ltr
              disabled={!canWrite}
              value={quietTo}
              onChange={(event) => {
                setQuietTo(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.ads.wa.timezone")}>
          {(control) => (
            <Input
              {...control}
              name="timezone"
              ltr
              disabled={!canWrite}
              value={timezone}
              onChange={(event) => {
                setTimezone(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Checkbox
        name="allowOptOut"
        label={t("admin.ads.wa.allowOptOut")}
        checked={allowOptOut}
        disabled={!canWrite}
        onChange={(event) => {
          setAllowOptOut(event.target.checked);
        }}
      />
      {formError ? <ErrorNotice error={formError} /> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" name="save" loading={submitting}>
            {t("common.save")}
          </Button>
        </div>
      ) : (
        <Notice>{t("admin.ads.readOnly")}</Notice>
      )}
    </form>
  );
}

/** WhatsApp ads behaviour: the `ads.whatsapp` setting (triggers, probability, caps, quiet hours, opt-out). */
export function AdsWhatsappView({ canWrite }: { canWrite: boolean }) {
  const settings = useResource("/admin/ads/settings", adsSettingsSchema);
  return (
    <ResourceBoundary resource={settings}>
      {(data) => (
        <WhatsappForm
          key={JSON.stringify(data.whatsapp)}
          initial={data.whatsapp}
          canWrite={canWrite}
          onSaved={settings.reload}
        />
      )}
    </ResourceBoundary>
  );
}
