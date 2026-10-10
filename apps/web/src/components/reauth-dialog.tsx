"use client";

import { t } from "@wasfa/shared/i18n";
import { reauthSchema } from "@wasfa/shared/schemas/auth";
import { Button, Dialog, Field, PasswordInput } from "@wasfa/ui";

import { useApiForm } from "../lib/forms";

import { ErrorNotice } from "./error-notice";

export interface ReauthDialogProps {
  open: boolean;
  /** Proves the password to the API; throws an `ApiRequestError` when it is wrong. */
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
}

function ReauthForm({ onConfirm, onCancel }: Omit<ReauthDialogProps, "open">) {
  const form = useApiForm({
    schema: reauthSchema,
    initial: { password: "" },
    submit: (values) => onConfirm(values.password),
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("auth.field.password")}
        required
        error={form.errors["password"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PasswordInput {...control} {...form.bind("password")} autoComplete="current-password" />
        )}
      </Field>
      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="confirm" loading={form.submitting}>
          {t("auth.reauth.confirm")}
        </Button>
      </div>
    </form>
  );
}

/** "Confirm it is you": asks for the password before a sensitive action (DESIGN-SYSTEM §6.6). */
export function ReauthDialog({ open, onConfirm, onCancel }: ReauthDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t("auth.reauth.title")}
      description={t("auth.reauth.body")}
    >
      {/* Mounted only while open, so every request starts with an empty field. */}
      {open ? <ReauthForm onConfirm={onConfirm} onCancel={onCancel} /> : null}
    </Dialog>
  );
}
