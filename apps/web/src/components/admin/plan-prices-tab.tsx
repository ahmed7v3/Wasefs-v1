"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Checkbox, moneyText, useToast } from "@wasfa/ui";
import { Rocket, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  pricePreviewSchema,
  type AdminPlan,
  type PricePreview,
} from "../../lib/admin-billing-schemas";
import { percentText } from "../../lib/admin-revenue";
import { api } from "../../lib/api-client";
import { toApiError } from "../../lib/forms";
import {
  fillYearFromMonthly,
  matrixCurrencies,
  matrixMonths,
  pricesFromMatrix,
  type MatrixDraft,
  type PriceCell,
} from "../../lib/price-matrix";
import { ErrorNotice } from "../error-notice";

import { MatrixEditor } from "./matrix-editor";
import { ReasonDialog } from "./reason-dialog";

import type { ApiRequestError } from "../../lib/api-error";

export interface PlanPricesTabProps {
  plan: AdminPlan;
  matrix: MatrixDraft;
  extraCurrencies: readonly string[];
  /** Periods the admin added in this session (rows with no price yet). */
  extraMonths: readonly number[];
  disabled: boolean;
  dirty: boolean;
  onMatrix: (matrix: MatrixDraft) => void;
  onAddCurrency: (currency: string) => void;
  onAddMonths: (months: number) => void;
  onPublished: () => void;
}

/** Cells of a preview that are new or changed: the ones whose margin the API refuses when negative. */
function touchedKeys(preview: PricePreview): Set<string> {
  return new Set([
    ...preview.diff.added.map((row) => `${String(row.months)}:${row.currency}`),
    ...preview.diff.changed.map((row) => `${String(row.months)}:${row.currency}`),
  ]);
}

const amountText = (amount: number | null, currency: string) =>
  amount === null ? t("admin.pricing.publish.notOffered") : moneyText(amount, currency);

function PublishDialog({
  plan,
  prices,
  preview,
  open,
  onOpenChange,
  onPublished,
}: {
  plan: AdminPlan;
  prices: PriceCell[];
  preview: PricePreview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: () => void;
}) {
  const { toast } = useToast();
  const [override, setOverride] = useState(false);
  const touched = touchedKeys(preview);
  const negative = preview.margin.filter(
    (row) =>
      touched.has(`${String(row.months)}:${row.currency}`) &&
      row.margin !== null &&
      row.margin.marginFullMinor < 0,
  );
  const low = preview.margin.filter(
    (row) =>
      touched.has(`${String(row.months)}:${row.currency}`) &&
      row.margin !== null &&
      row.margin.marginFullMinor >= 0 &&
      row.margin.warn,
  );
  const { diff } = preview;
  const nothing = diff.added.length + diff.changed.length + diff.removed.length === 0;

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.pricing.publish.title", { name: plan.nameAr })}
      effect={t("admin.pricing.publish.subscribers", { count: preview.activeSubscribers })}
      confirmLabel={t("admin.pricing.publish.confirm")}
      canSubmit={!nothing && (negative.length === 0 || override)}
      onConfirm={async (reason) => {
        await api(`/admin/billing/plans/${plan.id}/prices`, {
          method: "PUT",
          body: { prices, reason, overrideMargin: negative.length > 0 && override },
        });
        toast({ tone: "success", title: t("admin.pricing.publish.done", { name: plan.nameAr }) });
        onPublished();
      }}
    >
      <section
        aria-label={t("admin.pricing.publish.diff")}
        className="flex flex-col gap-2"
        data-testid="publish-diff"
      >
        <h3 className="font-heading text-lg font-semibold">{t("admin.pricing.publish.diff")}</h3>
        {nothing ? (
          <p className="text-base text-text-muted">{t("admin.pricing.publish.nothing")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-base">
            {diff.added.map((row) => (
              <li key={`a-${String(row.months)}-${row.currency}`}>
                {t("admin.pricing.publish.added", {
                  months: row.months,
                  currency: row.currency,
                  to: amountText(row.amountMinor, row.currency),
                })}
              </li>
            ))}
            {diff.changed.map((row) => (
              <li key={`c-${String(row.months)}-${row.currency}`}>
                {t("admin.pricing.publish.changed", {
                  months: row.months,
                  currency: row.currency,
                  from: amountText(row.from, row.currency),
                  to: amountText(row.to, row.currency),
                })}
              </li>
            ))}
            {diff.removed.map((row) => (
              <li key={`r-${String(row.months)}-${row.currency}`}>
                {t("admin.pricing.publish.removed", {
                  months: row.months,
                  currency: row.currency,
                  from: amountText(row.amountMinor, row.currency),
                })}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-text-muted">{t("admin.pricing.publish.keepNote")}</p>
      </section>
      {low.length > 0 ? (
        <p className="flex items-center gap-2 text-base text-warning">
          <TriangleAlert aria-hidden className="size-5 shrink-0" />
          {t("admin.pricing.publish.lowMargin", {
            list: low
              .map(
                (row) =>
                  `${String(row.months)}/${row.currency} ${percentText(row.margin?.marginBps ?? 0)}`,
              )
              .join("، "),
          })}
        </p>
      ) : null}
      {negative.length > 0 ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-danger-soft px-4 py-3 text-danger"
        >
          <p className="flex items-center gap-2 text-base font-semibold">
            <TriangleAlert aria-hidden className="size-5 shrink-0" />
            {t("admin.pricing.publish.negative", {
              list: negative
                .map(
                  (row) =>
                    `${String(row.months)}/${row.currency} ${percentText(row.margin?.marginBps ?? 0)}`,
                )
                .join("، "),
            })}
          </p>
          <Checkbox
            label={t("admin.pricing.publish.override")}
            name="overrideMargin"
            checked={override}
            onChange={(event) => {
              setOverride(event.target.checked);
            }}
          />
        </div>
      ) : null}
    </ReasonDialog>
  );
}

/**
 * The price matrix of a plan. Edits are a client draft; "Publish" asks the API for the diff and the
 * margin of exactly these prices, shows them with the number of subscribers who keep their price
 * until renewal, and only then writes (reason + fresh auth, an explicit override for a negative margin).
 */
export function PlanPricesTab({
  plan,
  matrix,
  extraCurrencies,
  extraMonths,
  disabled,
  dirty,
  onMatrix,
  onAddCurrency,
  onAddMonths,
  onPublished,
}: PlanPricesTabProps) {
  const stored: PriceCell[] = plan.prices;
  const months = matrixMonths(stored, extraMonths);
  const currencies = matrixCurrencies(stored, extraCurrencies);
  const { prices, errors } = pricesFromMatrix(matrix, stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [preview, setPreview] = useState<{ prices: PriceCell[]; data: PricePreview } | null>(null);
  const [open, setOpen] = useState(false);
  const invalid = Object.keys(errors).length > 0;

  const start = () => {
    if (busy || invalid) return;
    setBusy(true);
    setError(null);
    api(`/admin/billing/plans/${plan.id}/prices/preview`, {
      method: "POST",
      body: { prices },
      schema: pricePreviewSchema,
    }).then(
      (data) => {
        setBusy(false);
        setPreview({ prices, data });
        setOpen(true);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(toApiError(failure));
      },
    );
  };

  if (plan.isDefault && plan.prices.every((price) => price.amountMinor === null)) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-primary-soft p-4">
        <p className="text-base font-semibold text-text">{t("admin.pricing.free.title")}</p>
        <p className="text-base text-text">{t("admin.pricing.free.body")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-text-muted">{t("admin.pricing.prices.lead")}</p>
      <MatrixEditor
        months={months}
        currencies={currencies}
        value={matrix}
        errors={errors}
        disabled={disabled}
        onChange={(key, text) => {
          onMatrix({ ...matrix, [key]: text });
        }}
        onFillYear={(currency) => {
          onMatrix(fillYearFromMonthly(matrix, currency));
        }}
        onAddCurrency={onAddCurrency}
        onAddMonths={onAddMonths}
      />
      {error ? <ErrorNotice error={error} /> : null}
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button name="publish" loading={busy} disabled={invalid} onClick={start}>
            <Rocket aria-hidden className="size-5" />
            {t("admin.pricing.prices.publish")}
          </Button>
          {dirty ? (
            <Badge tone="warning">{t("admin.pricing.prices.unpublished")}</Badge>
          ) : (
            <span className="text-sm text-text-muted">{t("admin.pricing.prices.inSync")}</span>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t("admin.pricing.prices.readOnly")}</p>
      )}
      {preview ? (
        <PublishDialog
          plan={plan}
          prices={preview.prices}
          preview={preview.data}
          open={open}
          onOpenChange={setOpen}
          onPublished={onPublished}
        />
      ) : null}
    </div>
  );
}
