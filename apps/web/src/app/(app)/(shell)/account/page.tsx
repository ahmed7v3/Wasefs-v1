import { t } from "@wasfa/shared/i18n";

import { MarketingEmails } from "../../../../components/account/marketing-emails";
import { PhoneSection } from "../../../../components/account/phone-section";
import { ProfileForm } from "../../../../components/account/profile-form";
import { getNonce } from "../../../../lib/nonce";
import { requireOnboarded } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("account.profile.title") };

export default async function AccountPage() {
  const me = await requireOnboarded("/account");
  const nonce = me.phoneVerified ? undefined : await getNonce();

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("account.profile.title")}
        </h1>
        <p className="text-lg text-text-muted">{t("account.profile.lead")}</p>
      </header>
      <ProfileForm
        name={me.name}
        locale={me.locale}
        email={me.email}
        emailVerified={me.emailVerified}
      />
      <PhoneSection phone={me.phone} phoneVerified={me.phoneVerified} nonce={nonce} />
      <MarketingEmails />
    </div>
  );
}
