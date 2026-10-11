"use client";

import { t } from "@wasfa/shared/i18n";
import { reasonSchema } from "@wasfa/shared/schemas/admin";
import { Button, Dialog, Field, Textarea } from "@wasfa/ui";
import { z } from "zod";

import { useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { ReactNode } from "react";

/** A confirmation with nothing to type: the explicit verb button is the confirmation. */
const emptySchema = z.object({});

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** The explicit verb of the action ("Suspend", "Delete the role"), never "OK" (DESIGN-SYSTEM §5.2). */
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** Asks for a written reason (5 to 500 characters), kept in the audit trail. */
  withReason?: boolean;
  /**
   * Performs the write. It runs through `useReauth().run`, so a `reauth` answer opens the password
   * dialog and the same call is replayed once. Throw (the `api` client does) to show the error.
   */
  onConfirm: (reason: string) => Promise<void>;
  children?: ReactNode;
}

type FormProps = Pick<ConfirmDialogProps, "onOpenChange" | "confirmLabel" | "tone" | "onConfirm">;

function Actions({
  onOpenChange,
  confirmLabel,
  tone,
  submitting,
  formError,
}: Pick<FormProps, "onOpenChange" | "confirmLabel" | "tone"> & {
  submitting: boolean;
  formError: ApiRequestError | null;
}) {
  return (
    <>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          name="cancel"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          name="confirm"
          variant={tone === "danger" ? "danger" : "primary"}
          loading={submitting}
        >
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}

function ReasonForm({ onConfirm, onOpenChange, ...rest }: FormProps) {
  const reauth = useReauth();
  const form = useApiForm({
    schema: reasonSchema,
    initial: { reason: "" },
    submit: async ({ reason }) => {
      await reauth.run(() => onConfirm(reason));
      onOpenChange(false);
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.reason.label")}
        hint={t("admin.reason.hint")}
        required
        error={form.errors["reason"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            value={form.values.reason}
            onChange={(event) => {
              form.setValue("reason", event.target.value);
            }}
            onBlur={() => {
              form.blur("reason");
            }}
          />
        )}
      </Field>
      <Actions
        onOpenChange={onOpenChange}
        submitting={form.submitting}
        formError={form.formError}
        {...rest}
      />
    </form>
  );
}

function PlainForm({ onConfirm, onOpenChange, ...rest }: FormProps) {
  const reauth = useReauth();
  const form = useApiForm({
    schema: emptySchema,
    initial: {},
    submit: async () => {
      await reauth.run(() => onConfirm(""));
      onOpenChange(false);
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
      <Actions
        onOpenChange={onOpenChange}
        submitting={form.submitting}
        formError={form.formError}
        {...rest}
      />
    </form>
  );
}

/**
 * Confirmation of a write (suspend, revoke a role, delete). Optionally asks for a written reason.
 * The form is mounted only while open, so every request starts with an empty reason and no old error.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  withReason = false,
  ...form
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
      {children}
      {open ? (
        withReason ? (
          <ReasonForm onOpenChange={onOpenChange} {...form} />
        ) : (
          <PlainForm onOpenChange={onOpenChange} {...form} />
        )
      ) : null}
    </Dialog>
  );
}
