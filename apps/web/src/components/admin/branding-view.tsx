"use client";

import { t } from "@wasfa/shared/i18n";
import { adminSettingSchema, adminSettingsResponseSchema } from "@wasfa/shared/schemas/admin";
import { brandingSettingsSchema, settingDefault } from "@wasfa/shared/settings";
import { Button, Card, CardTitle, Checkbox, Field, Input, Skeleton, useToast } from "@wasfa/ui";

import { api } from "../../lib/api-client";
import { useApiForm } from "../../lib/forms";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { BrandAssetCard } from "./brand-asset-card";

import type { Branding } from "../brand-mark";

/** What the names card edits; the image fields are written by the upload routes. */
const namesSchema = brandingSettingsSchema.pick({
  nameAr: true,
  nameEn: true,
  showNameWithLogo: true,
});

function NamesCard({
  branding,
  canWrite,
  onSaved,
}: {
  branding: Branding;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const form = useApiForm({
    schema: namesSchema,
    initial: {
      nameAr: branding.nameAr,
      nameEn: branding.nameEn,
      showNameWithLogo: branding.showNameWithLogo,
    },
    submit: async (values) => {
      // The endpoint replaces the whole `branding` value: send the stored image fields along.
      await reauth.run(() =>
        api("/admin/settings/branding", {
          method: "PUT",
          body: { value: { ...branding, ...values } },
          schema: adminSettingSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.branding.names.saved") });
      onSaved();
    },
  });

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>{t("admin.branding.names.title")}</CardTitle>
        <p className="text-sm text-text-muted">{t("admin.branding.names.description")}</p>
      </div>
      <form
        onSubmit={form.handleSubmit}
        noValidate
        aria-label={t("admin.branding.names.title")}
        className="flex flex-col gap-4"
      >
        <Field
          label={t("admin.settings.field.branding.nameAr")}
          error={form.errors["nameAr"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <Input {...control} {...form.bind("nameAr")} autoComplete="off" disabled={!canWrite} />
          )}
        </Field>
        <Field
          label={t("admin.settings.field.branding.nameEn")}
          error={form.errors["nameEn"]}
          announceError={form.submitCount > 0}
        >
          {(control) => (
            <Input
              {...control}
              {...form.bind("nameEn")}
              ltr
              autoComplete="off"
              disabled={!canWrite}
            />
          )}
        </Field>
        <Checkbox
          label={t("admin.settings.field.branding.showNameWithLogo")}
          disabled={!canWrite}
          {...form.bindCheckbox("showNameWithLogo")}
        />
        {form.formError ? <ErrorNotice error={form.formError} /> : null}
        {canWrite ? (
          <div className="flex justify-end">
            <Button type="submit" name="save" loading={form.submitting}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

export interface BrandingViewProps {
  canWrite: boolean;
}

/** `/admin/branding`: the logo, the favicon and the platform names (the `branding` setting). */
export function BrandingView({ canWrite }: BrandingViewProps) {
  const resource = useResource("/admin/settings", adminSettingsResponseSchema);

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} elevation="flat" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const stored = resource.data.items.find((item) => item.key === "branding");
  // A missing or unreadable row shows the defaults, as the API itself serves them.
  const parsed = brandingSettingsSchema.safeParse(stored?.value);
  const branding = parsed.success ? parsed.data : settingDefault("branding");

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">
        {canWrite ? t("admin.branding.lead") : t("admin.branding.readOnlyNote")}
      </p>
      <BrandAssetCard
        assetKey="logo"
        url={branding.logoUrl}
        canWrite={canWrite}
        onChanged={resource.reload}
      />
      <BrandAssetCard
        assetKey="favicon"
        url={branding.faviconUrl}
        canWrite={canWrite}
        onChanged={resource.reload}
      />
      <NamesCard branding={branding} canWrite={canWrite} onSaved={resource.reload} />
    </div>
  );
}
