"use client";

import { t } from "@wasfa/shared/i18n";
import { sendVerificationEmailSchema } from "@wasfa/shared/schemas/auth";
import { Button, Field, Input } from "@wasfa/ui";
import { useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { VERIFIED_CALLBACK } from "../../lib/auth-api";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";
import { Turnstile, useTurnstile } from "../turnstile";

/** Seconds before the next resend (the API also limits per address and per IP). */
export const RESEND_COOLDOWN_SECONDS = 60;

export interface ResendVerificationProps {
  /** The address to send to; when unknown the user types it. */
  email?: string | undefined;
  nonce?: string | undefined;
}

/** "Send the link again": Turnstile, a 60 s cooldown, and the same neutral answer whether or not the account exists. */
export function ResendVerification({ email, nonce }: ResendVerificationProps) {
  const ts = useTurnstile();
  const [cooldown, setCooldown] = useState(0);
  const [sent, setSent] = useState(false);

  const form = useApiForm({
    schema: sendVerificationEmailSchema,
    initial: { email: email ?? "" },
    submit: async (values) => {
      try {
        await api("/auth/send-verification-email", {
          method: "POST",
          body: { email: values.email, callbackURL: VERIFIED_CALLBACK },
          turnstileToken: ts.requireToken(),
        });
        setSent(true);
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } finally {
        ts.reset();
      }
    },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      {email === undefined ? (
        <Field
          label={t("auth.field.email")}
          required
          error={form.errors["email"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              {...form.bind("email")}
              type="email"
              ltr
              inputMode="email"
              autoComplete="email"
            />
          )}
        </Field>
      ) : null}

      <Turnstile nonce={nonce} {...ts.widgetProps} />

      {sent ? <Notice tone="success">{t("auth.resend.sent")}</Notice> : null}
      {form.formError ? <ErrorNotice error={form.formError} /> : null}

      <Button
        type="submit"
        variant="secondary"
        name="resend"
        loading={form.submitting}
        disabled={cooldown > 0}
      >
        {cooldown > 0 ? t("auth.resend.wait", { seconds: cooldown }) : t("auth.resend.button")}
      </Button>
    </form>
  );
}
