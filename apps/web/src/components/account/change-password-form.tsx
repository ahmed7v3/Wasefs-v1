"use client";

import { t } from "@wasfa/shared/i18n";
import { changePasswordSchema } from "@wasfa/shared/schemas/auth";
import { Button, Card, Checkbox, Field, PasswordInput, useToast } from "@wasfa/ui";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

function PasswordFields({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const form = useApiForm({
    schema: changePasswordSchema,
    initial: { currentPassword: "", newPassword: "", revokeOtherSessions: false },
    submit: async (values) => {
      await api("/auth/change-password", { method: "POST", body: values });
      toast({ tone: "success", title: t("account.password.done") });
      onChanged();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex max-w-md flex-col gap-5">
      <Field
        label={t("account.password.current")}
        required
        error={form.errors["currentPassword"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput
            {...control}
            {...form.bind("currentPassword")}
            autoComplete="current-password"
          />
        )}
      </Field>
      <Field
        label={t("account.password.new")}
        hint={t("form.passwordHint")}
        required
        error={form.errors["newPassword"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("newPassword")} autoComplete="new-password" />
        )}
      </Field>
      <Checkbox
        label={t("account.password.revokeOthers")}
        {...form.bindCheckbox("revokeOtherSessions")}
      />
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div>
        <Button type="submit" size="lg" name="change-password" loading={form.submitting}>
          {t("account.password.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Change the password (`POST /auth/change-password`), optionally ending every other session. */
export function ChangePasswordForm() {
  // A new key remounts the fields after a success, so no password stays in the inputs.
  const [round, setRound] = useState(0);
  return (
    <Card className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <KeyRound aria-hidden className="size-6 text-primary" />
        <h2 className="font-heading text-xl font-semibold text-text">
          {t("account.password.title")}
        </h2>
      </header>
      <PasswordFields
        key={round}
        onChanged={() => {
          setRound((current) => current + 1);
        }}
      />
    </Card>
  );
}
