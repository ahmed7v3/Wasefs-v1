"use client";

import { t } from "@wasfa/shared/i18n";
import { resetPasswordSchema } from "@wasfa/shared/schemas/auth";
import { Button, Field, PasswordInput } from "@wasfa/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

/** Chooses the new password; the one-time token from the email link travels in the body, not in a field. */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const form = useApiForm({
    schema: resetPasswordSchema,
    initial: { newPassword: "", token },
    holdOnSuccess: true,
    submit: async (values) => {
      await api("/auth/reset-password", {
        method: "POST",
        body: { newPassword: values.newPassword, token: values.token },
      });
      router.replace("/login?reset=1");
    },
  });
  // A rejected or expired token is not a field the user can fix.
  const tokenRejected = form.formError?.code === "VALIDATION_FAILED";

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5">
      <Field
        label={t("auth.reset.newPassword")}
        hint={t("form.passwordHint")}
        required
        error={form.errors["newPassword"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("newPassword")} autoComplete="new-password" />
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      {tokenRejected ? (
        <Link
          href="/forgot-password"
          className="inline-flex min-h-11 items-center rounded-sm text-base font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("auth.reset.requestNew")}
        </Link>
      ) : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("auth.reset.submit")}
      </Button>
    </form>
  );
}
