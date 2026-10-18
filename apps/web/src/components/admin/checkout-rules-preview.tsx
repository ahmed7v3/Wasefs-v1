"use client";

import { t } from "@wasfa/shared/i18n";
import { toMinor } from "@wasfa/shared/money";
import { CheckoutSummary, Field, Input, Select } from "@wasfa/ui";
import { useState } from "react";

import { type MethodView, type TaxRuleView } from "../../lib/admin-billing-schemas";
import { previewCheckout } from "../../lib/admin-revenue";

/**
 * The checkout summary rendered with the current tax rule and the chosen method's fee, so the admin
 * sees the "quiet fees" layout - one combined tax-and-fees line - before customers do.
 */
export function CheckoutRulesPreview({
  methods,
  rules,
}: {
  methods: readonly MethodView[];
  rules: readonly TaxRuleView[];
}) {
  const enabled = methods.filter((method) => method.enabled);
  const [methodKey, setMethodKey] = useState("");
  const [amount, setAmount] = useState("99.00");
  const method = enabled.find((entry) => entry.key === methodKey) ?? enabled[0] ?? null;
  const currency = method?.currencies[0] ?? "EGP";
  const rule =
    rules.find((entry) => entry.active && entry.country === null) ??
    rules.find((entry) => entry.active) ??
    null;
  const amountMinor = (() => {
    try {
      return toMinor(amount.trim(), currency);
    } catch {
      return null;
    }
  })();
  const result =
    amountMinor === null
      ? null
      : previewCheckout({
          amountMinor,
          tax: rule ? { rateBps: rule.rateBps, mode: rule.mode } : null,
          method: method ? { feeBps: method.feeBps, feeFixedMinor: method.feeFixedMinor } : null,
        });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("admin.pricing.checkoutPreview.method")}>
          {(control) => (
            <Select
              {...control}
              name="preview-method"
              value={method?.key ?? ""}
              onChange={(event) => {
                setMethodKey(event.target.value);
              }}
            >
              {enabled.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.nameAr}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t("admin.pricing.checkoutPreview.amount", { currency })}
          error={amountMinor === null ? t("admin.pricing.matrix.invalid") : undefined}
        >
          {(control) => (
            <Input
              {...control}
              name="preview-amount"
              ltr
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      {result && amountMinor !== null ? (
        <CheckoutSummary
          currency={currency}
          lines={[
            { key: "plan", label: t("admin.pricing.checkoutPreview.sampleLine"), amountMinor },
          ]}
          fee={{
            show: result.taxMinor + result.feeMinor > 0,
            amountMinor: result.taxMinor + result.feeMinor,
            items: [
              ...(result.taxMinor > 0
                ? [{ key: "tax", label: t("billing.fee.tax"), amountMinor: result.taxMinor }]
                : []),
              ...(result.feeMinor > 0
                ? [{ key: "fee", label: t("billing.fee.method"), amountMinor: result.feeMinor }]
                : []),
            ],
          }}
          totalMinor={result.totalMinor}
        />
      ) : null}
      <p className="text-sm text-text-muted">{t("admin.pricing.checkoutPreview.note")}</p>
    </div>
  );
}
