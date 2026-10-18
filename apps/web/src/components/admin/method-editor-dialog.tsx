"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, Checkbox, Field, Input, Textarea, moneyText, useToast } from "@wasfa/ui";
import { useRef, useState } from "react";

import { type MethodView } from "../../lib/admin-billing-schemas";
import { api } from "../../lib/api-client";
import {
  PLACEHOLDERS,
  formFromMethod,
  hasUnknownPlaceholder,
  methodPatch,
  previewInstructions,
  type MethodForm,
} from "../../lib/method-form";

import { ReasonDialog } from "./reason-dialog";

function InstructionsEditor({
  name,
  label,
  value,
  onChange,
  preview,
  ltr,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  preview: string;
  ltr: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (token: string) => {
    const area = ref.current;
    const start = area?.selectionStart ?? value.length;
    const end = area?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
    area?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      <Field
        label={label}
        error={hasUnknownPlaceholder(value) ? t("admin.pricing.method.badPlaceholder") : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            ref={ref}
            name={name}
            dir={ltr ? "ltr" : undefined}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-muted">{t("admin.pricing.method.chips")}</span>
        {PLACEHOLDERS.map((token) => (
          <Button
            key={token}
            type="button"
            variant="secondary"
            onClick={() => {
              insert(token);
            }}
          >
            <bdi dir="ltr">{token}</bdi>
          </Button>
        ))}
      </div>
      <Card elevation="flat" padding="compact" aria-label={t("admin.pricing.method.livePreview")}>
        <p className="text-sm text-text-muted">{t("admin.pricing.method.livePreview")}</p>
        <p className="whitespace-pre-line text-base" dir={ltr ? "ltr" : undefined}>
          {preview || "—"}
        </p>
      </Card>
    </div>
  );
}

export interface MethodEditorDialogProps {
  method: MethodView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * Names, instructions (with `{amount}` `{reference}` `{account}` chips and a live preview of what
 * the customer reads), fees, limits, currencies, countries, proof and SLA. Saving needs a reason and
 * fresh auth; the account number has its own protected flow.
 */
export function MethodEditorDialog({
  method,
  open,
  onOpenChange,
  onSaved,
}: MethodEditorDialogProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<MethodForm>(() => formFromMethod(method));
  const patch = methodPatch(method, form);
  const change = (next: Partial<MethodForm>) => {
    setForm((current) => ({ ...current, ...next }));
  };
  const currency = method.currencies[0] ?? "EGP";
  const sample = {
    amount: moneyText(9_900, currency),
    reference: "WSP-2026-000123",
    account: method.accountDisplay ?? t("admin.pricing.method.sampleAccount"),
  };
  const text = (
    name: keyof MethodForm,
    label: string,
    options: { ltr?: boolean; hint?: string } = {},
  ) => (
    <Field
      label={label}
      hint={options.hint}
      error={
        !patch.ok && patch.errors.some((path) => fieldNames[name]?.includes(path))
          ? t("admin.pricing.promo.fieldInvalid")
          : undefined
      }
    >
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={options.ltr}
          value={String(form[name])}
          onChange={(event) => {
            change({ [name]: event.target.value } as Partial<MethodForm>);
          }}
        />
      )}
    </Field>
  );

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("admin.pricing.method.editTitle", { name: method.nameAr })}
      effect={t("admin.pricing.method.effect")}
      confirmLabel={t("admin.pricing.method.save")}
      canSubmit={patch.ok && patch.changed.length > 0}
      onConfirm={async (reason) => {
        if (!patch.ok) return;
        await api(`/admin/billing/methods/${method.key}`, {
          method: "PATCH",
          body: { ...patch.body, reason },
        });
        toast({ tone: "success", title: t("admin.pricing.method.saved", { name: form.nameAr }) });
        onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("nameAr", t("admin.pricing.method.nameAr"))}
        {text("nameEn", t("admin.pricing.method.nameEn"), { ltr: true })}
        {text("feePercent", t("admin.pricing.method.feePercent"), {
          ltr: true,
          hint: t("admin.pricing.method.feePercentHint"),
        })}
        {text("feeFixed", t("admin.pricing.method.feeFixed", { currency }), { ltr: true })}
        {text("minAmount", t("admin.pricing.method.min", { currency }), { ltr: true })}
        {text("maxAmount", t("admin.pricing.method.max", { currency }), { ltr: true })}
        {text("currencies", t("admin.pricing.method.currencies"), {
          ltr: true,
          hint: t("admin.pricing.method.listHint"),
        })}
        {text("countries", t("admin.pricing.method.countries"), {
          ltr: true,
          hint: t("admin.pricing.method.countriesHint"),
        })}
        {text("reviewSlaMinutes", t("admin.pricing.method.sla"), {
          ltr: true,
          hint: t("admin.pricing.method.slaHint"),
        })}
        {text("sort", t("admin.pricing.method.sort"), { ltr: true })}
      </div>
      <div className="flex flex-wrap gap-4">
        <Checkbox
          label={t("admin.pricing.method.requiresProof")}
          checked={form.requiresProof}
          onChange={(event) => {
            change({ requiresProof: event.target.checked });
          }}
        />
        <Checkbox
          label={t("admin.pricing.method.enabled")}
          checked={form.enabled}
          onChange={(event) => {
            change({ enabled: event.target.checked });
          }}
        />
      </div>
      <InstructionsEditor
        name="instructionsAr"
        label={t("admin.pricing.method.instructionsAr")}
        value={form.instructionsAr}
        onChange={(value) => {
          change({ instructionsAr: value });
        }}
        preview={previewInstructions(form.instructionsAr, sample)}
        ltr={false}
      />
      <InstructionsEditor
        name="instructionsEn"
        label={t("admin.pricing.method.instructionsEn")}
        value={form.instructionsEn}
        onChange={(value) => {
          change({ instructionsEn: value });
        }}
        preview={previewInstructions(form.instructionsEn, sample)}
        ltr
      />
    </ReasonDialog>
  );
}

/** Which API field names belong to which form input, to mark the right input invalid. */
const fieldNames: Partial<Record<keyof MethodForm, readonly string[]>> = {
  feePercent: ["feeBps"],
  feeFixed: ["feeFixedMinor"],
  minAmount: ["minAmountMinor"],
  maxAmount: ["maxAmountMinor"],
  currencies: ["currencies"],
  countries: ["countries"],
  reviewSlaMinutes: ["reviewSlaMinutes"],
  sort: ["sort"],
  nameAr: ["nameAr"],
  nameEn: ["nameEn"],
};
