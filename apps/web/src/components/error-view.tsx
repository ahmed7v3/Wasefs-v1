"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, Container } from "@wasfa/ui";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { extractErrorRef } from "../lib/api-error";

export default function ErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Only an error that came back from the API carries a WSF-XXXX-XXXX reference for support.
  const ref = extractErrorRef(error);

  return (
    <div className="page-backdrop min-h-dvh">
      <Container width="reading" className="grid min-h-dvh place-items-center py-10">
        <main id="main" className="w-full">
          <Card elevation="raised" className="text-center" role="alert">
            <TriangleAlert className="mx-auto size-12 text-danger" aria-hidden="true" />
            <h1 className="mt-5 font-heading text-3xl font-bold text-primary">
              {t("errorPage.title")}
            </h1>
            <p className="mt-3 text-text-muted">{t("errorPage.body")}</p>
            {ref ? (
              <p className="mt-4 rounded-md bg-danger-soft px-4 py-2 text-sm font-semibold text-danger">
                {t("common.errorRef", { ref })}
              </p>
            ) : null}
            <Button className="mt-8" onClick={reset}>
              <RotateCcw className="size-4 rtl:-scale-x-100" aria-hidden="true" />
              {t("common.retry")}
            </Button>
          </Card>
        </main>
      </Container>
    </div>
  );
}
