"use client";

import { t } from "@wasfa/shared/i18n";
import { Badge, Button, Card, CardTitle, Checkbox, Dialog, Field, Input } from "@wasfa/ui";
import { useState } from "react";

import { toApiError } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ConfirmDialog } from "./confirm-dialog";

import type { ApiRequestError } from "../../lib/api-error";
import type { FormEvent } from "react";

export const KILL_SWITCH_NAMES = ["all", "rx", "chat", "search"] as const;
export type KillSwitchName = (typeof KILL_SWITCH_NAMES)[number];
export type KillSwitchValue = Record<KillSwitchName, boolean>;

export interface KillSwitchChange {
  name: KillSwitchName;
  next: boolean;
}

/** Turning a switch ON stops a feature for everyone, so the admin must type the word, not just click. */
function StopForm({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => Promise<void> }) {
  const reauth = useReauth();
  const word = t("admin.ai.kill.word");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<ApiRequestError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (typed.trim().toLowerCase() !== word.toLowerCase()) {
      setError(t("admin.ai.kill.typeError", { word }));
      setSubmitCount((count) => count + 1);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    setFormError(null);
    reauth.run(onConfirm).then(
      () => {
        onClose();
      },
      (failure: unknown) => {
        setSubmitting(false);
        setFormError(toApiError(failure));
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.ai.kill.typeLabel", { word })}
        required
        error={error}
        announceError={submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            name="confirmWord"
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setError(undefined);
            }}
          />
        )}
      </Field>
      {formError ? <ErrorNotice error={formError} /> : null}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="ghost" name="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" name="confirm" variant="danger" loading={submitting}>
          {t("admin.ai.kill.confirmOn")}
        </Button>
      </div>
    </form>
  );
}

export interface KillSwitchCardProps {
  value: KillSwitchValue;
  /** True only for an account with `ai.write` and `ai.killswitch`. */
  canChange: boolean;
  /** Saves the whole switch set. Throws (the `api` client does) when the API refuses. */
  onChange: (next: KillSwitchValue, changed: KillSwitchChange) => Promise<void>;
}

/**
 * The emergency switches. Nothing changes on the click itself: every change opens a confirmation
 * (typing the word for ON, a plain confirmation for OFF) and the card shows the saved state only.
 */
export function KillSwitchCard({ value, canChange, onChange }: KillSwitchCardProps) {
  const [pending, setPending] = useState<KillSwitchChange | null>(null);
  const active = KILL_SWITCH_NAMES.filter((name) => value[name]);

  const apply = (change: KillSwitchChange) => () =>
    onChange({ ...value, [change.name]: change.next }, change);
  const close = () => {
    setPending(null);
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{t("admin.ai.kill.title")}</CardTitle>
          <p className="text-sm text-text-muted">{t("admin.ai.kill.description")}</p>
        </div>
        <Badge tone={active.length > 0 ? "danger" : "success"}>
          {active.length > 0 ? t("admin.ai.on") : t("admin.ai.off")}
        </Badge>
      </div>

      {active.length > 0 ? (
        <Notice tone="warning">
          {t("admin.ai.kill.activeNotice", {
            names: active.map((name) => t(`admin.ai.kill.name.${name}`)).join("، "),
          })}
        </Notice>
      ) : (
        <p className="text-sm text-text-muted">{t("admin.ai.kill.allClear")}</p>
      )}

      <fieldset className="flex flex-col gap-1" disabled={!canChange}>
        <legend className="sr-only">{t("admin.ai.kill.title")}</legend>
        {KILL_SWITCH_NAMES.map((name) => (
          <Checkbox
            key={name}
            name={`killSwitch.${name}`}
            label={t(`admin.ai.kill.label.${name}`)}
            checked={value[name]}
            disabled={!canChange}
            onChange={(event) => {
              setPending({ name, next: event.target.checked });
            }}
          />
        ))}
      </fieldset>
      {!canChange ? (
        <p className="text-sm text-text-muted">{t("admin.ai.kill.noPermission")}</p>
      ) : null}

      <Dialog
        open={pending !== null && pending.next}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t("admin.ai.kill.onTitle", {
          name: pending ? t(`admin.ai.kill.name.${pending.name}`) : "",
        })}
        description={t("admin.ai.kill.onBody", { word: t("admin.ai.kill.word") })}
      >
        {pending?.next ? <StopForm onClose={close} onConfirm={apply(pending)} /> : null}
      </Dialog>

      <ConfirmDialog
        open={pending !== null && !pending.next}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={t("admin.ai.kill.offTitle", {
          name: pending ? t(`admin.ai.kill.name.${pending.name}`) : "",
        })}
        description={t("admin.ai.kill.offBody")}
        confirmLabel={t("admin.ai.kill.confirmOff")}
        onConfirm={async () => {
          if (pending) await apply(pending)();
        }}
      />
    </Card>
  );
}
