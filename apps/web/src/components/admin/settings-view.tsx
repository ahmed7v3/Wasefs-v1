"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminSettingSchema,
  adminSettingsResponseSchema,
  type AdminSetting,
} from "@wasfa/shared/schemas/admin";
import { SETTING_KEYS, type SettingKey } from "@wasfa/shared/settings";
import { Badge, Card, CardTitle, Skeleton, useToast } from "@wasfa/ui";
import { Globe, Lock } from "lucide-react";
import { useState } from "react";

import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { SettingForm } from "./setting-form";

/** `ai` is edited on its own page (`ai.write` + `ai.killswitch`); the generic route refuses it. */
const GENERIC_SETTING_KEYS = SETTING_KEYS.filter((key) => key !== "ai");

export interface SettingsViewProps {
  canWrite: boolean;
}

export function SettingsView({ canWrite }: SettingsViewProps) {
  const resource = useResource("/admin/settings", adminSettingsResponseSchema);
  const reauth = useReauth();
  const { toast } = useToast();
  // Rows saved in this session replace the loaded ones without refetching the whole list.
  const [saved, setSaved] = useState<Partial<Record<SettingKey, AdminSetting>>>({});

  if (resource.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} elevation="flat" className="flex flex-col gap-3">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </Card>
        ))}
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }

  const loaded = new Map(resource.data.items.map((item) => [item.key, item]));

  const save = (key: SettingKey) => async (value: unknown) => {
    const updated = await reauth.run(() =>
      api(`/admin/settings/${key}`, {
        method: "PUT",
        body: { value },
        schema: adminSettingSchema,
      }),
    );
    setSaved((current) => ({ ...current, [key]: updated }));
    toast({
      tone: "success",
      title: t("admin.settings.saved", { name: tOr(`admin.settings.${key}.title`, key) }),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-base text-text-muted">
        {canWrite ? t("admin.settings.lead") : t("admin.settings.readOnlyNote")}
      </p>
      {GENERIC_SETTING_KEYS.map((key) => {
        const item = saved[key] ?? loaded.get(key);
        if (!item) return null;
        return (
          <Card key={key} elevation="flat" padding="compact" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle>{tOr(`admin.settings.${key}.title`, key)}</CardTitle>
                <p className="text-sm text-text-muted">
                  {tOr(`admin.settings.${key}.description`, "")}
                </p>
              </div>
              <Badge tone={item.visibility === "public" ? "info" : "neutral"}>
                {item.visibility === "public" ? (
                  <Globe aria-hidden className="size-4" />
                ) : (
                  <Lock aria-hidden className="size-4" />
                )}
                {t(
                  item.visibility === "public" ? "admin.settings.public" : "admin.settings.private",
                )}
              </Badge>
            </div>
            {/* Keyed by the save time: after a save the form restarts from the stored value. */}
            <SettingForm
              key={item.updatedAt ?? "default"}
              settingKey={key}
              value={item.value}
              canWrite={canWrite}
              onSave={save(key)}
            />
            <p className="text-xs text-text-muted tabular-nums">
              {item.updatedAt
                ? t("admin.settings.updatedAt", { date: formatDateTime(item.updatedAt) })
                : t("admin.settings.usingDefault")}
            </p>
          </Card>
        );
      })}
    </div>
  );
}
