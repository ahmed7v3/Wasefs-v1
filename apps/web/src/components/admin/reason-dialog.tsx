"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Dialog, Field, Input, Textarea } from "@wasfa/ui";
import { useState } from "react";

import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent, ReactNode } from "react";

/** The shortest reason the audit trail accepts (the same bound as the other admin dialogs). */
export const REASON_MIN_LENGTH = 5;

export interface ReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One sentence that states the effect of the action ("The subscription ends now"). */
  effect: ReactNode;
  /** The explicit verb of the action, never "OK". */
  confirmLabel: string;
  tone?: "primary" | "danger";
  /** Irreversible actions ask the admin to type this word before the button enables. */
  typedConfirmation?: string | undefined;
  /** Extra fields shown between the effect and the reason (an amount, a transfer reference). */
  children?: ReactNode;
  /** False keeps the confirm button disabled while the extra fields are not valid. */
  canSubmit?: boolean;
  /**
   * Performs the write. It runs through `useReauth().run`: a "confirm it is you" answer opens the
   * password dialog and the same call is replayed once. Throw (the `api` client does) to show the error.
   */
  onConfirm: (reason: string) => Promise<void>;
}

function ReasonForm({
  effect,
  confirmLabel,
  tone,
  typedConfirmation,
  children,
  canSubmit,
  onConfirm,
  onOpenChange,
}: Omit<ReasonDialogProps, "open" | "title">) {
  const reauth = useReauth();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiRequestError | null>(null);

  const reasonValid = reason.trim().length >= REASON_MIN_LENGTH;
  const typedValid = typedConfirmation === undefined || typed.trim() === typedConfirmation;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (busy || !reasonValid || !typedValid || canSubmit === false) return;
    setBusy(true);
    setError(null);
    reauth
      .run(() => onConfirm(reason.trim()))
      .then(
        () => {
          setBusy(false);
          onOpenChange(false);
        },
        (failure: unknown) => {
          setBusy(false);
          setError(toApiError(failure));
        },
      );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="rounded-lg bg-primary-soft px-4 py-3 text-base text-text">{effect}</p>
      {children}
      <Field
        label={t("admin.reason.label")}
        hint={t("admin.reason.hint")}
        required
        error={touched && !reasonValid ? t("admin.revenue.reason.tooShort") : undefined}
        announceError={touched}
      >
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        )}
      </Field>
      {typedConfirmation !== undefined ? (
        <Field
          label={t("admin.revenue.reason.typeToConfirm", { word: typedConfirmation })}
          required
        >
          {(control) => (
            <Input
              {...control}
              name="typedConfirmation"
              ltr
              autoComplete="off"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
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
          loading={busy}
          disabled={!typedValid || canSubmit === false}
        >
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The one pattern of a dangerous admin action (ADMIN-CONSOLE-SPEC §1.5): a sentence with the effect,
 * a required reason for the audit trail, an optional typed confirmation, and the fresh-auth prompt
 * chained in when the API asks for it. The form is mounted only while open, so it always starts empty.
 */
export function ReasonDialog({ open, onOpenChange, title, ...form }: ReasonDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      {open ? <ReasonForm onOpenChange={onOpenChange} {...form} /> : null}
    </Dialog>
  );
}
