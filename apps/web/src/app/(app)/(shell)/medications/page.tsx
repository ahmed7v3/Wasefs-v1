import { t } from "@wasfa/shared/i18n";
import { Suspense } from "react";

import { MedicationSearch } from "../../../../components/medications/medication-search";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("medications.title") };

export default async function MedicationsPage() {
  await requireOnboarded("/medications");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("medications.title")}
        </h1>
        <p className="text-lg text-text-muted">{t("medications.lead")}</p>
      </header>
      <Suspense>
        <MedicationSearch />
      </Suspense>
    </div>
  );
}
