import type { Locale } from "@wasfa/shared/i18n";
import { t } from "@wasfa/shared/i18n/public";
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
  /** Small badges beside the name: a promotion, "باقتك الحالية". */
  badges?: ReactNode;
  /** The ring that marks the one plan the page recommends. */
  highlighted?: boolean | undefined;
  /** A label on the top edge of a highlighted card ("الأكثر اختيارًا", "الأنسب لك"). */
  ribbon?: string | null | undefined;
  /** Usually a `PriceTag`. */
  price: ReactNode;
  /** One line under the price ("تُدفع 100.00 ج.م. كل سنة"). */
  priceNote?: ReactNode;
  features: readonly PlanCardFeature[];
  /** A short heading over the feature list ("تشمل الباقة"). */
  featuresTitle?: string | undefined;
  /** The link or button that picks the plan. */
  cta: ReactNode;
  /** A line under the button (the free trial). */
  footnote?: ReactNode;
  /** A muted line at the very end (the fair-use note). */
  finePrint?: ReactNode;
  /** Language of the screen-reader text. */
  locale?: Locale | undefined;
  headingAs?: "h2" | "h3" | undefined;
  className?: string | undefined;
}

/**
 * One plan on the pricing page, read top to bottom in the order a buyer decides: who it is for,
 * what it costs, the button, then what it includes. The recommended card gets a ring and a ribbon,
 * nothing else competes with the price.
 */
export function PlanCard({
  name,
  tagline,
  badges,
  highlighted = false,
  ribbon,
  price,
  priceNote,
  features,
  featuresTitle,
  cta,
  footnote,
  finePrint,
  locale = "ar",
  headingAs: Heading = "h3",
  className,
}: PlanCardProps) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className={cn(
        "relative flex h-full flex-col gap-5 rounded-2xl border bg-surface p-6 text-text sm:p-7",
        highlighted
          ? "border-primary shadow-raised ring-1 ring-primary"
          : "border-border/70 shadow-card",
        ribbon ? "pt-8 sm:pt-9" : null,
        className,
      )}
    >
      {ribbon ? (
        <p className="absolute inset-x-0 -top-3.5 flex justify-center">
          <span className="rounded-full bg-primary px-4 py-1 text-sm font-semibold text-on-primary shadow-card">
            {ribbon}
          </span>
        </p>
      ) : null}
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading id={headingId} className="font-heading text-xl font-bold text-text">
            {name}
          </Heading>
          {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
        </div>
        {tagline ? <p className="min-h-12 text-base text-text-muted">{tagline}</p> : null}
      </header>
      <div className="flex min-h-20 flex-col justify-end gap-1">
        {price}
        {priceNote ? <div className="text-sm text-text-muted">{priceNote}</div> : null}
      </div>
      <div className="flex flex-col gap-2">
        {cta}
        {footnote ? <p className="text-center text-sm text-text-muted">{footnote}</p> : null}
      </div>
      {features.length > 0 ? (
        <div className="flex flex-1 flex-col gap-3 border-t border-border/60 pt-5">
          {featuresTitle ? (
            <p className="text-sm font-semibold text-text-muted">{featuresTitle}</p>
          ) : null}
          <ul className="flex flex-col gap-2.5">
            {features.map((feature) => (
              <li key={feature.text} className="flex items-start gap-2.5 text-base">
                {feature.included ? (
                  <span
                    aria-hidden
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"
                  >
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"
                  >
                    <Minus className="size-3.5" strokeWidth={3} />
                  </span>
                )}
                <span
                  className={cn(
                    feature.highlight && "font-semibold",
                    !feature.included && "text-text-muted",
                  )}
                >
                  {feature.text}
                  {feature.included ? null : (
                    <span className="sr-only">
                      {" "}
                      ({t("billing.feature.notIncluded", undefined, locale)})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {finePrint ? <p className="text-sm text-text-muted">{finePrint}</p> : null}
    </article>
  );
}
