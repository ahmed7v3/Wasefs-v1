"use client";

import { t } from "@wasfa/shared/i18n";
import { Select } from "@wasfa/ui";
import { useRouter } from "next/navigation";

import { rememberCurrency } from "../../lib/billing-cookie";

export interface CurrencySwitchProps {
  current: string;
  /** Currencies the admin enabled; the control is hidden when there is nothing to choose. */
  options: readonly string[];
}

/** The remembered currency choice: a cookie the server reads back, plus `?currency=` for sharing. */
export function CurrencySwitch({ current, options }: CurrencySwitchProps) {
  const router = useRouter();
  if (options.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm font-medium text-text-muted">
      {t("billing.pricing.currency")}
      <Select
        name="currency"
        className="min-h-10 w-28"
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          rememberCurrency(next);
          router.push(`/pricing?currency=${encodeURIComponent(next)}`);
        }}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </Select>
    </label>
  );
}
