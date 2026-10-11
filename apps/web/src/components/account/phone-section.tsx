"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, useToast } from "@wasfa/ui";
import { useRouter } from "next/navigation";

import { PhoneVerification } from "../phone-verification";

export interface PhoneSectionProps {
  phone: string | null;
  phoneVerified: boolean;
  nonce: string | undefined;
}

/** Phone number of the account: the verified number, or the WhatsApp verification flow (`#phone`). */
export function PhoneSection({ phone, phoneVerified, nonce }: PhoneSectionProps) {
  const router = useRouter();
  const { toast } = useToast();

  return (
    <section
      id="phone"
      aria-labelledby="phone-title"
      className="flex max-w-md scroll-mt-24 flex-col gap-4"
    >
      <h2 id="phone-title" className="font-heading text-2xl font-semibold text-text">
        {t("account.phone.title")}
      </h2>
      {phoneVerified && phone ? (
        <p className="flex flex-wrap items-center gap-2 text-base text-text">
          <bdi dir="ltr">{phone}</bdi>
          <Badge tone="success">{t("common.verified")}</Badge>
        </p>
      ) : (
        <>
          <p className="text-base text-text-muted">{t("account.phone.verifyLead")}</p>
          <PhoneVerification
            nonce={nonce}
            onVerified={() => {
              toast({ tone: "success", title: t("account.phone.verifiedDone") });
              router.refresh();
            }}
          />
        </>
      )}
    </section>
  );
}
