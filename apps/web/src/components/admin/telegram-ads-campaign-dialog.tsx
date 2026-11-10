"use client";

import { t } from "@wasfa/shared/i18n";
import {
  telegramAdCampaignInputSchema,
  telegramAdCampaignSchema,
  type TelegramAdCampaign,
} from "@wasfa/shared/schemas/admin-telegram-ads";
import { TELEGRAM_CAMPAIGN_STATUSES } from "@wasfa/shared/telegram-ads";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { tOr } from "../../lib/admin-format";
import { isoToLocalInput, localInputToIso } from "../../lib/ads-admin";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ADS_BASE } from "../../lib/telegram-ads-admin";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";

const DEFAULT_CAP = "1000";

/** A cap with its "no limit" switch: switched on (unlimited) the number is disabled and saved as null. */
function CapField({
  name,
  label,
  hint,
  unlimited,
  value,
  error,
  onUnlimited,
  onValue,
}: {
  name: string;
  label: string;
  hint: string;
  unlimited: boolean;
  value: string;
  error: string | undefined;
  onUnlimited: (unlimited: boolean) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        role="switch"
        name={`${name}-unlimited`}
        label={t("admin.tgAds.campaign.noLimit")}
        checked={unlimited}
        onChange={(event) => {
          onUnlimited(event.target.checked);
        }}
      />
      <Field label={label} hint={unlimited ? t("admin.tgAds.limit.offLabel") : hint} error={error}>
        {(control) => (
          <Input
            {...control}
            name={name}
            type="number"
            inputMode="numeric"
            ltr
            min={1}
            disabled={unlimited}
            className={unlimited ? "opacity-50" : undefined}
            value={unlimited ? "" : value}
            placeholder={unlimited ? t("admin.tgAds.limit.offLabel") : undefined}
            onChange={(event) => {
              onValue(event.target.value);
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** Create or edit one Telegram ad campaign (name, advertiser, status, dates, caps with "no limit", notes). */
export function TelegramAdsCampaignDialog({
  campaign,
  open,
  onClose,
  onSaved,
}: {
  /** `null` creates. */
  campaign: TelegramAdCampaign | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={campaign ? t("admin.tgAds.campaign.editTitle") : t("admin.tgAds.campaign.newTitle")}
      className="sm:max-w-xl"
    >
      {open ? (
        <CampaignForm
          key={campaign?.id ?? "new"}
          campaign={campaign}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function CampaignForm({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: TelegramAdCampaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [name, setName] = useState(campaign?.name ?? "");
  const [advertiser, setAdvertiser] = useState(campaign?.advertiser ?? "");
  const [status, setStatus] = useState<string>(campaign?.status ?? "draft");
  const [startsAt, setStartsAt] = useState(isoToLocalInput(campaign?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(campaign?.endsAt ?? null));
  const [dailyUnlimited, setDailyUnlimited] = useState(campaign?.dailyImpressionCap == null);
  const [daily, setDaily] = useState(String(campaign?.dailyImpressionCap ?? DEFAULT_CAP));
  const [totalUnlimited, setTotalUnlimited] = useState(campaign?.totalImpressionCap == null);
  const [total, setTotal] = useState(String(campaign?.totalImpressionCap ?? DEFAULT_CAP));
  const [notes, setNotes] = useState(campaign?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    const parsed = telegramAdCampaignInputSchema.safeParse({
      name,
      advertiser,
      status,
      startsAt: localInputToIso(startsAt),
      endsAt: localInputToIso(endsAt),
      dailyImpressionCap: dailyUnlimited ? null : Number(daily),
      totalImpressionCap: totalUnlimited ? null : Number(total),
      notes,
    });
    const next: Record<string, string> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        next[field] = tOr(`admin.tgAds.invalid.${field}`, t("admin.tgAds.invalid.generic"));
      }
    } else if (
      parsed.data.startsAt !== null &&
      parsed.data.endsAt !== null &&
      parsed.data.endsAt <= parsed.data.startsAt
    ) {
      next["endsAt"] = t("admin.tgAds.invalid.endsAtOrder");
    }
    if (!parsed.success || Object.keys(next).length > 0) {
      setErrors(next);
      setFormError(null);
      return;
    }
    setSubmitting(true);
    setErrors({});
    setFormError(null);
    const request = () =>
      api(campaign ? `${ADS_BASE}/campaigns/${campaign.id}` : `${ADS_BASE}/campaigns`, {
        method: campaign ? "PATCH" : "POST",
        body: parsed.data,
        schema: telegramAdCampaignSchema,
      });
    reauth.run(request).then(
      () => {
        toast({
          tone: "success",
          title: t(campaign ? "admin.tgAds.campaign.saved" : "admin.tgAds.campaign.created"),
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
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("admin.tgAds.campaign.name")} required error={errors["name"]}>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.tgAds.campaign.advertiser")} error={errors["advertiser"]}>
          {(control) => (
            <Input
              {...control}
              name="advertiser"
              maxLength={120}
              value={advertiser}
              onChange={(event) => {
                setAdvertiser(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t("admin.tgAds.campaign.status")} error={errors["status"]}>
          {(control) => (
            <Select
              {...control}
              name="status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
              }}
            >
              {TELEGRAM_CAMPAIGN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.tgAds.campaignStatus.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.tgAds.campaign.startsAt")} error={errors["startsAt"]}>
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
        <Field label={t("admin.tgAds.campaign.endsAt")} error={errors["endsAt"]}>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <CapField
          name="dailyImpressionCap"
          label={t("admin.tgAds.campaign.dailyCap")}
          hint={t("admin.tgAds.campaign.dailyCapHint")}
          unlimited={dailyUnlimited}
          value={daily}
          error={errors["dailyImpressionCap"]}
          onUnlimited={setDailyUnlimited}
          onValue={setDaily}
        />
        <CapField
          name="totalImpressionCap"
          label={t("admin.tgAds.campaign.totalCap")}
          hint={t("admin.tgAds.campaign.totalCapHint")}
          unlimited={totalUnlimited}
          value={total}
          error={errors["totalImpressionCap"]}
          onUnlimited={setTotalUnlimited}
          onValue={setTotal}
        />
      </div>
      <Field label={t("admin.tgAds.campaign.notes")} error={errors["notes"]}>
        {(control) => (
          <Textarea
            {...control}
            name="notes"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
        )}
      </Field>
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
