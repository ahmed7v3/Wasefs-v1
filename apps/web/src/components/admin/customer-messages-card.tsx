"use client";

import { t } from "@wasfa/shared/i18n";
import { adminWhatsappStatusSchema, type AdminWhatsappStatus } from "@wasfa/shared/schemas/admin";
import { Badge, Button, Card, CardTitle, Checkbox, Field, Input, useToast } from "@wasfa/ui";
import { useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ConfirmDialog } from "./confirm-dialog";

type Settings = AdminWhatsappStatus["customerMessages"];
type Draft = Record<"dailyCap" | "perUserDailyCap" | "startHour" | "endHour", string>;

const toDraft = (value: Settings): Draft => ({
  dailyCap: String(value.dailyCap),
  perUserDailyCap: String(value.perUserDailyCap),
  startHour: String(value.startHour),
  endHour: String(value.endHour),
});

/** Whole numbers in range, else the field's error key. */
function validate(draft: Draft): Partial<Record<keyof Draft, string>> {
  const errors: Partial<Record<keyof Draft, string>> = {};
  const check = (key: keyof Draft, min: number, max: number) => {
    const value = Number(draft[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors[key] = t("admin.whatsapp.customer.range", { min: String(min), max: String(max) });
    }
  };
  check("dailyCap", 1, 2_000);
  check("perUserDailyCap", 1, 10);
  check("startHour", 0, 23);
  check("endHour", 1, 24);
  if (!errors.startHour && !errors.endHour && Number(draft.endHour) <= Number(draft.startHour)) {
    errors.endHour = t("admin.whatsapp.customer.hoursOrder");
  }
  return errors;
}

/**
 * Customer notifications from the linked number (owner decision, 2026-10-17): on/off, the caps
 * and the sending hours. Turning it on is confirmed, because the number can be banned.
 */
export function CustomerMessagesCard({
  value,
  canWrite,
  onChanged,
}: {
  value: Settings;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [confirmingOn, setConfirmingOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const save = async (enabled: boolean, next: Draft): Promise<void> => {
    await reauth.run(() =>
      api("/admin/whatsapp/customer-messages", {
        method: "PUT",
        body: {
          enabled,
          dailyCap: Number(next.dailyCap),
          perUserDailyCap: Number(next.perUserDailyCap),
          startHour: Number(next.startHour),
          endHour: Number(next.endHour),
        },
        schema: adminWhatsappStatusSchema,
      }),
    );
    toast({ tone: "success", title: t("admin.whatsapp.customer.saved") });
    onChanged();
  };

  const run = async (enabled: boolean): Promise<void> => {
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      await save(enabled, draft);
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(value.enabled);
  };

  const field = (key: keyof Draft, label: string) => (
    <Field label={label} required error={errors[key]} announceError>
      {(control) => (
        <Input
          {...control}
          name={key}
          inputMode="numeric"
          dir="ltr"
          value={draft[key]}
          disabled={!canWrite || busy}
          onChange={(event) => {
            setDraft((current) => ({ ...current, [key]: event.target.value }));
          }}
        />
      )}
    </Field>
  );

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("admin.whatsapp.customer.title")}</CardTitle>
        <Badge tone={value.enabled ? "success" : "neutral"}>
          {t("admin.whatsapp.customer.sentToday", {
            sent: String(value.sentToday),
            cap: String(value.dailyCap),
          })}
        </Badge>
      </div>
      <p className="text-sm text-text-muted">{t("admin.whatsapp.customer.lead")}</p>
      <Checkbox
        role="switch"
        name="customer-messages"
        label={t("admin.whatsapp.customer.label")}
        checked={value.enabled}
        disabled={!canWrite || busy}
        onChange={(event) => {
          if (event.target.checked) setConfirmingOn(true);
          else void run(false);
        }}
      />
      <Notice tone="warning">{t("admin.whatsapp.customer.risk")}</Notice>
      <form
        aria-label={t("admin.whatsapp.customer.title")}
        onSubmit={submit}
        noValidate
        className="grid gap-4 sm:grid-cols-2"
      >
        {field("dailyCap", t("admin.whatsapp.customer.dailyCap"))}
        {field("perUserDailyCap", t("admin.whatsapp.customer.perUserDailyCap"))}
        {field("startHour", t("admin.whatsapp.customer.startHour"))}
        {field("endHour", t("admin.whatsapp.customer.endHour"))}
        <p className="text-sm text-text-muted sm:col-span-2">
          {t("admin.whatsapp.customer.hoursHint", { timezone: value.timezone })}
        </p>
        {failure ? (
          <div className="sm:col-span-2">
            <ErrorNotice error={failure} supportHref={null} />
          </div>
        ) : null}
        {canWrite ? (
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" name="save-customer-messages" loading={busy}>
              {t("admin.whatsapp.customer.save")}
            </Button>
          </div>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmingOn}
        onOpenChange={setConfirmingOn}
        title={t("admin.whatsapp.customer.onTitle")}
        description={t("admin.whatsapp.customer.onBody")}
        confirmLabel={t("admin.whatsapp.customer.onConfirm")}
        tone="danger"
        onConfirm={() => run(true)}
      />
    </Card>
  );
}
