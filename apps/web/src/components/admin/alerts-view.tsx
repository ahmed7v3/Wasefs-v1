"use client";

import { ALERT_KINDS } from "@wasfa/shared/billing";
import { t } from "@wasfa/shared/i18n";
import { adminAlertPrefsSchema } from "@wasfa/shared/schemas/admin-alerts";
import { Badge, Button, Card, Checkbox, Field, Input, Skeleton, useToast } from "@wasfa/ui";
import { BellRing, Check, CheckCheck, ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";

import { formatDateTime, tOr } from "../../lib/admin-format";
import { api } from "../../lib/api-client";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice, errorMessage } from "../error-notice";

import { EmptyHint } from "./empty-hint";

type Prefs = z.output<typeof adminAlertPrefsSchema>;

const itemSchema = z.object({
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
});
type Item = z.output<typeof itemSchema>;

const inboxSchema = z.object({
  items: z.array(itemSchema),
  unreadCount: z.number(),
  nextCursor: z.string().nullable(),
});

const prefsResponseSchema = adminAlertPrefsSchema.loose();

const PAGE = 50;
/** Kinds an admin can mute: the test alert is only ever sent on request. */
const MUTABLE_KINDS = ALERT_KINDS.filter((kind) => kind !== "system.test");
const FILTERS = ["all", "unread", "open"] as const;
type Filter = (typeof FILTERS)[number];

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info"> = {
  critical: "danger",
  warning: "warning",
};

function PrefsCard() {
  const { toast } = useToast();
  const loaded = useResource("/admin/alerts/prefs", prefsResponseSchema);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (loaded.status === "ready") {
      const {
        inAppEnabled,
        emailEnabled,
        telegramEnabled,
        whatsappEnabled,
        telegramChatId,
        mutedKinds,
      } = loaded.data;
      setPrefs({
        inAppEnabled,
        emailEnabled,
        telegramEnabled,
        whatsappEnabled,
        telegramChatId,
        mutedKinds,
      });
    }
  }, [loaded]);
  if (loaded.status === "error")
    return <ErrorNotice error={loaded.error} onRetry={loaded.reload} />;
  if (!prefs) return <Skeleton className="h-96 w-full" />;
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
        <Checkbox
          name="pref-in-app"
          label={t("admin.alerts.channel.in_app")}
          checked={prefs.inAppEnabled}
          onChange={() => {
            toggle("inAppEnabled");
          }}
        />
        <Checkbox
          name="pref-email"
          label={t("admin.alerts.channel.email")}
          checked={prefs.emailEnabled}
          onChange={() => {
            toggle("emailEnabled");
          }}
        />
        <Checkbox
          name="pref-telegram"
          label={t("admin.alerts.channel.telegram")}
          checked={prefs.telegramEnabled}
          onChange={() => {
            toggle("telegramEnabled");
          }}
        />
        <Checkbox
          name="pref-whatsapp"
          label={t("admin.alerts.channel.whatsapp")}
          checked={prefs.whatsappEnabled}
          onChange={() => {
            toggle("whatsappEnabled");
          }}
        />
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
              setPrefs((current) =>
                current ? { ...current, telegramChatId: value === "" ? null : value } : current,
              );
            }}
          />
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-base font-semibold text-text">
          {t("admin.alerts.muted")}
        </legend>
        <p className="text-sm text-text-muted">{t("admin.alerts.mutedHint")}</p>
        <div className="grid gap-1 sm:grid-cols-2">
          {MUTABLE_KINDS.map((kind) => (
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
      <div className="flex flex-wrap items-center gap-3">
        <Button
          name="save-alert-prefs"
          loading={saving}
          disabled={!chatValid}
          onClick={() => {
            void save();
          }}
        >
          {t("admin.alerts.save")}
        </Button>
        <Link href="/admin/notifications" className="text-sm font-medium text-primary underline">
          {t("admin.alerts.healthLink")}
        </Link>
      </div>
    </Card>
  );
}

function AlertRow({
  item,
  busy,
  onRead,
  onResolve,
}: {
  item: Item;
  busy: boolean;
  onRead: () => void;
  onResolve: () => void;
}) {
  const { delivery, alert } = item;
  const unread = delivery.readAt === null;
  const resolved = Boolean(alert.resolvedAt);
  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-3 ${unread ? "border-primary bg-primary-soft" : "border-border"}`}
    >
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[alert.severity] ?? "info"}>
          {tOr(`admin.alerts.severity.${alert.severity}`, alert.severity)}
        </Badge>
        <span className="text-sm font-medium text-text">
          {tOr(`admin.alerts.kind.${alert.kind}`, alert.kind)}
        </span>
        <span className="text-sm tabular-nums text-text-muted">
          {formatDateTime(alert.createdAt)}
        </span>
        {unread ? <Badge tone="info">{t("admin.alerts.new")}</Badge> : null}
        {resolved ? <Badge tone="success">{t("admin.alerts.resolved")}</Badge> : null}
      </span>
      <span className="text-base text-text">{alert.summary}</span>
      <span className="flex flex-wrap items-center gap-2">
        {alert.link?.startsWith("/admin") ? (
          <Link
            href={alert.link}
            onClick={() => {
              if (unread) onRead();
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary underline"
          >
            <ExternalLink aria-hidden className="size-4" />
            {t("admin.alerts.open")}
          </Link>
        ) : null}
        {unread ? (
          <Button
            variant="secondary"
            name={`read-${delivery.id}`}
            disabled={busy}
            className="px-3"
            onClick={onRead}
          >
            <Check aria-hidden className="size-4" />
            {t("admin.alerts.markRead")}
          </Button>
        ) : null}
        {resolved ? null : (
          <Button
            variant="secondary"
            name={`resolve-${alert.id}`}
            disabled={busy}
            className="px-3"
            onClick={onResolve}
          >
            <CheckCheck aria-hidden className="size-4" />
            {t("admin.alerts.resolve")}
          </Button>
        )}
      </span>
    </li>
  );
}

function Inbox() {
  const { toast } = useToast();
  const first = useResource(`/admin/alerts?limit=${String(PAGE)}`, inboxSchema);
  const [items, setItems] = useState<Item[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (first.status === "ready") {
      setItems(first.data.items);
      setUnreadCount(first.data.unreadCount);
      setCursor(first.data.nextCursor);
    }
  }, [first]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast({ tone: "error", title: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const markRead = (item: Item) =>
    run(item.delivery.id, async () => {
      await api(`/admin/alerts/${item.delivery.id}/read`, { method: "POST", body: {} });
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((entry) =>
          entry.delivery.id === item.delivery.id
            ? { ...entry, delivery: { ...entry.delivery, readAt: now } }
            : entry,
        ),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    });

  const resolve = (item: Item) =>
    run(item.alert.id, async () => {
      await api(`/admin/alerts/${item.alert.id}/resolve`, { method: "POST", body: {} });
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((entry) =>
          entry.alert.id === item.alert.id
            ? { ...entry, alert: { ...entry.alert, resolvedAt: now } }
            : entry,
        ),
      );
      toast({ tone: "success", title: t("admin.alerts.resolvedToast") });
    });

  const markAll = () =>
    run("all", async () => {
      await api("/admin/alerts/read-all", { method: "POST", body: {} });
      first.reload();
    });

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api(
        `/admin/alerts?limit=${String(PAGE)}&cursor=${encodeURIComponent(cursor)}`,
        { schema: inboxSchema },
      );
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      toast({ tone: "error", title: errorMessage(error) });
    } finally {
      setLoadingMore(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api("/admin/alerts/test", { method: "POST", body: {} });
      toast({ tone: "success", title: t("admin.alerts.testSent") });
      // The in-app copy is written by the worker a moment later.
      window.setTimeout(first.reload, 3_000);
    } catch (error) {
      toast({ tone: "error", title: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  const shown = items.filter((item) =>
    filter === "unread"
      ? item.delivery.readAt === null
      : filter === "open"
        ? !item.alert.resolvedAt
        : true,
  );

  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-xl font-bold text-text">{t("admin.alerts.inbox")}</h2>
          {unreadCount > 0 ? (
            <Badge tone="info">{t("admin.alerts.unread", { count: unreadCount })}</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            name="send-test-alert"
            loading={testing}
            onClick={() => {
              void sendTest();
            }}
          >
            <Send aria-hidden className="size-4" />
            {t("admin.alerts.test")}
          </Button>
          <Button
            variant="secondary"
            name="read-all"
            disabled={unreadCount === 0 || busy !== null}
            onClick={() => {
              void markAll();
            }}
          >
            <CheckCheck aria-hidden className="size-4" />
            {t("admin.alerts.readAll")}
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted">{t("admin.alerts.lead")}</p>
      <div role="group" aria-label={t("admin.alerts.filterLabel")} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <Button
            key={value}
            variant={filter === value ? "primary" : "secondary"}
            name={`filter-${value}`}
            aria-pressed={filter === value}
            className="px-3"
            onClick={() => {
              setFilter(value);
            }}
          >
            {t(`admin.alerts.filter.${value}`)}
          </Button>
        ))}
      </div>
      {first.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : first.status === "error" ? (
        <ErrorNotice error={first.error} onRetry={first.reload} />
      ) : shown.length === 0 ? (
        <EmptyHint
          icon={<BellRing />}
          title={filter === "all" ? t("admin.alerts.empty") : t("admin.alerts.emptyFiltered")}
          hint={t("admin.alerts.emptyHint")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((item) => (
            <AlertRow
              key={item.delivery.id}
              item={item}
              busy={busy !== null}
              onRead={() => {
                void markRead(item);
              }}
              onResolve={() => {
                void resolve(item);
              }}
            />
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="secondary"
          name="load-more-alerts"
          loading={loadingMore}
          className="self-center"
          onClick={() => {
            void loadMore();
          }}
        >
          {t("admin.alerts.more")}
        </Button>
      ) : null}
    </Card>
  );
}

/**
 * `/admin/alerts`: the admin's in-app alerts (filter, mark read, resolve, load older ones, send
 * yourself a test) and their delivery preferences: channels, the Telegram chat id, muted kinds.
 */
export function AlertsView() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Inbox />
      <PrefsCard />
    </div>
  );
}
