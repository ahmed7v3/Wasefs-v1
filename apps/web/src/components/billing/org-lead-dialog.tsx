"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Dialog } from "@wasfa/ui";
import dynamic from "next/dynamic";
import { useState } from "react";

// The form (schema, Turnstile, phone input) is fetched when the dialog first opens, not with the page.
const LeadForm = dynamic(() => import("./org-lead-form").then((module) => module.LeadForm), {
  ssr: false,
});
const Sent = dynamic(() => import("./org-lead-form").then((module) => module.Sent), {
  ssr: false,
});

/** «اطلب عرضًا خاصًا»: opens the institution lead form (Turnstile-protected, like the contact form). */
export function OrgLeadDialog({ nonce }: { nonce?: string | undefined }) {
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
            <Sent onClose={close} />
          ) : (
            <LeadForm
              nonce={nonce}
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
