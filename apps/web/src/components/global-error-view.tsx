"use client";

import { t } from "@wasfa/shared/i18n/public";
import { Button } from "@wasfa/ui";

export default function GlobalErrorView({ reset }: { reset: () => void }) {
  return (
    <main>
      <h1 className="text-3xl font-bold text-primary">{t("errorPage.title")}</h1>
      <p className="mt-3 text-text-muted">{t("errorPage.body")}</p>
      <Button className="mt-8" onClick={reset}>
        {t("common.retry")}
      </Button>
    </main>
  );
}
