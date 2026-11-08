"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { formatMoney } from "@wasfa/shared/money";
import {
  adminPromptPreviewSchema,
  adminPromptViewSchema,
  adminPromptsResponseSchema,
  type AdminPromptPreview,
  type AdminPromptView,
  type AdminPromptsResponse,
} from "@wasfa/shared/schemas/growth";
import { Button, Checkbox, Dialog, Field, Input, Select, Textarea, useToast } from "@wasfa/ui";
import { MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { ApiRequestError, errorReason } from "../../lib/api-error";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";
import { Notice } from "../notice";

import { ResourceBoundary } from "./resource-boundary";

import type { PromptEntry } from "@wasfa/shared/growth-prompts";

type Locale = "ar" | "en";
type CopyField = "title" | "body" | "cta" | "secondary" | "close";
const COPY_FIELDS: readonly CopyField[] = ["title", "body", "cta", "secondary", "close"];

interface Draft {
  enabled: boolean;
  form: PromptEntry["form"];
  targetPlan: string;
  ctaHref: string;
  secondaryHref: string;
  cooldown: string;
  copy: Record<Locale, Record<CopyField, string>>;
}

const kindLabel = (key: string) => t(`admin.prompts.kind.${key}` as MessageKey);
const formLabel = (form: string) => t(`admin.prompts.form.${form}` as MessageKey);

function toDraft(entry: PromptEntry): Draft {
  const side = (locale: Locale) => ({
    title: entry.copy[locale].title,
    body: entry.copy[locale].body,
    cta: entry.copy[locale].cta,
    secondary: entry.copy[locale].secondary ?? "",
    close: entry.copy[locale].close,
  });
  return {
    enabled: entry.enabled,
    form: entry.form,
    targetPlan: entry.targetPlan ?? "",
    ctaHref: entry.cta.href ?? "",
    secondaryHref: entry.secondaryHref ?? "",
    cooldown: entry.cooldownDays === null ? "" : String(entry.cooldownDays),
    copy: { ar: side("ar"), en: side("en") },
  };
}

/** The draft as the entry the API stores (empty optional fields are left out). */
function toEntry(draft: Draft): PromptEntry {
  const side = (locale: Locale): PromptEntry["copy"][Locale] => {
    const copy = draft.copy[locale];
    return {
      title: copy.title.trim(),
      body: copy.body.trim(),
      cta: copy.cta.trim(),
      ...(copy.secondary.trim() !== "" ? { secondary: copy.secondary.trim() } : {}),
      close: copy.close.trim(),
    };
  };
  const cooldown = draft.cooldown.trim();
  return {
    enabled: draft.enabled,
    form: draft.form,
    copy: { ar: side("ar"), en: side("en") },
    targetPlan: draft.targetPlan === "" ? null : draft.targetPlan,
    cta: { href: draft.ctaHref.trim() === "" ? null : draft.ctaHref.trim() },
    ...(draft.secondaryHref.trim() !== "" ? { secondaryHref: draft.secondaryHref.trim() } : {}),
    cooldownDays: cooldown === "" || !/^\d{1,3}$/.test(cooldown) ? null : Number(cooldown),
  };
}

function PreviewCard({ preview, locale }: { preview: AdminPromptPreview; locale: Locale }) {
  const copy = preview.content[locale];
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary-soft p-4"
      dir={locale === "ar" ? "rtl" : "ltr"}
      lang={locale}
      data-testid={`prompt-preview-${locale}`}
    >
      {copy.title !== "" ? <strong>{copy.title}</strong> : null}
      <p>{copy.body}</p>
      <div className="flex flex-wrap gap-2 text-sm font-semibold text-primary">
        <span>{copy.cta}</span>
        {copy.secondary !== undefined ? <span>{copy.secondary}</span> : null}
        <span className="text-text-muted">{copy.close}</span>
      </div>
    </div>
  );
}

function Editor({
  canWrite,
  item,
  plans,
  placeholders,
  bannedClaims,
  onClose,
  onSaved,
}: {
  canWrite: boolean;
  item: AdminPromptView;
  plans: AdminPromptsResponse["plans"];
  placeholders: string[];
  bannedClaims: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(item.entry));
  const [preview, setPreview] = useState<AdminPromptPreview | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const taste = item.key === "analysis_taste";

  // The preview follows the draft after a short pause, always with the real plan values.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api(`/admin/growth/prompts/${item.key}/preview`, {
        method: "POST",
        body: toEntry(draft),
        schema: adminPromptPreviewSchema,
        signal: controller.signal,
      }).then(setPreview, () => {
        // A draft that is not valid yet simply keeps the last preview.
      });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft, item.key]);

  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setCopy = (locale: Locale, field: CopyField, value: string) => {
    setDraft((current) => ({
      ...current,
      copy: { ...current.copy, [locale]: { ...current.copy[locale], [field]: value } },
    }));
  };

  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await api(`/admin/growth/prompts/${item.key}`, {
        method: "PUT",
        body: toEntry(draft),
        schema: adminPromptViewSchema,
      });
      toast({ tone: "success", title: t("admin.prompts.saved") });
      onSaved();
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  };

  const reason = errorReason(failure);
  const term =
    failure instanceof ApiRequestError && typeof failure.details?.["term"] === "string"
      ? failure.details["term"]
      : "";

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("admin.prompts.editorTitle", { name: kindLabel(item.key) })}
      className="sm:max-w-3xl"
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Checkbox
          name="prompt-enabled"
          label={t("admin.prompts.enabled")}
          checked={draft.enabled}
          onChange={(event) => {
            set({ enabled: event.target.checked });
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("admin.prompts.form.label")}
            hint={item.modalAllowed ? undefined : t("admin.prompts.form.modalCalmOnly")}
          >
            {(control) => (
              <Select
                {...control}
                name="prompt-form"
                value={draft.form}
                onChange={(event) => {
                  set({ form: event.target.value as Draft["form"] });
                }}
              >
                {(["inline", "banner", "modal"] as const).map((form) => (
                  <option key={form} value={form} disabled={form === "modal" && !item.modalAllowed}>
                    {formLabel(form)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.prompts.targetPlan")} hint={t("admin.prompts.targetPlan.hint")}>
            {(control) => (
              <Select
                {...control}
                name="prompt-target-plan"
                value={draft.targetPlan}
                onChange={(event) => {
                  set({ targetPlan: event.target.value });
                }}
              >
                <option value="">{t("admin.prompts.targetPlan.recommended")}</option>
                {plans.map((plan) => (
                  <option key={plan.key} value={plan.key}>
                    {plan.name.ar}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("admin.prompts.ctaHref")}>
            {(control) => (
              <Input
                {...control}
                name="prompt-cta-href"
                ltr
                disabled={taste}
                value={draft.ctaHref}
                onChange={(event) => {
                  set({ ctaHref: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={t("admin.prompts.secondaryHref")}>
            {(control) => (
              <Input
                {...control}
                name="prompt-secondary-href"
                ltr
                value={draft.secondaryHref}
                onChange={(event) => {
                  set({ secondaryHref: event.target.value });
                }}
              />
            )}
          </Field>
          <Field label={t("admin.prompts.cooldown")} hint={t("admin.prompts.cooldown.hint")}>
            {(control) => (
              <Input
                {...control}
                name="prompt-cooldown"
                inputMode="numeric"
                ltr
                value={draft.cooldown}
                onChange={(event) => {
                  set({ cooldown: event.target.value });
                }}
              />
            )}
          </Field>
        </div>
        {(["ar", "en"] as const).map((locale) => (
          <fieldset key={locale} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <legend className="px-2 font-semibold">{t(`admin.prompts.copy.${locale}` as MessageKey)}</legend>
            {COPY_FIELDS.map((field) => (
              <Field key={field} label={t(`admin.prompts.copy.${field}` as MessageKey)}>
                {(control) =>
                  field === "body" ? (
                    <Textarea
                      {...control}
                      name={`prompt-${locale}-${field}`}
                      dir={locale === "ar" ? "rtl" : "ltr"}
                      value={draft.copy[locale][field]}
                      onChange={(event) => {
                        setCopy(locale, field, event.target.value);
                      }}
                    />
                  ) : (
                    <Input
                      {...control}
                      name={`prompt-${locale}-${field}`}
                      dir={locale === "ar" ? "rtl" : "ltr"}
                      value={draft.copy[locale][field]}
                      onChange={(event) => {
                        setCopy(locale, field, event.target.value);
                      }}
                    />
                  )
                }
              </Field>
            ))}
          </fieldset>
        ))}
        <p className="text-sm text-text-muted">
          {t("admin.prompts.placeholders", { list: placeholders.map((name) => `{${name}}`).join(" ") })}
        </p>
        <p className="text-sm text-text-muted">
          {t("admin.prompts.bannedTerms", { list: bannedClaims.join("، ") })}
        </p>
        <section aria-labelledby="prompt-preview-title" className="flex flex-col gap-3">
          <h3 id="prompt-preview-title" className="font-semibold">
            {t("admin.prompts.preview")}
          </h3>
          {preview === null ? null : preview.plan === null ? (
            <Notice tone="warning">{t("admin.prompts.preview.noPlan")}</Notice>
          ) : (
            <p className="text-sm text-text-muted">
              {t("admin.prompts.preview.plan", {
                plan: preview.plan.name.ar,
                analyses: formatNumber(preview.plan.analyses),
                price: formatMoney(preview.plan.priceMinor, preview.plan.currency, "ar"),
              })}
            </p>
          )}
          {preview === null ? null : (
            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewCard preview={preview} locale="ar" />
              <PreviewCard preview={preview} locale="en" />
            </div>
          )}
        </section>
        {reason === "banned_claim" ? (
          <p role="alert" className="text-base font-semibold text-danger">
            {t("admin.prompts.error.banned_claim", { term })}
          </p>
        ) : reason === "modal_not_allowed" ? (
          <p role="alert" className="text-base font-semibold text-danger">
            {t("admin.prompts.error.modal_not_allowed")}
          </p>
        ) : failure ? (
          <ErrorNotice error={failure} supportHref={null} />
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("admin.prompts.cancel")}
          </Button>
          {canWrite ? (
            <Button type="submit" name="save-prompt" loading={saving}>
              {t("admin.prompts.save")}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

function Row({
  item,
  canWrite,
  onEdit,
  onToggle,
}: {
  item: AdminPromptView;
  canWrite: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <tr className="border-t border-border/60" data-testid={`prompt-row-${item.key}`}>
      <th scope="row" className="p-2 text-start font-semibold">
        {kindLabel(item.key)}
        <bdi dir="ltr" className="block text-sm font-normal text-text-muted">
          {item.key}
        </bdi>
      </th>
      <td className="p-2">{item.entry.enabled ? t("admin.prompts.state.on") : t("admin.prompts.state.off")}</td>
      <td className="p-2">{formLabel(item.entry.form)}</td>
      <td className="p-2 tabular-nums">{formatNumber(item.counts.shown)}</td>
      <td className="p-2 tabular-nums">{formatNumber(item.counts.clicked)}</td>
      <td className="p-2 tabular-nums">{formatNumber(item.counts.dismissed)}</td>
      <td className="p-2">
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onEdit}>
            {canWrite ? t("admin.prompts.edit") : t("admin.prompts.preview")}
          </Button>
          {canWrite ? (
            <Button variant="ghost" onClick={onToggle}>
              {item.entry.enabled ? t("admin.prompts.disable") : t("admin.prompts.enable")}
            </Button>
          ) : null}
        </span>
      </td>
    </tr>
  );
}

/**
 * `/admin/growth/prompts`: every upgrade prompt with its form, state and 30-day counts; an editor for
 * the form, Arabic and English copy, target plan, destinations and cooldown, with a live preview filled
 * from the real plans; an enable toggle. Saves refuse banned claims and modals on busy moments.
 */
export function GrowthPromptsView({ canWrite }: { canWrite: boolean }) {
  const list = useResource("/admin/growth/prompts", adminPromptsResponseSchema);
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

  const toggle = async (item: AdminPromptView) => {
    setFailure(null);
    try {
      await api(`/admin/growth/prompts/${item.key}`, {
        method: "PUT",
        body: { ...item.entry, enabled: !item.entry.enabled },
        schema: adminPromptViewSchema,
      });
      toast({ tone: "success", title: t("admin.prompts.saved") });
      list.reload();
    } catch (error) {
      setFailure(error);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ResourceBoundary resource={list}>
        {(data) => (
          <>
            {data.killSwitch ? (
              <Notice tone="warning">{t("admin.prompts.killSwitch")}</Notice>
            ) : data.enabled ? (
              <Notice tone="info">{t("admin.prompts.systemOn")}</Notice>
            ) : (
              <Notice tone="warning">{t("admin.prompts.systemOff")}</Notice>
            )}
            {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-start text-sm">
                <caption className="sr-only">
                  <MessageSquareText aria-hidden className="inline size-4" /> {t("admin.nav.growthPrompts")} ·{" "}
                  {t("admin.prompts.last30")}
                </caption>
                <thead className="text-text-muted">
                  <tr>
                    {(["key", "state", "form", "shown", "clicked", "dismissed"] as const).map((column) => (
                      <th key={column} scope="col" className="p-2 text-start">
                        {t(`admin.prompts.col.${column}` as MessageKey)}
                      </th>
                    ))}
                    <th scope="col" className="p-2 text-start">
                      <span className="sr-only">{t("admin.prompts.edit")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <Row
                      key={item.key}
                      item={item}
                      canWrite={canWrite}
                      onEdit={() => {
                        setEditing(item.key);
                      }}
                      onToggle={() => {
                        void toggle(item);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-text-muted">{t("admin.prompts.last30")}</p>
            {data.items
              .filter((item) => item.key === editing)
              .map((item) => (
                <Editor
                  key={item.key}
                  canWrite={canWrite}
                  item={item}
                  plans={data.plans}
                  placeholders={data.placeholders}
                  bannedClaims={data.bannedClaims}
                  onClose={() => {
                    setEditing(null);
                  }}
                  onSaved={list.reload}
                />
              ))}
          </>
        )}
      </ResourceBoundary>
    </div>
  );
}
