import { t } from "@wasfa/shared/i18n";

import { ChangePasswordForm } from "../../../../../components/account/change-password-form";
import { SessionsList } from "../../../../../components/account/sessions-list";
import { TwoFactorPanel } from "../../../../../components/account/two-factor-panel";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("account.security.title") };

export default async function SecurityPage() {
  const me = await requireOnboarded("/account/security");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("account.security.title")}
        </h1>
        <p className="text-lg text-text-muted">{t("account.security.lead")}</p>
      </header>
      <ChangePasswordForm />
      <TwoFactorPanel enabled={me.twoFactorEnabled} />
      <SessionsList />
    </div>
  );
}
