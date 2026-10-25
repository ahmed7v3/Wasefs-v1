"use client";

import { t } from "@wasfa/shared/i18n";
import { sitePathSchema, type QualityGate } from "@wasfa/shared/schemas/content";
import { Button, Dialog, Field, Input } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { minScheduleLocal, zonedToUtc } from "../../../lib/content-editor/zoned-time";

import { GateList } from "./gate-list";

import type { ActionResult } from "../../../lib/content-editor/use-content-editor";

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-base text-danger">
      {message}
    </p>
  ) : null;
}

// ---------------------------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------------------------

export interface ScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  timeZone: string;
  busy: boolean;
  /** Last error of the write, shown inside the dialog (the page behind it is covered). */
  error: string | null;
  onConfirm: (at: Date) => Promise<ActionResult>;
  /** Injected clock for tests. */
  now?: () => Date;
}

/** Minutes ahead the API accepts a schedule time. */
export const SCHEDULE_MIN_MINUTES = 2;

function ScheduleForm({
  onClose,
  timeZone,
  busy,
  error,
  onConfirm,
  now = () => new Date(),
}: Omit<ScheduleDialogProps, "open">) {
  const min = minScheduleLocal(now(), timeZone, SCHEDULE_MIN_MINUTES);
  const [value, setValue] = useState(() => minScheduleLocal(now(), timeZone, 60));
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const at = zonedToUtc(value, timeZone);
    if (at === null || at.getTime() < now().getTime() + SCHEDULE_MIN_MINUTES * 60_000) {
      setProblem(t("admin.editor.schedule.tooSoon"));
      return;
    }
    setProblem(null);
    void onConfirm(at).then((result) => {
      if (result === "ok") onClose();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field
        label={t("admin.editor.schedule.label")}
        hint={t("admin.editor.schedule.hint", { zone: timeZone })}
        required
        error={problem ?? undefined}
        announceError
      >
        {(control) => (
          <Input
            {...control}
            type="datetime-local"
            min={min}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
          />
        )}
      </Field>
      <ErrorLine message={error} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={busy}>
          {t("admin.editor.action.schedule")}
        </Button>
      </div>
    </form>
  );
}

/** Schedule time typed on the Cairo wall clock (the `content.timeZone` setting), sent as a UTC instant. */
export function ScheduleDialog({ open, ...props }: ScheduleDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("admin.editor.schedule.title")}
    >
      {open ? <ScheduleForm {...props} /> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------------------------

export interface PublishDialogProps {
  open: boolean;
  onClose: () => void;
  gates: readonly QualityGate[];
  live: boolean;
  path: string | null;
  busy: boolean;
  error: string | null;
  /** The server offers publishing despite failing gates (the owner): they are advice, not a stop. */
  advisory?: boolean;
  onConfirm: () => Promise<ActionResult>;
}

/** Lists what blocks publishing (and can't proceed), or confirms what will go live. */
export function PublishDialog({
  open,
  onClose,
  gates,
  live,
  path,
  busy,
  error,
  advisory = false,
  onConfirm,
}: PublishDialogProps) {
  const failing = gates.filter((gate) => gate.level === "block" && !gate.ok);
  // Advisory gates are shown with the warnings and never hide the confirm button.
  const blocking = advisory ? [] : failing;
  const warnings = advisory ? gates.filter((gate) => !gate.ok) : gates.filter((gate) => gate.level !== "block" && !gate.ok);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t(
        live ? "admin.editor.publish.confirmUpdateTitle" : "admin.editor.publish.confirmTitle",
      )}
      description={
        blocking.length > 0
          ? t("admin.editor.publish.blocked")
          : t(
              live ? "admin.editor.publish.confirmUpdateBody" : "admin.editor.publish.confirmBody",
              {
                path: path ?? "",
              },
            )
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          {blocking.length > 0 ? <GateList gates={blocking} /> : null}
          {blocking.length === 0 && warnings.length > 0 ? (
            <section
              aria-label={t("admin.editor.publish.warnings")}
              className="flex flex-col gap-2"
            >
              <h3 className="text-base font-semibold text-text">
                {t(advisory ? "admin.editor.publish.advisory" : "admin.editor.publish.warnings")}
              </h3>
              <GateList gates={warnings} />
            </section>
          ) : null}
          <ErrorLine message={error} />
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              {blocking.length > 0 ? t("ui.close") : t("common.cancel")}
            </Button>
            {blocking.length === 0 ? (
              <Button
                loading={busy}
                onClick={() => {
                  void onConfirm().then((result) => {
                    if (result === "ok") onClose();
                  });
                }}
              >
                {t(live ? "admin.editor.action.update" : "admin.editor.action.publish")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------------------------

export interface ArchiveDialogProps {
  open: boolean;
  onClose: () => void;
  wasPublished: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: (redirectTo: string | undefined) => Promise<ActionResult>;
}

function ArchiveForm({
  onClose,
  wasPublished,
  busy,
  error,
  onConfirm,
}: Omit<ArchiveDialogProps, "open">) {
  const [redirect, setRedirect] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const target = redirect.trim();
    if (target !== "" && !sitePathSchema.safeParse(target).success) {
      setProblem(t("admin.editor.archive.invalidPath"));
      return;
    }
    setProblem(null);
    void onConfirm(target === "" ? undefined : target).then((result) => {
      if (result === "ok") onClose();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="rounded-lg bg-primary-soft px-4 py-3 text-base text-text">
        {t(
          wasPublished
            ? "admin.editor.archive.effectPublished"
            : "admin.editor.archive.effectDraft",
        )}
      </p>
      {wasPublished ? (
        <Field
          label={t("admin.editor.archive.redirect")}
          hint={t("admin.editor.archive.redirect.hint")}
          error={problem ?? undefined}
          announceError
        >
          {(control) => (
            <Input
              {...control}
              ltr
              autoComplete="off"
              placeholder="/blog/..."
              value={redirect}
              onChange={(event) => {
                setRedirect(event.target.value);
              }}
            />
          )}
        </Field>
      ) : null}
      <ErrorLine message={error} />
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="danger" loading={busy}>
          {t("admin.editor.action.archive")}
        </Button>
      </div>
    </form>
  );
}

/** Archive: 410 Gone, or a 301 to the page that replaces this one. Fresh-auth is handled by `runAction`. */
export function ArchiveDialog({ open, ...props }: ArchiveDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title={t("admin.editor.archive.title")}
    >
      {open ? <ArchiveForm {...props} /> : null}
    </Dialog>
  );
}
