"use client";

import { ALERT_KINDS } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { adminAlertPrefsSchema } from "@wasfa/shared/schemas/admin-alerts";
import { Badge, Button, Card, Checkbox, Field, Input, useToast } from "@wasfa/ui";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { EmptyHint } from "./empty-hint";
import { ResourceBoundary } from "./resource-boundary";

type Prefs = z.output<typeof adminAlertPrefsSchema>;

const inboxSchema = z.object({
  items: z.array(
    z.object({
      delivery: z.object({ id: z.string(), readAt: z.string().nullable() }).loose(),
      alert: z
        .object({
          id: z.string(),
          kind: z.string(),
          severity: z.string(),
          summary: z.string(),
          link: z.string().nullable(),
          createdAt: z.string(),
          resolvedAt: z.string().nullable().optional(),
        })
        .loose(),
    }),
  ),
  unreadCount: z.number(),
  nextCursor: z.string().nullable(),
});

const prefsResponseSchema = adminAlertPrefsSchema.loose();

function PrefsCard() {
  const { toast } = useToast();
  const loaded = useResource("/admin/alerts/prefs", prefsResponseSchema);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (loaded.status === "ready") {
      const { inAppEnabled, emailEnabled, telegramEnabled, whatsappEnabled, telegramChatId, mutedKinds } = loaded.data;
      setPrefs({ inAppEnabled, emailEnabled, telegramEnabled, whatsappEnabled, telegramChatId, mutedKinds });
    }
  }, [loaded]);
  if (loaded.status === "error") return <ErrorNotice error={loaded.error} onRetry={loaded.reload} />;
  if (!prefs) return null;
  const chatValid = prefs.telegramChatId === null || /^-?\d{5,20}$/.test(prefs.telegramChatId);
  const save = async () => {
    setSaving(true);
    setFailure(null);
    try {
      await api("/admin/alerts/prefs", { method: "PUT", body: prefs });
      toast({ tone: "success", title: t("admin.alerts.saved") });
    } catch (error) {
      setFailure(error);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (key: "inAppEnabled" | "emailEnabled" | "telegramEnabled" | "whatsappEnabled") => {
    setPrefs((current) => (current ? { ...current, [key]: !current[key] } : current));
  };
  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">{t("admin.alerts.prefsTitle")}</h2>
      <p className="text-sm text-text-muted">{t("admin.alerts.prefsLead")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Checkbox name="pref-in-app" label={t("admin.alerts.channel.in_app")} checked={prefs.inAppEnabled} onChange={() => { toggle("inAppEnabled"); }} />
        <Checkbox name="pref-email" label={t("admin.alerts.channel.email")} checked={prefs.emailEnabled} onChange={() => { toggle("emailEnabled"); }} />
        <Checkbox name="pref-telegram" label={t("admin.alerts.channel.telegram")} checked={prefs.telegramEnabled} onChange={() => { toggle("telegramEnabled"); }} />
        <Checkbox name="pref-whatsapp" label={t("admin.alerts.channel.whatsapp")} checked={prefs.whatsappEnabled} onChange={() => { toggle("whatsappEnabled"); }} />
      </div>
      <Field
        label={t("admin.alerts.telegramChat")}
        hint={t("admin.alerts.telegramChatHint")}
        error={chatValid ? undefined : t("admin.alerts.telegramChatInvalid")}
      >
        {(control) => (
          <Input
            {...control}
            name="telegram-chat"
            ltr
            inputMode="numeric"
            value={prefs.telegramChatId ?? ""}
            onChange={(event) => {
              const value = event.target.value.trim();
              setPrefs((current) => (current ? { ...current, telegramChatId: value === "" ? null : value } : current));
            }}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-semibold text-text">{t("admin.alerts.muted")}</legend>
        <p className="text-sm text-text-muted">{t("admin.alerts.mutedHint")}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {ALERT_KINDS.map((kind) => (
            <Checkbox
              key={kind}
              name={`mute-${kind}`}
              label={tOr(`admin.alerts.kind.${kind}`, kind)}
              checked={prefs.mutedKinds.includes(kind)}
              onChange={() => {
                setPrefs((current) =>
                  current
                    ? {
                        ...current,
                        mutedKinds: current.mutedKinds.includes(kind)
                          ? current.mutedKinds.filter((entry) => entry !== kind)
                          : [...current.mutedKinds, kind],
                      }
                    : current,
                );
              }}
            />
          ))}
        </div>
      </fieldset>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      <div>
        <Button name="save-alert-prefs" loading={saving} disabled={!chatValid} onClick={() => { void save(); }}>
          {t("admin.alerts.save")}
        </Button>
      </div>
    </Card>
  );
}

/**
 * `/admin/alerts`: the admin's in-app alerts (newest first, mark read) and their delivery
 * preferences: channels, the Telegram chat id, and muted kinds (critical alerts ignore mutes).
 */
export function AlertsView() {
  const inbox = useResource("/admin/alerts?limit=50", inboxSchema);
  const markAll = async () => {
    await api("/admin/alerts/read-all", { method: "POST", body: {} });
    inbox.reload();
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card elevation="card" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-xl font-bold text-text">{t("admin.alerts.inbox")}</h2>
          <Button variant="secondary" name="read-all" onClick={() => { void markAll(); }}>{t("admin.alerts.readAll")}</Button>
        </div>
        <ResourceBoundary resource={inbox}>
          {(data) =>
            data.items.length === 0 ? (
              <EmptyHint icon={<BellRing />} title={t("admin.alerts.empty")} hint={t("admin.alerts.emptyHint")} />
            ) : (
              <ul className="flex flex-col gap-2">
                {data.items.map(({ delivery, alert }) => (
                  <li key={delivery.id} className={`flex flex-col gap-1 rounded-lg border p-3 ${delivery.readAt ? "border-border" : "border-primary bg-primary-soft"}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}>
                        {tOr(`admin.alerts.severity.${alert.severity}`, alert.severity)}
                      </Badge>
                      <span className="text-sm text-text-muted">{tOr(`admin.alerts.kind.${alert.kind}`, alert.kind)}</span>
                      <span className="text-sm text-text-muted tabular-nums">{formatDateTime(alert.createdAt)}</span>
                    </span>
                    <span className="text-base text-text">{alert.summary}</span>
                    {alert.link?.startsWith("/admin") ? (
                      <Link href={alert.link} className="text-sm text-primary underline">{t("admin.alerts.open")}</Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )
          }
        </ResourceBoundary>
      </Card>
      <PrefsCard />
    </div>
  );
}
