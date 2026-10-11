"use client";

import { t } from "@wasfa/shared/i18n";
import { ACCOUNT_DELETION_GRACE_DAYS, deleteMeResponseSchema } from "@wasfa/shared/schemas/user";
import { Button, Card, Dialog, Field, Input } from "@wasfa/ui";
import { useState } from "react";

import { api } from "../../lib/api-client";
import { errorReason } from "../../lib/api-error";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";

/** Where the browser goes after a deletion request: the home page, with a notice the page can show. */
export const DELETED_NOTICE_PATH = "/?notice=account_deleted";

/** Typed confirmation is compared without case, spacing or Unicode form differences. */
export function confirmationMatches(typed: string, word: string): boolean {
  const normalize = (value: string) => value.normalize("NFC").trim().toLocaleLowerCase();
  return normalize(typed) !== "" && normalize(typed) === normalize(word);
}

/**
 * Account deletion: what happens, a typed confirmation, then a dialog with an explicit verb. The
 * request itself asks for the password again when the session is not fresh (`useReauth`).
 */
export function DeleteAccount() {
  const reauth = useReauth();
  const word = t("account.delete.word");
  const days = ACCOUNT_DELETION_GRACE_DAYS;
  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const matches = confirmationMatches(typed, word);

  const remove = () => {
    setBusy(true);
    setError(null);
    reauth
      .run(() => api("/me", { method: "DELETE", schema: deleteMeResponseSchema }))
      .then(() => {
        // The API ended every session, this one included: leave the signed-in pages for good.
        window.location.assign(DELETED_NOTICE_PATH);
      })
      .catch((caught: unknown) => {
        setError(caught);
        setBusy(false);
      });
  };

  const lastAdmin = errorReason(error) === "last_org_admin";

  return (
    <Card className="flex max-w-xl flex-col gap-5">
      <p className="text-base text-text">{t("account.delete.lead", { days })}</p>
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-xl font-semibold text-text">{t("account.delete.what")}</h2>
        <ul className="list-disc ps-6 text-base text-text-muted">
          <li>{t("account.delete.what1")}</li>
          <li>{t("account.delete.what2")}</li>
          <li>{t("account.delete.what3", { days })}</li>
        </ul>
      </div>
      <Field label={t("account.delete.confirmLabel", { word })}>
        {(control) => (
          <Input
            {...control}
            name="confirmation"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            autoComplete="off"
          />
        )}
      </Field>
      <div>
        <Button
          variant="danger"
          size="lg"
          name="delete-account"
          disabled={!matches}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {t("account.delete.button")}
        </Button>
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
        title={t("account.delete.dialogTitle")}
        description={t("account.delete.dialogBody", { days })}
        actions={
          <>
            <Button
              variant="ghost"
              name="cancel"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="danger" name="confirm-delete" loading={busy} onClick={remove}>
              {t("account.delete.dialogConfirm")}
            </Button>
          </>
        }
      >
        {error ? (
          lastAdmin ? (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-soft p-4 text-base text-text"
            >
              {t("account.delete.lastAdmin")}
            </p>
          ) : (
            <ErrorNotice error={error} />
          )
        ) : null}
      </Dialog>
    </Card>
  );
}
