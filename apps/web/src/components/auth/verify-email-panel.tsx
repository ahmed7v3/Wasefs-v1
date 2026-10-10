"use client";

import { t } from "@wasfa/shared/i18n";
import { buttonStyles } from "@wasfa/ui";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { PENDING_EMAIL_KEY } from "../../lib/auth-api";

import { ResendVerification } from "./resend-verification";

type Stored = { state: "loading" } | { state: "ready"; email: string | undefined };

/** "Check your inbox" after registering, with the resend action. The address comes from this tab's storage. */
export function VerifyEmailPanel({ nonce }: { nonce?: string | undefined }) {
  const [stored, setStored] = useState<Stored>({ state: "loading" });

  useEffect(() => {
    // sessionStorage exists only in the browser, so it is read after mount.
    let email: string | undefined;
    try {
      email = sessionStorage.getItem(PENDING_EMAIL_KEY) ?? undefined;
    } catch {
      email = undefined;
    }
    setStored({ state: "ready", email });
  }, []);

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <span
        aria-hidden
        className="grid size-16 place-items-center rounded-full bg-primary-soft text-primary"
      >
        <MailCheck className="size-8" />
      </span>
      {stored.state === "ready" && stored.email ? (
        <p className="text-lg text-text">
          {t("auth.verify.sentTo")}{" "}
          <bdi dir="ltr" className="font-semibold">
            {stored.email}
          </bdi>
        </p>
      ) : null}
      <p className="text-base text-text-muted">{t("auth.verify.instructions")}</p>
      <div className="w-full text-start">
        {stored.state === "ready" ? (
          <ResendVerification email={stored.email} nonce={nonce} />
        ) : null}
      </div>
      <Link href="/login" className={buttonStyles({ variant: "ghost" })}>
        {t("auth.verify.backToLogin")}
      </Link>
    </div>
  );
}
