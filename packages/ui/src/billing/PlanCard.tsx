import { t } from "@wasfa/shared/i18n";
import { Check, Minus } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "../cn";

export interface PlanCardFeature {
  text: string;
  included: boolean;
  highlight: boolean;
}

export interface PlanCardProps {
  name: string;
  tagline?: string | null | undefined;
  /** Badges above the name: a promotion, "الأنسب لك", "باقتك الحالية". */
  badges?: ReactNode;
  /** The ring that marks the one plan the page recommends. */
  highlighted?: boolean | undefined;
  /** Usually a `PriceTag`. */
  price: ReactNode;
  /** One grey line under the price ("وفّر 198.00 ج.م.", "تعادل 82.50 ج.م. شهريًا"). */
  priceNote?: ReactNode;
  features: readonly PlanCardFeature[];
  /** The link or button that picks the plan. */
  cta: ReactNode;
  /** A line under the button (the free trial, the fair-use note). */
  footnote?: ReactNode;
  headingAs?: "h2" | "h3" | undefined;
  className?: string | undefined;
}

/** One plan on the pricing page: name, price, feature list and the choose button. */
export function PlanCard({
  name,
  tagline,
  badges,
  highlighted = false,
  price,
  priceNote,
  features,
  cta,
  footnote,
  headingAs: Heading = "h3",
  className,
}: PlanCardProps) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-surface p-5 text-text shadow-card sm:p-6",
        highlighted ? "border-primary ring-2 ring-primary" : "border-border/60",
        className,
      )}
    >
      <header className="flex flex-col gap-2">
        {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        <Heading id={headingId} className="font-heading text-xl font-bold text-text">
          {name}
        </Heading>
        {tagline ? <p className="text-base text-text-muted">{tagline}</p> : null}
      </header>
      <div className="flex flex-col gap-1">
        {price}
        {priceNote ? <p className="text-sm text-text-muted">{priceNote}</p> : null}
      </div>
      <div>{cta}</div>
      {features.length > 0 ? (
        <ul className="flex flex-1 flex-col gap-2 border-t border-border/60 pt-4">
          {features.map((feature) => (
            <li key={feature.text} className="flex items-start gap-2 text-base">
              {feature.included ? (
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-success" />
              ) : (
                <Minus aria-hidden className="mt-1 size-4 shrink-0 text-neutral-500" />
              )}
              <span
                className={cn(
                  feature.highlight && "font-semibold",
                  !feature.included && "text-text-muted",
                )}
              >
                {feature.text}
                {feature.included ? null : (
                  <span className="sr-only"> ({t("billing.feature.notIncluded")})</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {footnote ? <p className="text-sm text-text-muted">{footnote}</p> : null}
    </article>
  );
}
