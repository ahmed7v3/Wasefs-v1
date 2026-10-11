"use client";

import { LOCALES, t, type Locale } from "@wasfa/shared/i18n";
import { meResponseSchema, updateMeSchema } from "@wasfa/shared/schemas/user";
import { Badge, Button, Field, Input, Select, useToast } from "@wasfa/ui";
import { useRouter } from "next/navigation";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { label } from "../../lib/labels";
import { ErrorNotice } from "../error-notice";

export interface ProfileFormProps {
  name: string;
  locale: Locale;
  /** `null` for phone-only accounts: the read-only email block is then not shown at all. */
  email: string | null;
  emailVerified: boolean;
}

/** Name and language (`PATCH /me`); the email is shown, never edited here. */
export function ProfileForm({ name, locale, email, emailVerified }: ProfileFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const form = useApiForm({
    schema: updateMeSchema,
    initial: { name, locale },
    submit: async (values) => {
      await api("/me", { method: "PATCH", body: values, schema: meResponseSchema });
      toast({ tone: "success", title: t("account.profile.saved") });
      // The top bar shows the name, and it comes from the server.
      router.refresh();
    },
  });

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex max-w-md flex-col gap-5">
      <Field
        label={t("account.profile.name")}
        required
        error={form.errors["name"]}
        announceError={form.submitCount > 0}
      >
        {(control) => <Input {...control} {...form.bind("name")} autoComplete="name" />}
      </Field>

      <Field
        label={t("account.profile.language")}
        hint={t("account.profile.languageHint")}
        error={form.errors["locale"]}
        announceError={form.submitCount > 0}
      >
        {(control) => (
          <Select {...control} {...form.bind("locale")}>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {label("language", code)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {email ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-base font-semibold text-text">{t("account.profile.email")}</p>
          <p className="flex flex-wrap items-center gap-2 text-base text-text">
            <bdi dir="ltr">{email}</bdi>
            <Badge tone={emailVerified ? "success" : "warning"}>
              {emailVerified ? t("common.verified") : t("common.unverified")}
            </Badge>
          </p>
          <p className="text-sm text-text-muted">{t("account.profile.emailHint")}</p>
        </div>
      ) : null}

      {form.formError ? <ErrorNotice error={form.formError} /> : null}
      <div>
        <Button type="submit" size="lg" name="save-profile" loading={form.submitting}>
          {t("account.profile.save")}
        </Button>
      </div>
    </form>
  );
}
