"use client";

import { t } from "@wasfa/shared/i18n";
import { PLAN_FEATURES_MAX, type PlanFeature } from "@wasfa/shared/schemas/billing";
import { Button, Checkbox, Input } from "@wasfa/ui";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

export interface PlanFeaturesTabProps {
  features: readonly PlanFeature[];
  disabled: boolean;
  onChange: (features: PlanFeature[]) => void;
}

/** The bullet list customers see: reorder with the arrow buttons, mark included/excluded/highlight. */
export function PlanFeaturesTab({ features, disabled, onChange }: PlanFeaturesTabProps) {
  const update = (index: number, patch: Partial<PlanFeature>) => {
    onChange(
      features.map((feature, i) => (i === index ? { ...feature, ...patch } : { ...feature })),
    );
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= features.length) return;
    const next = features.map((feature) => ({ ...feature }));
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-4">
      {features.length === 0 ? (
        <p className="text-base text-text-muted">{t("admin.pricing.features.empty")}</p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {features.map((feature, index) => (
          <li
            key={index}
            className="flex flex-col gap-3 rounded-lg border border-border p-3"
            data-testid="feature-row"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t("admin.pricing.features.textAr")}
                <Input
                  name={`feature-ar-${String(index)}`}
                  disabled={disabled}
                  value={feature.textAr}
                  onChange={(event) => {
                    update(index, { textAr: event.target.value });
                  }}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t("admin.pricing.features.textEn")}
                <Input
                  name={`feature-en-${String(index)}`}
                  ltr
                  disabled={disabled}
                  value={feature.textEn}
                  onChange={(event) => {
                    update(index, { textEn: event.target.value });
                  }}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Checkbox
                label={t("admin.pricing.features.included")}
                disabled={disabled}
                checked={feature.included}
                onChange={(event) => {
                  update(index, { included: event.target.checked });
                }}
              />
              <Checkbox
                label={t("admin.pricing.features.highlight")}
                disabled={disabled}
                checked={feature.highlight}
                onChange={(event) => {
                  update(index, { highlight: event.target.checked });
                }}
              />
              {!disabled ? (
                <span className="ms-auto flex gap-1">
                  <Button
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    <ArrowUp aria-hidden className="size-5" />
                    <span className="sr-only">{t("admin.pricing.features.up")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={index === features.length - 1}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    <ArrowDown aria-hidden className="size-5" />
                    <span className="sr-only">{t("admin.pricing.features.down")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      onChange(features.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 aria-hidden className="size-5" />
                    <span className="sr-only">{t("admin.pricing.features.remove")}</span>
                  </Button>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {!disabled ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={features.length >= PLAN_FEATURES_MAX}
          onClick={() => {
            onChange([
              ...features.map((feature) => ({ ...feature })),
              { textAr: "", textEn: "", included: true, highlight: false },
            ]);
          }}
        >
          <Plus aria-hidden className="size-5" />
          {t("admin.pricing.features.add")}
        </Button>
      ) : null}
    </div>
  );
}
