import { t } from "@wasfa/shared/i18n";
import { Card, Container, buttonStyles } from "@wasfa/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("notFound.title"),
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="page-backdrop min-h-dvh">
      <Container width="reading" className="grid min-h-dvh place-items-center py-10">
        <main id="main" className="w-full">
          <Card elevation="raised" className="text-center">
            <SearchX className="mx-auto size-12 text-primary" aria-hidden="true" />
            <h1 className="mt-5 font-heading text-3xl font-bold text-primary">
              {t("notFound.title")}
            </h1>
            <p className="mt-3 text-text-muted">{t("notFound.body")}</p>
            <Link href="/" className={buttonStyles({ className: "mt-8" })}>
              {t("common.backHome")}
            </Link>
          </Card>
        </main>
      </Container>
    </div>
  );
}
