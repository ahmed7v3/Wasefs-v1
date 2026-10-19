"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import {
  CONTACT_MESSAGE_MAX_LENGTH,
  CONTACT_TOPICS,
  contactMessageSchema,
  type ContactTopic,
} from "@wasfa/shared/schemas/contact";
import { Button, Field, Input, Select, Textarea } from "@wasfa/ui";
import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";
import { ErrorSummary } from "../forms/error-summary";
import { PhoneInput } from "../forms/phone-input";
import { Turnstile, useTurnstile } from "../turnstile";

import type { Locale } from "../../lib/locale";

const TOPIC_LABELS = {
  general: "contact.topic.general",
  support: "contact.topic.support",
  billing: "contact.topic.billing",
  partnership: "contact.topic.partnership",
  privacy: "contact.topic.privacy",
  other: "contact.topic.other",
} as const satisfies Record<ContactTopic, MessageKey>;

/** The marker next to a label of a field the visitor may leave empty. */
function OptionalLabel({ children, locale }: { children: string; locale: Locale }) {
  return (
    <>
      {children}{" "}
      <span className="text-sm font-normal text-text-muted">
        {t("ui.optional", undefined, locale)}
      </span>
    </>
  );
}

function ContactFields({
  nonce,
  locale,
  onSent,
}: {
  nonce?: string | undefined;
  locale: Locale;
  onSent: () => void;
}) {
  const ts = useTurnstile();
  const form = useApiForm({
    schema: contactMessageSchema,
    // Optional contact fields start unset: an empty string would fail the email/phone format.
    initial: { name: "", email: undefined, phone: undefined, topic: "general", message: "" },
    submit: async (values) => {
      try {
        await api("/contact", {
          method: "POST",
          body: values,
          turnstileToken: ts.requireToken(),
        });
      } finally {
        // A Turnstile token works once.
        ts.reset();
      }
      onSent();
    },
  });

  const { email, phone, message } = form.values;
  // With neither field filled the schema's "email or phone" rule fires on `email`: say that, not "required".
  const emailError =
    form.errors["email"] && !email && !phone
      ? t("contact.error.needOne", undefined, locale)
      : form.errors["email"];

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-col gap-5"
      aria-label={t("contact.form.label", undefined, locale)}
    >
      <ErrorSummary
        errors={form.errors}
        focusKey={form.submitCount}
        labels={{
          name: t("auth.field.name", undefined, locale),
          email: t("auth.field.email", undefined, locale),
          phone: t("auth.field.phone", undefined, locale),
          topic: t("contact.field.topic", undefined, locale),
          message: t("contact.field.message", undefined, locale),
        }}
      />
      <Field
        label={t("auth.field.name", undefined, locale)}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>
      <p className="text-sm text-text-muted">{t("contact.reach", undefined, locale)}</p>
      <Field
        label={
          <OptionalLabel locale={locale}>{t("auth.field.email", undefined, locale)}</OptionalLabel>
        }
        error={emailError}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Input
            {...control}
            {...form.bind("email")}
            onChange={(event) => {
              form.setValue("email", event.target.value === "" ? undefined : event.target.value);
            }}
            type="email"
            ltr
            inputMode="email"
            autoComplete="email"
          />
        )}
      </Field>
      <Field
        label={
          <OptionalLabel locale={locale}>{t("auth.field.phone", undefined, locale)}</OptionalLabel>
        }
        error={form.errors["phone"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <PhoneInput
            {...control}
            name="phone"
            onChange={(value) => {
              form.setValue("phone", value === "" ? undefined : value);
            }}
            onBlur={() => {
              form.blur("phone");
            }}
          />
        )}
      </Field>
      <Field
        label={t("contact.field.topic", undefined, locale)}
        required
        error={form.errors["topic"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("topic")}>
            {CONTACT_TOPICS.map((topic) => (
              <option key={topic} value={topic}>
                {t(TOPIC_LABELS[topic], undefined, locale)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={t("contact.field.message", undefined, locale)}
        required
        hint={t(
          "contact.counter",
          { count: message.length, max: CONTACT_MESSAGE_MAX_LENGTH },
          locale,
        )}
        error={form.errors["message"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Textarea
            {...control}
            name="message"
            rows={6}
            maxLength={CONTACT_MESSAGE_MAX_LENGTH}
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
      {/* This is the support page: no "contact support" link back to itself. */}
      {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
      <Button type="submit" size="lg" name="submit" loading={form.submitting}>
        {t("contact.submit", undefined, locale)}
      </Button>
    </form>
  );
}

/** A finished flow gets a full confirmation (DESIGN-SYSTEM §7), and keyboard focus moves to it. */
function Sent({ onAgain, locale }: { onAgain: () => void; locale: Locale }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <div role="status" className="flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden="true"
        className="grid size-16 place-items-center rounded-full bg-success-soft text-success"
      >
        <CircleCheck className="size-8" />
      </span>
      <h2
        ref={title}
        tabIndex={-1}
        className="font-heading text-2xl font-semibold text-text focus-visible:outline-none"
      >
        {t("contact.success.title", undefined, locale)}
      </h2>
      <p className="text-lg text-text-muted">{t("contact.success.body", undefined, locale)}</p>
      <Button variant="secondary" onClick={onAgain}>
        {t("contact.success.again", undefined, locale)}
      </Button>
    </div>
  );
}

/** The public contact form: validates with the API's schema, sends it with the Turnstile token, then confirms. */
export function ContactForm({
  nonce,
  locale = "ar",
}: {
  nonce?: string | undefined;
  locale?: Locale;
}) {
  const [sent, setSent] = useState(false);
  // "Send another" remounts the fields, which also clears the previous message.
  return sent ? (
    <Sent
      locale={locale}
      onAgain={() => {
        setSent(false);
      }}
    />
  ) : (
    <ContactFields
      nonce={nonce}
      locale={locale}
      onSent={() => {
        setSent(true);
      }}
    />
  );
}
