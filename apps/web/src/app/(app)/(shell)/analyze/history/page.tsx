import { t } from "@wasfa/shared/i18n";
import { redirect } from "next/navigation";

import { RxHistory } from "../../../../../components/rx/rx-history";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("rx.history.title") };

export default async function AnalysisHistoryPage() {
  const me = await requireOnboarded("/analyze/history");
  if (!me.canUseTools) redirect("/analyze");
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("rx.history.title")}
        </h1>
        <p className="text-lg text-text-muted">{t("rx.history.lead")}</p>
      </header>
      <RxHistory />
    </div>
  );
}
