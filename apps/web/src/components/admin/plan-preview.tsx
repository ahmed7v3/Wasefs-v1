"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, CardTitle, ComparisonTable, Select } from "@wasfa/ui";
import { Monitor, Smartphone } from "lucide-react";
import { useState } from "react";

import { type AdminPlan } from "../../lib/admin-billing-schemas";
import { storedPlanToCatalog, toCatalogPlan, type PlanDraft } from "../../lib/plan-draft";
import { type MatrixDraft } from "../../lib/price-matrix";
import { comparisonModel } from "../../lib/pricing-compare";
import { offeredDurations } from "../../lib/pricing-durations";

import { PricePreviewCard } from "./price-preview-card";

import type { CatalogFreePlan } from "@wasfa/shared/schemas/billing";

export interface PlanPreviewProps {
  plans: readonly AdminPlan[];
  selected: AdminPlan;
  draft: PlanDraft;
  matrix: MatrixDraft;
  currencies: readonly string[];
}

/**
 * What customers see, drawn with the pricing page's own components: the plan card (mobile) or all
 * plan cards and the comparison table (desktop), in a chosen currency and for any priced period.
 * The selected plan shows the unsaved draft; the others show what is stored.
 */
export function PlanPreview({ plans, selected, draft, matrix, currencies }: PlanPreviewProps) {
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [currency, setCurrency] = useState(currencies[0] ?? "EGP");
  const [chosenMonths, setMonths] = useState(1);
  const activeCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? "EGP");

  const asCatalog = (plan: AdminPlan) =>
    plan.id === selected.id
      ? toCatalogPlan(plan, draft, matrix, activeCurrency)
      : storedPlanToCatalog(plan, activeCurrency);
  // Cheap to rebuild on every render: a handful of plans.
  const catalog = plans
    .filter((plan) => !plan.isDefault)
    .filter((plan) => plan.visibility === "public" || plan.id === selected.id)
    .map(asCatalog);
  // The free card: the default plan (its draft when it is the one being edited), as the page shows it.
  const freeStored = plans.find((plan) => plan.isDefault);
  const freeShown =
    freeStored && (freeStored.visibility === "public" || freeStored.id === selected.id)
      ? asCatalog(freeStored)
      : null;
  const freePlan: CatalogFreePlan | null = freeShown
    ? {
        key: freeShown.key,
        names: freeShown.names,
        tagline: freeShown.tagline,
        features: freeShown.features,
        badge: freeShown.badge,
        monthlyCredits: freeShown.monthlyCredits,
      }
    : null;
  const comparison = comparisonModel(catalog, freePlan);
  const durations = offeredDurations(catalog);
  const months = durations.includes(chosenMonths) ? chosenMonths : (durations[0] ?? 1);

  const freeCard = (plan: CatalogFreePlan) => (
    <PricePreviewCard
      key={plan.key}
      name={plan.names.ar}
      tagline={plan.tagline?.ar ?? null}
      badge={plan.badge?.ar ?? null}
      highlighted={false}
      features={plan.features.map((feature) => ({
        text: feature.textAr,
        included: feature.included,
        highlight: feature.highlight,
      }))}
      amountMinor={null}
      free
      months={months}
      currency={activeCurrency}
    />
  );

  const card = (plan: (typeof catalog)[number]) => {
    const price = plan.prices.find((entry) => entry.months === months);
    return (
      <PricePreviewCard
        key={plan.key}
        name={plan.names.ar}
        tagline={plan.tagline?.ar ?? null}
        badge={plan.badge?.ar ?? null}
        highlighted={plan.pinRecommended}
        features={plan.features.map((feature) => ({
          text: feature.textAr,
          included: feature.included,
          highlight: feature.highlight,
        }))}
        amountMinor={price?.amountMinor ?? null}
        months={months}
        currency={activeCurrency}
      />
    );
  };

  return (
    <Card
      elevation="flat"
      className="flex flex-col gap-4"
      aria-label={t("admin.pricing.preview.title")}
    >
      <CardTitle>{t("admin.pricing.preview.title")}</CardTitle>
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t("admin.pricing.preview.device")} className="flex gap-2">
          <Button
            variant={device === "mobile" ? "primary" : "secondary"}
            aria-pressed={device === "mobile"}
            onClick={() => {
              setDevice("mobile");
            }}
          >
            <Smartphone aria-hidden className="size-5" />
            {t("admin.pricing.preview.mobile")}
          </Button>
          <Button
            variant={device === "desktop" ? "primary" : "secondary"}
            aria-pressed={device === "desktop"}
            onClick={() => {
              setDevice("desktop");
            }}
          >
            <Monitor aria-hidden className="size-5" />
            {t("admin.pricing.preview.desktop")}
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          {t("admin.pricing.preview.currency")}
          <Select
            name="preview-currency"
            value={activeCurrency}
            onChange={(event) => {
              setCurrency(event.target.value);
            }}
          >
            {currencies.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <div role="group" aria-label={t("admin.pricing.preview.period")} className="flex gap-2">
          {(durations.length > 0 ? durations : [1]).map((value) => (
            <Button
              key={value}
              variant={months === value ? "primary" : "secondary"}
              aria-pressed={months === value}
              onClick={() => {
                setMonths(value);
              }}
            >
              {t("admin.pricing.matrix.months", { count: value })}
            </Button>
          ))}
        </div>
      </div>
      {device === "mobile" ? (
        <div className="mx-auto w-full max-w-xs">
          {selected.isDefault && freePlan
            ? freeCard(freePlan)
            : catalog.filter((plan) => plan.key === selected.key).map(card)}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 pt-4 md:grid-cols-2">
            {freePlan ? freeCard(freePlan) : null}
            {catalog.map(card)}
          </div>
          <ComparisonTable
            caption={t("admin.pricing.preview.compare")}
            columns={comparison.columns}
            rows={comparison.rows}
          />
        </div>
      )}
      <p className="text-sm text-text-muted">{t("admin.pricing.preview.note")}</p>
    </Card>
  );
}
