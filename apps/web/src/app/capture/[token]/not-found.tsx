import { t } from "@wasfa/shared/i18n";
import { Card, Container, buttonStyles } from "@wasfa/ui";
import { LinkIcon } from "lucide-react";
import Link from "next/link";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("capture.phonePage.invalid.title"),
  robots: { index: false, follow: false },
};

/** A phone link that is unknown, used up or past its five minutes. Says so kindly, leaks nothing. */
export default function CaptureLinkNotFound() {
  return (
    <div className="page-backdrop min-h-dvh">
      <Container width="reading" className="grid min-h-dvh place-items-center py-10">
        <main id="main" className="w-full">
          <Card elevation="raised" className="text-center">
            <LinkIcon className="mx-auto size-12 text-primary" aria-hidden="true" />
            <h1 className="mt-5 font-heading text-2xl font-bold text-primary">
              {t("capture.phonePage.invalid.title")}
            </h1>
            <p className="mt-3 text-text-muted">{t("capture.phonePage.invalid.body")}</p>
            <Link href="/" className={buttonStyles({ className: "mt-8" })}>
              {t("capture.phonePage.home")}
            </Link>
          </Card>
        </main>
      </Container>
    </div>
  );
}
