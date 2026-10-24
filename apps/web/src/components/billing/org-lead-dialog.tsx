"use client";

import { t as translate, type MessageKey } from "@wasfa/shared/i18n/public";
import { Button, Dialog } from "@wasfa/ui";
import dynamic from "next/dynamic";
import { useState } from "react";

import type { Locale } from "@wasfa/shared/i18n";

// The form (schema, Turnstile, phone input) is fetched when the dialog first opens, not with the page.
const LeadForm = dynamic(() => import("./org-lead-form").then((module) => module.LeadForm), {
  ssr: false,
});
const Sent = dynamic(() => import("./org-lead-form").then((module) => module.Sent), {
  ssr: false,
});

/** `t` bound to the page language (the dialog is shared by the Arabic and the English page). */
function useT(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    translate(key, params, locale);
}

/** «اطلب عرضًا خاصًا»: opens the institution lead form (Turnstile-protected, like the contact form). */
export function OrgLeadDialog({
  nonce,
  locale = "ar",
}: {
  nonce?: string | undefined;
  locale?: Locale | undefined;
}) {
  const t = useT(locale);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const close = () => {
    setOpen(false);
    setSent(false);
  };

  return (
    <>
      <Button
        variant="secondary"
        name="open-lead"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("billing.org.cta")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={t("billing.lead.title")}
        description={sent ? undefined : t("billing.lead.lead")}
      >
        {/* Mounted only while open: every request starts with an empty form and a fresh Turnstile. */}
        {open ? (
          sent ? (
            <Sent onClose={close} locale={locale} />
          ) : (
            <LeadForm
              nonce={nonce}
              locale={locale}
              onSent={() => {
                setSent(true);
              }}
            />
          )
        ) : null}
      </Dialog>
    </>
  );
}
