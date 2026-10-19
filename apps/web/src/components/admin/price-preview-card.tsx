import { t } from "@wasfa/shared/i18n";
import { PlanCard, PriceTag, PromoBadge, buttonStyles, moneyText } from "@wasfa/ui";

import type { PlanCardFeature } from "@wasfa/ui";

export interface PricePreviewCardProps {
  name: string;
  tagline: string | null;
  badge: string | null;
  highlighted: boolean;
  features: readonly PlanCardFeature[];
  /** The price of the previewed period; `null` renders "not offered". */
  amountMinor: number | null;
  /** The free (default) plan: shows "مجانًا" instead of a price. */
  free?: boolean | undefined;
  months: number;
  currency: string;
}

/**
 * How the plan card looks to customers, drawn with the very component of the pricing page. The
 * price is the draft's number as typed (a display aid); the real price is whatever Publish stores.
 */
export function PricePreviewCard({
  name,
  tagline,
  badge,
  highlighted,
  features,
  amountMinor,
  free = false,
  months,
  currency,
}: PricePreviewCardProps) {
  return (
    <PlanCard
      name={name || t("admin.pricing.preview.unnamed")}
      tagline={tagline}
      highlighted={highlighted}
      badges={badge ? <PromoBadge tone="info">{badge}</PromoBadge> : undefined}
      price={
        free ? (
          <span className="font-heading text-4xl font-bold text-text">
            {t("billing.plan.free.price")}
          </span>
        ) : amountMinor === null ? (
          <p className="text-base font-semibold text-text-muted">
            {t("admin.pricing.preview.notOffered", { currency })}
          </p>
        ) : (
          <PriceTag
            amountMinor={months === 1 ? amountMinor : Math.floor(amountMinor / months)}
            currency={currency}
            size="xl"
            suffix={t("admin.pricing.preview.perMonth")}
          />
        )
      }
      priceNote={
        !free && amountMinor !== null && months > 1
          ? t("admin.pricing.preview.billedTotal", {
              amount: moneyText(amountMinor, currency),
              months,
            })
          : undefined
      }
      features={features}
      cta={
        <span className={buttonStyles({ className: "w-full" })}>
          {t("admin.pricing.preview.cta")}
        </span>
      }
    />
  );
}
