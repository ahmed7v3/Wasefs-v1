"use client";

import { t } from "@wasfa/shared/i18n";
import { PLAN_AUDIENCES, PLAN_VISIBILITIES } from "@wasfa/shared/plans";
import { Checkbox, Field, Input, Select } from "@wasfa/ui";

import type { PlanDraft } from "../../lib/plan-draft";

export interface PlanOverviewTabProps {
  draft: PlanDraft;
  disabled: boolean;
  onChange: (patch: Partial<PlanDraft>) => void;
}

/** Names, tagline, badge, audience, visibility, trial days and the recommended pin. */
export function PlanOverviewTab({ draft, disabled, onChange }: PlanOverviewTabProps) {
  const text = (name: keyof PlanDraft, label: string, ltr = false) => (
    <Field label={label}>
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={ltr}
          disabled={disabled}
          value={String(draft[name])}
          onChange={(event) => {
            onChange({ [name]: event.target.value });
          }}
        />
      )}
    </Field>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {text("nameAr", t("admin.pricing.plan.nameAr"))}
        {text("nameEn", t("admin.pricing.plan.nameEn"), true)}
        {text("taglineAr", t("admin.pricing.plan.taglineAr"))}
        {text("taglineEn", t("admin.pricing.plan.taglineEn"), true)}
        {text("badgeAr", t("admin.pricing.plan.badgeAr"))}
        {text("badgeEn", t("admin.pricing.plan.badgeEn"), true)}
        <Field label={t("admin.pricing.plan.audience")}>
          {(control) => (
            <Select
              {...control}
              name="audience"
              disabled={disabled}
              value={draft.audience}
              onChange={(event) => {
                const value = PLAN_AUDIENCES.find((audience) => audience === event.target.value);
                if (value) onChange({ audience: value });
              }}
            >
              {PLAN_AUDIENCES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.pricing.plan.audience.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.pricing.plan.visibility")}>
          {(control) => (
            <Select
              {...control}
              name="visibility"
              disabled={disabled}
              value={draft.visibility}
              onChange={(event) => {
                const value = PLAN_VISIBILITIES.find((entry) => entry === event.target.value);
                if (value) onChange({ visibility: value });
              }}
            >
              {PLAN_VISIBILITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.pricing.plan.visibility.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.pricing.plan.trialDays")} hint={t("admin.pricing.plan.trialHint")}>
          {(control) => (
            <Input
              {...control}
              name="trialDays"
              ltr
              inputMode="numeric"
              disabled={disabled}
              value={draft.trialDays}
              onChange={(event) => {
                onChange({ trialDays: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <Checkbox
        label={t("admin.pricing.plan.pin")}
        name="pinRecommended"
        disabled={disabled}
        checked={draft.pinRecommended}
        onChange={(event) => {
          onChange({ pinRecommended: event.target.checked });
        }}
      />
    </div>
  );
}
