"use client";

import type { Locale } from "@wasfa/shared/i18n";
import { t } from "@wasfa/shared/i18n/public";
import { Select } from "@wasfa/ui";
import { useRouter } from "next/navigation";

import { rememberCurrency } from "../../lib/billing-cookie";
import { localizedPath } from "../../lib/locale";

export interface CurrencySwitchProps {
  current: string;
  /** Currencies the admin enabled; the control is hidden when there is nothing to choose. */
  options: readonly string[];
  locale?: Locale | undefined;
}

/** The remembered currency choice: a cookie the server reads back, plus `?currency=` for sharing. */
export function CurrencySwitch({ current, options, locale = "ar" }: CurrencySwitchProps) {
  const router = useRouter();
  if (options.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-2 text-sm font-medium text-text-muted">
      {t("billing.pricing.currency", undefined, locale)}
      <Select
        name="currency"
        className="min-h-10 w-28"
        value={current}
        onChange={(event) => {
          const next = event.target.value;
          rememberCurrency(next);
          router.push(`${localizedPath("/pricing", locale)}?currency=${encodeURIComponent(next)}`);
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
