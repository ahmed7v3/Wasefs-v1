"use client";

import { t } from "@wasfa/shared/i18n";
import { PLAN_AUDIENCES, PLAN_VISIBILITIES } from "@wasfa/shared/plans";
import { Badge, Checkbox, Field, Input, Select } from "@wasfa/ui";

import { formatDateTime } from "../../lib/admin-format";
import { fromLocalInput, planSaleState, type PlanDraft } from "../../lib/plan-draft";

import type { ReactNode } from "react";

export interface PlanOverviewTabProps {
  draft: PlanDraft;
  disabled: boolean;
  onChange: (patch: Partial<PlanDraft>) => void;
}

const SALE_TONE = {
  on_sale: "success",
  scheduled: "info",
  ended: "warning",
  hidden: "neutral",
} as const;

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-text">{title}</h3>
        <p className="text-sm text-text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Names and texts, who the plan is for, and when customers can buy it (visibility and the optional
 * sale window). The status line reads the draft with the API's own rule (`planSaleState`).
 */
export function PlanOverviewTab({ draft, disabled, onChange }: PlanOverviewTabProps) {
  const text = (name: keyof PlanDraft, label: string, ltr = false, hint?: string) => (
    <Field label={label} hint={hint}>
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
  const when = (name: "availableFrom" | "availableUntil", label: string, hint: string) => (
    <Field label={label} hint={hint}>
      {(control) => (
        <Input
          {...control}
          type="datetime-local"
          name={name}
          ltr
          disabled={disabled}
          value={draft[name]}
          onChange={(event) => {
            onChange({ [name]: event.target.value });
          }}
        />
      )}
    </Field>
  );

  const from = fromLocalInput(draft.availableFrom);
  const until = fromLocalInput(draft.availableUntil);
  const windowInvalid = Boolean(from && until && from >= until);
  const state = planSaleState(
    { visibility: draft.visibility, availableFrom: from, availableUntil: until },
    new Date(),
  );

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={t("admin.pricing.plan.section.texts")}
        description={t("admin.pricing.plan.section.texts.description")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {text("nameAr", t("admin.pricing.plan.nameAr"))}
          {text("nameEn", t("admin.pricing.plan.nameEn"), true)}
          {text(
            "taglineAr",
            t("admin.pricing.plan.taglineAr"),
            false,
            t("admin.pricing.plan.taglineHint"),
          )}
          {text("taglineEn", t("admin.pricing.plan.taglineEn"), true)}
          {text(
            "badgeAr",
            t("admin.pricing.plan.badgeAr"),
            false,
            t("admin.pricing.plan.badgeHint"),
          )}
          {text("badgeEn", t("admin.pricing.plan.badgeEn"), true)}
        </div>
      </Section>

      <Section
        title={t("admin.pricing.plan.section.audience")}
        description={t("admin.pricing.plan.section.audience.description")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("admin.pricing.plan.audience")}
            hint={t("admin.pricing.plan.audienceHint")}
          >
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
        <div className="flex flex-col gap-1">
          <Checkbox
            label={t("admin.pricing.plan.pin")}
            name="pinRecommended"
            disabled={disabled}
            checked={draft.pinRecommended}
            onChange={(event) => {
              onChange({ pinRecommended: event.target.checked });
            }}
          />
          <p className="ms-9 text-sm text-text-muted">{t("admin.pricing.plan.pinHint")}</p>
        </div>
      </Section>

      <Section
        title={t("admin.pricing.plan.section.sale")}
        description={t("admin.pricing.plan.section.sale.description")}
      >
        <div className="flex flex-wrap items-center gap-2" role="status">
          <span className="text-sm text-text-muted">{t("admin.pricing.plan.sale.now")}</span>
          <Badge tone={SALE_TONE[state]}>{t(`admin.pricing.plan.sale.${state}`)}</Badge>
          {state === "scheduled" && from ? (
            <span className="text-sm text-text-muted">
              {t("admin.pricing.plan.sale.startsAt", { date: formatDateTime(from) })}
            </span>
          ) : null}
          {state === "on_sale" && until ? (
            <span className="text-sm text-text-muted">
              {t("admin.pricing.plan.sale.endsAt", { date: formatDateTime(until) })}
            </span>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("admin.pricing.plan.visibility")}
            hint={t("admin.pricing.plan.visibilityHint")}
            className="sm:col-span-2"
          >
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
          {when(
            "availableFrom",
            t("admin.pricing.plan.availableFrom"),
            t("admin.pricing.plan.availableFromHint"),
          )}
          {when(
            "availableUntil",
            t("admin.pricing.plan.availableUntil"),
            t("admin.pricing.plan.availableUntilHint"),
          )}
        </div>
        {windowInvalid ? (
          <p role="alert" className="text-sm text-danger">
            {t("admin.pricing.plan.sale.invalidWindow")}
          </p>
        ) : null}
        <p className="text-sm text-text-muted">{t("admin.pricing.plan.sale.note")}</p>
      </Section>
    </div>
  );
}
