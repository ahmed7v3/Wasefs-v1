"use client";

import {
  APP_PLATFORMS,
  appWaitlistSchema,
  type AppPlatform,
} from "@wasfa/shared/schemas/public-site";
import { Button, Checkbox, Field, Input, Select } from "@wasfa/ui";
import { CircleCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { api } from "../../lib/api-client";
import { ApiRequestError } from "../../lib/api-error";
import { useApiForm } from "../../lib/forms";
import { ErrorNotice } from "../error-notice";

import type { landing } from "../../content/landing";
import type { Locale } from "../../lib/locale";

export type AppWaitlistCopy = (typeof landing)["apps"]["waitlist"];

/**
 * The shared schema, except that the consent starts as an unticked `false` the visitor can see: the
 * server's `z.literal(true)` would reject the initial state before the form could even be shown.
 */
const formSchema = appWaitlistSchema.extend({
  marketingConsent: z.boolean().refine((value) => value),
});

/** "Notify me at launch": email, platform and an explicit consent, posted to `POST /public/app-waitlist`. */
export function AppWaitlistForm({ locale, copy }: { locale: Locale; copy: AppWaitlistCopy }) {
  const [done, setDone] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const form = useApiForm({
    schema: formSchema,
    initial: { email: "", platform: "both" as AppPlatform, marketingConsent: false, locale },
    submit: async (values) => {
      try {
        await api("/public/app-waitlist", { method: "POST", body: values });
      } catch (error) {
        // The API answers 404 while the waitlist is switched off (a cached page can still show the form).
        if (error instanceof ApiRequestError && error.status === 404) {
          setDisabled(true);
          return;
        }
        throw error;
      }
      setDone(true);
    },
  });

  if (done) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl bg-success-soft p-4">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-success" />
        <div>
          <p className="text-lg font-bold text-text">{copy.successTitle}</p>
          <p className="mt-1 text-base text-text-muted">{copy.successBody}</p>
        </div>
      </div>
    );
  }
  if (disabled) {
    return (
      <p role="status" className="rounded-xl bg-neutral-100 p-4 text-base text-text-muted">
        {copy.disabled}
      </p>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      aria-labelledby="waitlist-title"
      className="flex flex-col gap-4"
    >
      <div>
        <h3 id="waitlist-title" className="text-xl font-bold text-text">
          {copy.title}
        </h3>
        <p className="mt-1 text-base text-text-muted">{copy.lead}</p>
      </div>
      {/* No `required` on the Field: its "(required)" marker is Arabic only, and this form also renders in English. */}
      <Field label={copy.email} error={form.errors["email"]} announceError={form.submitCount > 0}>
        {(control) => (
          <Input
            {...control}
            {...form.bind("email")}
            type="email"
            aria-required="true"
            ltr
            inputMode="email"
            autoComplete="email"
          />
        )}
      </Field>
      <Field label={copy.platform} error={form.errors["platform"]}>
        {(control) => (
          <Select {...control} {...form.bind("platform")}>
            {APP_PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {copy.platforms[platform]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div>
        <Checkbox
          {...form.bindCheckbox("marketingConsent")}
          required
          invalid={Boolean(form.errors["marketingConsent"])}
          label={copy.consent}
        />
        {form.errors["marketingConsent"] ? (
          <p role="alert" className="mt-1 text-sm text-danger">
            {copy.consentRequired}
          </p>
        ) : null}
      </div>
      {form.formError ? <ErrorNotice error={form.formError} supportHref={null} /> : null}
      <Button type="submit" size="lg" loading={form.submitting}>
        {copy.submit}
      </Button>
    </form>
  );
}
