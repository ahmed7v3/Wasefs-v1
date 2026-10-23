import type { Locale } from "@wasfa/shared/i18n";
import { t } from "@wasfa/shared/i18n/public";

import { cn } from "../cn";

import { moneyText } from "./format";

export interface PriceTagProps {
  amountMinor: number;
  currency: string;
  /** The price before a promotion, struck through. Only when it is really higher. */
  struckMinor?: number | null | undefined;
  /** Text after the amount: "/ شهريًا", "لكل شهر". */
  suffix?: string | undefined;
  size?: "md" | "lg" | "xl" | undefined;
  /** Language of the screen-reader text and of the number format; Arabic unless the page is English. */
  locale?: Locale | undefined;
  className?: string | undefined;
}

const SIZES = {
  md: "text-lg",
  lg: "text-2xl sm:text-3xl",
  xl: "text-3xl sm:text-4xl",
} as const;

/** An amount in the large type of a price, with the old price struck through when there is one. */
export function PriceTag({
  amountMinor,
  currency,
  struckMinor,
  suffix,
  size = "lg",
  locale = "ar",
  className,
}: PriceTagProps) {
  const struck = struckMinor !== null && struckMinor !== undefined && struckMinor > amountMinor;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      {struck ? (
        <s className="text-base tabular-nums text-text-muted">
          <span className="sr-only">{t("billing.price.was", undefined, locale)} </span>
          <bdi>{moneyText(struckMinor, currency, locale)}</bdi>
        </s>
      ) : null}
      <span className={cn("font-heading font-bold tabular-nums text-text", SIZES[size])}>
        {struck ? (
          <span className="sr-only">{t("billing.price.now", undefined, locale)} </span>
        ) : null}
        <bdi>{moneyText(amountMinor, currency, locale)}</bdi>
      </span>
      {suffix ? <span className="text-base text-text-muted">{suffix}</span> : null}
    </span>
  );
}
