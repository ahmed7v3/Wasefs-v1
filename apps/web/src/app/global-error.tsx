"use client";

import { t } from "@wasfa/shared/i18n";
import { Button } from "@wasfa/ui";

import "../styles/globals.css";

/** Last resort when the root layout itself fails: it replaces the layout, so it renders <html>. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="grid min-h-dvh place-items-center bg-bg p-6 text-center text-text">
        <main>
          <h1 className="text-3xl font-bold text-primary">{t("errorPage.title")}</h1>
          <p className="mt-3 text-text-muted">{t("errorPage.body")}</p>
          <Button className="mt-8" onClick={reset}>
            {t("common.retry")}
          </Button>
        </main>
      </body>
    </html>
  );
}
