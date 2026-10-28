import { t } from "@wasfa/shared/i18n";
import { buttonStyles, Card } from "@wasfa/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { formatDate } from "../../lib/dates";

import { brandTitle, MedicationCard, priceText } from "./medication-card";

import type { MedicationDetailResponse } from "@wasfa/shared/schemas/medications";

/** `/medications/[id]`: the facts of one medication, its same-ingredient alternatives and next steps. */
export function MedicationDetailView({ detail }: { detail: MedicationDetailResponse }) {
  const { medication, alternatives } = detail;
  const price = priceText(medication.priceMinor, medication.currency);
  const oldPrice = priceText(medication.oldPriceMinor, medication.currency);
  const ingredients =
    medication.ingredientStrengths.length > 0
      ? medication.ingredientStrengths.map((item) =>
          item.strength ? `${item.name} ${item.strength}` : item.name,
        )
      : medication.ingredients;

  const facts: ReadonlyArray<readonly [string, string | null]> = [
    [t("medications.field.ingredients"), ingredients.length > 0 ? ingredients.join(" + ") : null],
    [t("medications.field.strength"), medication.strengthText],
    [t("medications.field.form"), medication.form],
    [t("medications.field.pack"), medication.packText],
    [
      t("medications.field.units"),
      medication.unitsCount === null ? null : String(medication.unitsCount),
    ],
    [t("medications.field.manufacturer"), medication.manufacturer],
    [t("medications.field.category"), medication.category],
    [t("medications.field.barcode"), medication.barcode],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/medications"
        className="inline-flex min-h-11 w-fit items-center gap-2 rounded-md text-base font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        <ArrowRight aria-hidden className="size-4 ltr:rotate-180" />
        {t("medications.detail.back")}
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          <bdi>{brandTitle(medication)}</bdi>
        </h1>
        {price !== null ? (
          <div className="flex flex-col gap-1">
            <p className="text-2xl font-bold tabular-nums text-text">
              <bdi>{t("medications.price.approx", { price })}</bdi>
            </p>
            {medication.priceUpdatedAt ? (
              <p className="text-sm text-text-muted">
                {t("medications.detail.priceNote", { date: formatDate(medication.priceUpdatedAt) })}
              </p>
            ) : null}
            {oldPrice !== null ? (
              <p className="text-sm tabular-nums text-text-muted">
                <bdi>{t("medications.detail.oldPrice", { price: oldPrice })}</bdi>
              </p>
            ) : null}
          </div>
        ) : null}
      </header>

      <Card>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts
            .filter(([, value]) => value !== null && value.trim() !== "")
            .map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-sm text-text-muted">{label}</dt>
                <dd className="text-base text-text">
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
        </dl>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link href="/analyze" className={buttonStyles({})}>
          {t("medications.detail.analyze")}
        </Link>
        <Link href="/ai" className={buttonStyles({ variant: "secondary" })}>
          {t("medications.detail.ask")}
        </Link>
      </div>

      <section aria-labelledby="medication-alternatives" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="medication-alternatives" className="font-heading text-2xl font-bold text-text">
            {t("medications.detail.alternatives.title")}
          </h2>
          <p className="text-base text-text-muted">{t("medications.detail.alternatives.lead")}</p>
        </div>
        {alternatives.length === 0 ? (
          <p className="text-base text-text-muted">{t("medications.detail.alternatives.empty")}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {alternatives.map((item) => (
              <li key={item.id}>
                <MedicationCard item={item} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-text-muted">{t("medications.detail.disclaimer")}</p>
    </div>
  );
}
