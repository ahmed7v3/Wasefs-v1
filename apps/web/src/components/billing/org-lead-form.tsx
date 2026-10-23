"use client";

import { t as translate, type Locale, type MessageKey } from "@wasfa/shared/i18n";
import { institutionLeadSchema } from "@wasfa/shared/schemas/org";
import { Button, Field, Input, Textarea } from "@wasfa/ui";
import { CircleCheck } from "lucide-react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { ErrorSummary } from "../forms/error-summary";
import { PhoneInput } from "../forms/phone-input";
import { Turnstile, useTurnstile } from "../turnstile";

/** The seats box holds text; the API body gets the number. */
const formSchema = institutionLeadSchema.extend({
  seats: z
    .string()
    .trim()
    .regex(/^[1-9]\d{0,5}$/),
});

const MESSAGE_MAX = 2_000;

/** `t` bound to the page language (the dialog is shared by the Arabic and the English page). */
function useT(locale: Locale) {
  return (key: MessageKey, params?: Record<string, string | number>) =>
    translate(key, params, locale);
}

function OptionalLabel({ children, locale }: { children: string; locale: Locale }) {
  const t = useT(locale);
  return (
    <>
      {children} <span className="text-sm font-normal text-text-muted">{t("ui.optional")}</span>
    </>
  );
}

export function LeadForm({
  nonce,
  onSent,
  locale,
}: {
  nonce: string | undefined;
  onSent: () => void;
  locale: Locale;
}) {
  const t = useT(locale);
  const ts = useTurnstile();
  const form = useApiForm({
    schema: formSchema,
    initial: { orgName: "", contactName: "", phone: "", email: "", seats: "", message: "" },
    submit: async (values) => {
      try {
        await api("/institutions/leads", {
          method: "POST",
          body: { ...values, seats: Number(values.seats) },
          turnstileToken: ts.requireToken(),
        });
      } finally {
        // A Turnstile token works once.
        ts.reset();
      }
      onSent();
    },
  });
  const message = form.values.message ?? "";

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-4"
      aria-label={t("billing.lead.title")}
    >
      <ErrorSummary
        errors={form.errors}
        focusKey={form.submitCount}
        labels={{
          orgName: t("billing.lead.orgName"),
          contactName: t("billing.lead.contactName"),
          phone: t("auth.field.phone"),
          email: t("auth.field.email"),
          seats: t("billing.lead.seats"),
          message: t("billing.lead.message"),
        }}
      />
      <Field
        label={t("billing.lead.orgName")}
        required
        error={form.errors["orgName"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("orgName")} autoComplete="organization" />}
      </Field>
      <Field
        label={t("billing.lead.contactName")}
        required
        error={form.errors["contactName"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("contactName")} autoComplete="name" />}
      </Field>
      <Field
        label={t("auth.field.phone")}
        required
        error={form.errors["phone"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PhoneInput
            {...control}
            name="phone"
            onChange={(value) => {
              form.setValue("phone", value);
            }}
            onBlur={() => {
              form.blur("phone");
            }}
          />
        )}
      </Field>
      <Field
        label={t("auth.field.email")}
        required
        error={form.errors["email"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            {...form.bind("email")}
            type="email"
            ltr
            inputMode="email"
            autoComplete="email"
          />
        )}
      </Field>
      <Field
        label={t("billing.lead.seats")}
        hint={t("billing.lead.seatsHint")}
        required
        error={form.errors["seats"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("seats")} inputMode="numeric" ltr />}
      </Field>
      <Field
        label={<OptionalLabel locale={locale}>{t("billing.lead.message")}</OptionalLabel>}
        hint={t("contact.counter", { count: message.length, max: MESSAGE_MAX })}
        error={form.errors["message"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Textarea
            {...control}
            name="message"
            rows={4}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(event) => {
              form.setValue("message", event.target.value);
            }}
            onBlur={() => {
              form.blur("message");
            }}
          />
        )}
      </Field>
      <Turnstile nonce={nonce} {...ts.widgetProps} />
      {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
      <Button type="submit" size="lg" name="submit-lead" loading={form.submitting}>
        {t("billing.lead.submit")}
      </Button>
    </form>
  );
}

export function Sent({ onClose, locale }: { onClose: () => void; locale: Locale }) {
  const t = useT(locale);
  return (
    <div role="status" className="flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-success-soft text-success"
      >
        <CircleCheck className="size-8" />
      </span>
      <p className="font-heading text-xl font-semibold text-text">
        {t("billing.lead.success.title")}
      </p>
      <p className="text-base text-text-muted">{t("billing.lead.success.body")}</p>
      <Button variant="secondary" onClick={onClose}>
        {t("billing.lead.success.close")}
      </Button>
    </div>
  );
}
