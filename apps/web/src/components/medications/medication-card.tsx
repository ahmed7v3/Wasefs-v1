import { t } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";
import { Card } from "@wasfa/ui";
import Link from "next/link";

import { formatDate } from "../../lib/dates";

import type { MedicationSummary } from "@wasfa/shared/schemas/medications";

/** The price as shown to people, from integer minor units; `null` when the admin hides prices. */
export function priceText(minor: number | null, currency: string): string | null {
  if (minor === null) return null;
  return formatMoney(minor, currency);
}

/** The first line of a medication: its English brand, then the Arabic one when there is one. */
export function brandTitle(item: Pick<MedicationSummary, "brandEn" | "brandAr">): string {
  return item.brandAr ? `${item.brandEn} · ${item.brandAr}` : item.brandEn;
}

/**
 * One medication as a compact card linking to its detail page: used for search results and for the
 * alternatives. Stateless, so server and client components can both render it.
 */
export function MedicationCard({ item }: { item: MedicationSummary }) {
  const price = priceText(item.priceMinor, item.currency);
  const facts = [item.strengthText, item.form, item.packText].filter(
    (value): value is string => value !== null && value.trim() !== "",
  );
  const title = brandTitle(item);
  return (
    <Card padding="compact" className="flex flex-col gap-1">
      <Link
        href={`/medications/${item.id}`}
        aria-label={t("medications.open", { name: title })}
        className="inline-flex min-h-11 items-center rounded-md text-lg font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        <bdi>{title}</bdi>
      </Link>
      {item.ingredients.length > 0 ? (
        <p className="text-base text-text">
          <bdi>{item.ingredients.join(" + ")}</bdi>
        </p>
      ) : null}
      {facts.length > 0 ? (
        <p className="text-sm text-text-muted">
          <bdi>{facts.join(" · ")}</bdi>
        </p>
      ) : null}
      {item.manufacturer ? (
        <p className="text-sm text-text-muted">
          <bdi>{item.manufacturer}</bdi>
        </p>
      ) : null}
      {price !== null ? (
        <p className="text-base font-semibold tabular-nums text-text">
          <bdi>{t("medications.price.approx", { price })}</bdi>
          {item.priceUpdatedAt ? (
            <span className="ms-2 text-sm font-normal text-text-muted">
              {t("medications.price.updated", { date: formatDate(item.priceUpdatedAt) })}
            </span>
          ) : null}
        </p>
      ) : null}
    </Card>
  );
}
