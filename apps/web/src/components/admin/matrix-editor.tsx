"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Input, cn } from "@wasfa/ui";
import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";

import { cellKey, type MatrixDraft } from "../../lib/price-matrix";

export interface MatrixEditorProps {
  months: readonly number[];
  currencies: readonly string[];
  value: MatrixDraft;
  /** Cell key to a reason; cells listed here are marked invalid. */
  errors: Readonly<Record<string, string>>;
  disabled?: boolean;
  onChange: (key: string, text: string) => void;
  onFillYear: (currency: string) => void;
  onAddCurrency: (currency: string) => void;
}

const head =
  "border-b border-border bg-neutral-50 px-3 py-2 text-start text-sm font-semibold text-text-muted";

/**
 * Prices as a grid: one row per period, one column per currency, an empty cell means "not offered".
 * Cells are plain amount inputs in major units; the page turns them into minor units and the API
 * validates on Publish. The table scrolls inside its card so a phone never scrolls sideways.
 */
export function MatrixEditor({
  months,
  currencies,
  value,
  errors,
  disabled = false,
  onChange,
  onFillYear,
  onAddCurrency,
}: MatrixEditorProps) {
  const [extra, setExtra] = useState("");
  const extraValid = /^[A-Z]{3}$/.test(extra) && !currencies.includes(extra);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-96 border-collapse">
          <caption className="sr-only">{t("admin.pricing.matrix.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className={head}>
                {t("admin.pricing.matrix.period")}
              </th>
              {currencies.map((currency) => (
                <th key={currency} scope="col" className={head}>
                  <span className="flex flex-wrap items-center gap-2">
                    <bdi dir="ltr">{currency}</bdi>
                    {!disabled ? (
                      <button
                        type="button"
                        onClick={() => {
                          onFillYear(currency);
                        }}
                        className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm font-semibold text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        <Sparkles aria-hidden className="size-4" />
                        {t("admin.pricing.matrix.fillYear")}
                        <span className="sr-only"> {currency}</span>
                      </button>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((count) => (
              <tr key={count}>
                <th
                  scope="row"
                  className="border-b border-border px-3 py-2 text-start text-base font-semibold"
                >
                  {t("admin.pricing.matrix.months", { count })}
                </th>
                {currencies.map((currency) => {
                  const key = cellKey(count, currency);
                  const invalid = Object.hasOwn(errors, key);
                  return (
                    <td key={key} className="border-b border-border p-1.5">
                      <Input
                        name={`price-${key}`}
                        ltr
                        inputMode="decimal"
                        autoComplete="off"
                        disabled={disabled}
                        invalid={invalid}
                        aria-label={t("admin.pricing.matrix.cell", { months: count, currency })}
                        placeholder={t("admin.pricing.matrix.notOffered")}
                        className={cn("tabular-nums")}
                        value={value[key] ?? ""}
                        onChange={(event) => {
                          onChange(key, event.target.value);
                        }}
                      />
                      {invalid ? (
                        <p role="alert" className="mt-1 text-sm text-danger">
                          {t("admin.pricing.matrix.invalid")}
                        </p>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-semibold text-text">
            {t("admin.pricing.matrix.addCurrency")}
            <Input
              name="new-currency"
              ltr
              maxLength={3}
              autoComplete="off"
              placeholder="SAR"
              className="w-28"
              value={extra}
              onChange={(event) => {
                setExtra(event.target.value.toUpperCase());
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={!extraValid}
            onClick={() => {
              onAddCurrency(extra);
              setExtra("");
            }}
          >
            <Plus aria-hidden className="size-5" />
            {t("admin.pricing.matrix.add")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
