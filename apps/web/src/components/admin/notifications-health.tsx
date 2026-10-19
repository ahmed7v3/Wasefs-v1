"use client";

import { t } from "@wasfa/shared/i18n";
import { alertHealthSchema, type AlertHealth } from "@wasfa/shared/schemas/admin-alerts";
import { Badge, Button, Card, CardTitle, Skeleton } from "@wasfa/ui";
import { CircleAlert, CircleCheck, CircleDashed, RotateCcw } from "lucide-react";
import Link from "next/link";

import { formatDateTime, formatNumber, tOr } from "../../lib/admin-format";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import type { ReactNode } from "react";

type Channel = AlertHealth["channels"][number];
type Verdict = "working" | "blocked" | "partial" | "idle";

/** What the last week says about a channel: arriving, never arriving, sometimes, or unused. */
function verdictOf(channel: Channel): Verdict {
  const problems = channel.skipped + channel.failed;
  if (channel.sent === 0 && problems === 0 && channel.pending === 0) return "idle";
  if (channel.sent === 0 && problems > 0) return "blocked";
  if (problems > 0) return "partial";
  return "working";
}

const VERDICT_TONE = {
  working: "success",
  partial: "warning",
  blocked: "danger",
  idle: "neutral",
} as const;

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      {ok ? (
        <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
      ) : (
        <CircleDashed aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      )}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-text">
          <span className="sr-only">
            {t(ok ? "admin.notify.check.done" : "admin.notify.check.todo")}
          </span>
          {label}
        </span>
        {!ok && hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
      </span>
    </li>
  );
}

function ChannelCard({ channel }: { channel: Channel }) {
  const verdict = verdictOf(channel);
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t(`admin.notify.channel.${channel.channel}`)}</CardTitle>
        <Badge tone={VERDICT_TONE[verdict]}>{t(`admin.notify.verdict.${verdict}`)}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(["sent", "pending", "skipped", "failed"] as const).map((key) => (
          <div key={key} className="flex flex-col">
            <dt className="text-text-muted">{t(`admin.notify.count.${key}`)}</dt>
            <dd className="text-lg font-semibold tabular-nums text-text">
              {formatNumber(channel[key])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-text-muted">
        {channel.lastSentAt
          ? t("admin.notify.lastSent", { date: formatDateTime(channel.lastSentAt) })
          : t("admin.notify.neverSent")}
      </p>
      {channel.reasons.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {channel.reasons.map((entry) => (
            <li
              key={`${entry.status}:${entry.reason}`}
              className="flex items-start gap-2 rounded-md border border-border p-3 text-sm"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-text">
                  {t("admin.notify.reasonCount", {
                    count: formatNumber(entry.count),
                    status: t(`admin.notify.count.${entry.status}`),
                  })}
                </span>
                <span className="text-text-muted">
                  {tOr(`admin.notify.reason.${entry.reason}`, entry.reason)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/**
 * The top of /admin/notifications: whether admin alerts reach each channel (last 7 days, with the
 * recorded reason and what to do about it), and a checklist of what still needs setting up.
 */
export function NotificationsHealth() {
  const resource = useResource("/admin/alerts/health", alertHealthSchema);

  if (resource.status === "loading") {
    return (
      <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
        <p className="sr-only" role="status">
          {t("ui.loading")}
        </p>
        {Array.from({ length: 2 }, (_, index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  if (resource.status === "error") {
    return <ErrorNotice error={resource.error} onRetry={resource.reload} />;
  }
  const { channels, whatsapp, me } = resource.data;
  const delivered = channels.filter((channel) => channel.channel !== "in_app");
  const telegram = channels.find((channel) => channel.channel === "telegram");
  const telegramTokenMissing =
    telegram?.reasons.some((entry) => entry.reason === "not_configured") ?? false;

  return (
    <section aria-labelledby="notify-health-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="notify-health-title" className="font-heading text-xl font-semibold text-text">
            {t("admin.notify.title")}
          </h2>
          <p className="text-sm text-text-muted">{t("admin.notify.lead")}</p>
        </div>
        <Button variant="secondary" name="refresh-health" onClick={resource.reload}>
          <RotateCcw aria-hidden className="size-5" />
          {t("admin.notify.refresh")}
        </Button>
      </div>

      <Card elevation="flat" padding="compact" className="flex flex-col gap-3">
        <CardTitle>{t("admin.notify.setup.title")}</CardTitle>
        <ul className="flex flex-col gap-3">
          <Check
            ok={me.emailEnabled}
            label={t("admin.notify.setup.email")}
            hint={t("admin.notify.setup.emailHint")}
          />
          <Check
            ok={me.telegramEnabled && me.telegramChatIdSet && !telegramTokenMissing}
            label={t("admin.notify.setup.telegram")}
            hint={
              telegramTokenMissing
                ? t("admin.notify.reason.not_configured")
                : t("admin.notify.setup.telegramHint")
            }
          />
          <Check
            ok={whatsapp.alertsEnabled}
            label={t("admin.notify.setup.waAlerts")}
            hint={t("admin.notify.setup.waAlertsHint")}
          />
          <Check
            ok={me.whatsappLinked && me.whatsappEnabled}
            label={t("admin.notify.setup.waMine")}
            hint={t("admin.notify.setup.waMineHint")}
          />
          <Check
            ok={whatsapp.customerMessagesEnabled}
            label={t("admin.notify.setup.customers")}
            hint={
              <>
                {t("admin.notify.setup.customersHint")}{" "}
                <Link href="/admin/whatsapp" className="font-medium text-primary underline">
                  {t("admin.nav.whatsapp")}
                </Link>
              </>
            }
          />
        </ul>
        <p className="text-sm text-text-muted">
          {t("admin.notify.optedIn", { count: formatNumber(whatsapp.optedInAdmins) })}{" "}
          <Link href="/admin/alerts" className="font-medium text-primary underline">
            {t("admin.notify.myPrefs")}
          </Link>
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {delivered.map((channel) => (
          <ChannelCard key={channel.channel} channel={channel} />
        ))}
      </div>
    </section>
  );
}
