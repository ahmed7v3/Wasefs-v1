import { t } from "@wasfa/shared/i18n";

import { DeleteAccount } from "../../../../../components/account/delete-account";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("account.delete.title") };

export default async function DeleteAccountPage() {
  await requireOnboarded("/account/delete");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("account.delete.title")}
        </h1>
      </header>
      <DeleteAccount />
    </div>
  );
}
