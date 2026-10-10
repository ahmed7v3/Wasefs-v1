"use client";

import { t } from "@wasfa/shared/i18n";
import { requestPasswordResetSchema } from "@wasfa/shared/schemas/auth";
import { Button, Field, Input, buttonStyles } from "@wasfa/ui";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { RESET_PATH, siteUrl } from "../../lib/auth-api";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { Turnstile, useTurnstile } from "../turnstile";

/** Asks for the account email and always ends in the same neutral confirmation (no account enumeration). */
export function ForgotPasswordForm({ nonce }: { nonce?: string | undefined }) {
  const ts = useTurnstile();
  const [done, setDone] = useState(false);
  const form = useApiForm({
    schema: requestPasswordResetSchema,
    initial: { email: "" },
    submit: async (values) => {
      try {
        await api("/auth/request-password-reset", {
          method: "POST",
          body: { email: values.email, redirectTo: siteUrl(RESET_PATH) },
          turnstileToken: ts.requireToken(),
        });
        setDone(true);
      } finally {
        ts.reset();
      }
    },
  });

  if (done) {
    return (
      <div className="flex flex-col items-center gap-5 text-center" role="status">
        <span
          aria-hidden
          className="grid size-16 place-items-center rounded-full bg-primary-soft text-primary"
        >
          <MailCheck className="size-8" />
        </span>
        <p className="text-lg text-text">{t("auth.forgot.done")}</p>
        <Link href="/login" className={buttonStyles({ variant: "secondary" })}>
          {t("auth.verify.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5">
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
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.forgot.submit")}
      </Button>
      <Link
        href="/login"
        className="inline-flex min-h-11 items-center justify-center rounded-sm text-base font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("auth.verify.backToLogin")}
      </Link>
    </form>
  );
}
