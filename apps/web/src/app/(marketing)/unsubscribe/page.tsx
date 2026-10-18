import { t } from "@wasfa/shared/i18n";
import { Container } from "@wasfa/ui";

import { UnsubscribeConfirm } from "../../../components/growth/unsubscribe-confirm";
import { Notice } from "../../../components/notice";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: t("growth.unsubscribe.pageTitle"),
  robots: { index: false, follow: false },
};

/** The footer link of lifecycle mail: no sign-in needed, the signed token is the authority. */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams)["token"];
  const token = typeof raw === "string" && /^[A-Za-z0-9._-]{20,200}$/.test(raw) ? raw : null;
  return (
    <Container className="flex max-w-xl flex-col gap-6 py-12 sm:py-16">
      <h1 className="font-heading text-3xl font-bold text-primary">
        {t("growth.unsubscribe.pageTitle")}
      </h1>
      {token ? (
        <>
          <p className="text-lg text-text">{t("growth.unsubscribe.lead")}</p>
          <UnsubscribeConfirm token={token} />
        </>
      ) : (
        <Notice tone="warning">{t("growth.unsubscribe.invalid")}</Notice>
      )}
    </Container>
  );
}
