"use client";

import { TAX_APPLIES_TO, TAX_MODES } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { fromMinor, toMinor } from "@wasfa/shared/money";
import { adminTaxRuleSchema } from "@wasfa/shared/schemas/admin-billing-console";
import { Badge, Button, Checkbox, Field, Input, Select, useToast } from "@wasfa/ui";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";

import { taxRuleListSchema, type TaxRuleView } from "../../lib/admin-billing-schemas";
import { percentText } from "../../lib/admin-revenue";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";

import { ReasonDialog } from "./reason-dialog";
import { ResourceBoundary } from "./resource-boundary";

interface RuleForm {
  country: string;
  nameAr: string;
  nameEn: string;
  rate: string;
  mode: TaxRuleView["mode"];
  appliesTo: TaxRuleView["appliesTo"];
  active: boolean;
  replaceActive: boolean;
}

const emptyRule = (): RuleForm => ({
  country: "",
  nameAr: "",
  nameEn: "",
  rate: "14",
  mode: "added",
  appliesTo: "all",
  active: false,
  replaceActive: false,
});

function formFor(rule: TaxRuleView | null): RuleForm {
  return rule
    ? {
        country: rule.country ?? "",
        nameAr: rule.nameAr,
        nameEn: rule.nameEn,
        rate: fromMinor(rule.rateBps, "EGP"),
        mode: rule.mode,
        appliesTo: rule.appliesTo,
        active: rule.active,
        replaceActive: false,
      }
    : emptyRule();
}

/** The rule as an API body without the reason, or null when a field is not valid. */
export function ruleBody(form: RuleForm): Record<string, unknown> | null {
  let rateBps: number;
  try {
    rateBps = toMinor(form.rate.trim(), "EGP");
  } catch {
    return null;
  }
  const fields = {
    country: form.country.trim() === "" ? null : form.country.trim().toUpperCase(),
    nameAr: form.nameAr.trim(),
    nameEn: form.nameEn.trim(),
    rateBps,
    mode: form.mode,
    appliesTo: form.appliesTo,
    active: form.active,
    replaceActive: form.replaceActive,
  };
  // The reason is asked for by the dialog; a placeholder lets the shared schema check the rest.
  return adminTaxRuleSchema.safeParse({ ...fields, reason: "validation" }).success ? fields : null;
}

function RuleDialog({
  rule,
  onClose,
  onSaved,
}: {
  rule: TaxRuleView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<RuleForm>(() => formFor(rule));
  const body = ruleBody(form);
  const patch = (change: Partial<RuleForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const text = (
    name: "country" | "nameAr" | "nameEn" | "rate",
    label: string,
    ltr = false,
    hint?: string,
  ) => (
    <Field label={label} hint={hint}>
      {(control) => (
        <Input
          {...control}
          name={name}
          ltr={ltr}
          value={form[name]}
          onChange={(event) => {
            patch({ [name]: event.target.value } as Partial<RuleForm>);
          }}
        />
      )}
    </Field>
  );
  return (
    <ReasonDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={rule ? t("admin.pricing.tax.editTitle") : t("admin.pricing.tax.createTitle")}
      effect={t("admin.pricing.tax.effect")}
      confirmLabel={t("admin.pricing.tax.save")}
      canSubmit={body !== null}
      onConfirm={async (reason) => {
        if (body === null) return;
        await api(rule ? `/admin/billing/tax-rules/${rule.id}` : "/admin/billing/tax-rules", {
          method: rule ? "PATCH" : "POST",
          body: { ...body, reason },
        });
        toast({ tone: "success", title: t("admin.pricing.tax.saved") });
        onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("country", t("admin.pricing.tax.country"), true, t("admin.pricing.tax.countryHint"))}
        {text("rate", t("admin.pricing.tax.rate"), true, t("admin.pricing.tax.rateHint"))}
        {text("nameAr", t("admin.pricing.tax.nameAr"))}
        {text("nameEn", t("admin.pricing.tax.nameEn"), true)}
        <Field label={t("admin.pricing.tax.mode")}>
          {(control) => (
            <Select
              {...control}
              name="mode"
              value={form.mode}
              onChange={(event) => {
                const mode = TAX_MODES.find((value) => value === event.target.value);
                if (mode) patch({ mode });
              }}
            >
              {TAX_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`admin.pricing.tax.mode.${mode}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("admin.pricing.tax.appliesTo")}>
          {(control) => (
            <Select
              {...control}
              name="appliesTo"
              value={form.appliesTo}
              onChange={(event) => {
                const appliesTo = TAX_APPLIES_TO.find((value) => value === event.target.value);
                if (appliesTo) patch({ appliesTo });
              }}
            >
              {TAX_APPLIES_TO.map((value) => (
                <option key={value} value={value}>
                  {t(`admin.pricing.tax.appliesTo.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Checkbox
        label={t("admin.pricing.tax.active")}
        checked={form.active}
        onChange={(event) => {
          patch({ active: event.target.checked });
        }}
      />
      {form.active ? (
        <Checkbox
          label={t("admin.pricing.tax.replace")}
          checked={form.replaceActive}
          onChange={(event) => {
            patch({ replaceActive: event.target.checked });
          }}
        />
      ) : null}
    </ReasonDialog>
  );
}

/** Tax rules by country: rate, inclusive or added, which orders it applies to. */
export function TaxRulesPanel({ canWrite }: { canWrite: boolean }) {
  const resource = useResource("/admin/billing/tax-rules", taxRuleListSchema);
  const [editing, setEditing] = useState<{ rule: TaxRuleView | null } | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {canWrite ? (
        <Button
          variant="secondary"
          name="new-tax-rule"
          className="self-start"
          onClick={() => {
            setEditing({ rule: null });
          }}
        >
          <Plus aria-hidden className="size-5" />
          {t("admin.pricing.tax.new")}
        </Button>
      ) : null}
      <ResourceBoundary resource={resource}>
        {(rules) =>
          rules.length === 0 ? (
            <p className="text-base text-text-muted">{t("admin.pricing.tax.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{rule.nameAr}</span>
                    <span className="text-sm text-text-muted">
                      {" · "}
                      {rule.country ?? t("admin.pricing.tax.default")}
                      {" · "}
                      {percentText(rule.rateBps)}
                      {" · "}
                      {t(`admin.pricing.tax.mode.${rule.mode}`)}
                    </span>
                  </span>
                  <Badge tone={rule.active ? "success" : "neutral"}>
                    {rule.active ? t("admin.pricing.tax.on") : t("admin.pricing.tax.off")}
                  </Badge>
                  {canWrite ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing({ rule });
                      }}
                    >
                      <Pencil aria-hidden className="size-5" />
                      <span className="sr-only">
                        {t("admin.pricing.tax.edit", { name: rule.nameAr })}
                      </span>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </ResourceBoundary>
      {editing ? (
        <RuleDialog
          key={editing.rule?.id ?? "new"}
          rule={editing.rule}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={resource.reload}
        />
      ) : null}
    </div>
  );
}
