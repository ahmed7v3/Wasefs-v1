"use client";

import { t } from "@wasfa/shared/i18n";
import { reauthSchema } from "@wasfa/shared/schemas/auth";
import { Button, Dialog, Field, PasswordInput } from "@wasfa/ui";

import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

import type { ButtonProps } from "@wasfa/ui";

export interface PasswordConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  /** The verb of the confirm button (DESIGN-SYSTEM §5.2: destructive confirmations name the action). */
  confirmLabel: string;
  confirmVariant?: ButtonProps["variant"];
  /** Runs the action with the typed password; throws an `ApiRequestError` to show it. */
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

function PasswordForm({
  confirmLabel,
  confirmVariant,
  onConfirm,
  onClose,
}: Pick<PasswordConfirmDialogProps, "confirmLabel" | "confirmVariant" | "onConfirm" | "onClose">) {
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
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant={confirmVariant} name="confirm" loading={form.submitting}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/** A dialog that asks for the account password before one sensitive security action. */
export function PasswordConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant,
  onConfirm,
  onClose,
}: PasswordConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
    >
      {/* Mounted only while open, so every attempt starts with an empty field. */}
      {open ? (
        <PasswordForm
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant}
          onConfirm={onConfirm}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}
