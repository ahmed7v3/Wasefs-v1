"use client";

import { t } from "@wasfa/shared/i18n";
import {
  adminSettingSchema,
  adminSettingsResponseSchema,
  type AdminSetting,
} from "@wasfa/shared/schemas/admin";
import { type SettingKey } from "@wasfa/shared/settings";
import { Badge, Card, CardTitle, Skeleton, useToast } from "@wasfa/ui";
import { Globe, Info, Lock } from "lucide-react";
import { useState } from "react";

import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import { SETTING_LAYOUTS, type SettingsPageGroup } from "../../lib/setting-meta";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { SettingForm } from "./setting-form";

export interface SettingsViewProps {
  canWrite: boolean;
  /** Titled groups of keys (the general page), or ... */
  groups?: readonly SettingsPageGroup[] | undefined;
  /** ... the keys of a feature page, each in its own card. */
  keys?: readonly SettingKey[] | undefined;
}

interface IndexEntry {
  href: string;
  label: string;
}

/**
 * Settings of one page: each key is a card with its own save, laid out in titled sections
 * (`SETTING_LAYOUTS`), with an index of the page at the top. `ai` and `skills` are edited on their
 * own pages (`ai.write`); the generic route refuses them, so no page lists them here.
 */
export function SettingsView({ canWrite, groups, keys }: SettingsViewProps) {
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

  const renderKey = (key: SettingKey) => {
    const item = saved[key] ?? loaded.get(key);
    if (!item) return null;
    return (
      <Card
        key={key}
        id={`setting-${key}`}
        elevation="flat"
        padding="compact"
        className="flex scroll-mt-24 flex-col gap-4"
      >
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
            {t(item.visibility === "public" ? "admin.settings.public" : "admin.settings.private")}
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
  };

  const index: IndexEntry[] = groups
    ? groups.map((group) => ({ href: `#group-${group.id}`, label: t(group.title) }))
    : (keys ?? []).flatMap((key) => {
        const sections = SETTING_LAYOUTS[key];
        if (!sections || (keys?.length ?? 0) > 1) {
          return [{ href: `#setting-${key}`, label: tOr(`admin.settings.${key}.title`, key) }];
        }
        return sections.map((section) => ({
          href: `#${key}-${section.id}`,
          label: t(section.title),
        }));
      });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-primary-soft p-4 text-sm text-text">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
        <p>{canWrite ? t("admin.settings.lead") : t("admin.settings.readOnlyNote")}</p>
      </div>
      {index.length > 1 ? (
        <nav aria-label={t("admin.settings.onThisPage")} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-text-muted">{t("admin.settings.onThisPage")}</p>
          <ul className="flex flex-wrap gap-2">
            {index.map((entry) => (
              <li key={entry.href}>
                <a
                  href={entry.href}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-surface px-4 text-sm text-text hover:bg-neutral-50 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {groups
        ? groups.map((group) => (
            <section
              key={group.id}
              id={`group-${group.id}`}
              aria-labelledby={`group-${group.id}-title`}
              className="flex scroll-mt-24 flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <h2 id={`group-${group.id}-title`} className="text-xl font-semibold text-text">
                  {t(group.title)}
                </h2>
                <p className="text-sm text-text-muted">{t(group.description)}</p>
              </div>
              {group.keys.map(renderKey)}
            </section>
          ))
        : (keys ?? []).map(renderKey)}
    </div>
  );
}
