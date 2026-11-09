"use client";

import { t } from "@wasfa/shared/i18n";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Checkbox,
  Field,
  Input,
  Textarea,
  useToast,
} from "@wasfa/ui";
import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { api } from "../../lib/api-client";
import { useReauth } from "../../lib/reauth";
import {
  TELEGRAM_POLL_MS,
  TELEGRAM_SUPPORT_MAX,
  TELEGRAM_WELCOME_MAX,
  telegramSettingsSchema,
  telegramStatusSchema,
  type TelegramSettings,
  type TelegramStatus,
} from "../../lib/telegram-admin";
import { useResource } from "../../lib/use-admin-data";
import { ErrorNotice } from "../error-notice";

import { ConfirmDialog } from "./confirm-dialog";
import { ResourceBoundary } from "./resource-boundary";

export interface TelegramViewProps {
  /** `wa_agent.write`: connect, disconnect and edit settings. */
  canWrite: boolean;
}

const botLink = (username: string) => `https://t.me/${username}`;

/** `/admin/telegram`: connect the bot, watch it live and edit its settings. */
export function TelegramView({ canWrite }: TelegramViewProps) {
  const status = useResource("/admin/telegram", telegramStatusSchema);
  const reloadStatus = status.reload;

  // Live stats: the same GET again; useResource keeps the old data on screen while it refreshes.
  useEffect(() => {
    const timer = setInterval(reloadStatus, TELEGRAM_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [reloadStatus]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold text-text">{t("admin.telegram.title")}</h1>
      <ResourceBoundary resource={status}>
        {(data) => (
          <>
            <ConnectionCard status={data} canWrite={canWrite} onChanged={reloadStatus} />
            {data.configured ? <StatsCards status={data} /> : null}
            {data.configured ? <SettingsCard canWrite={canWrite} onSaved={reloadStatus} /> : null}
            <FeaturesCard />
          </>
        )}
      </ResourceBoundary>
    </div>
  );
}

function ConnectionCard({
  status,
  canWrite,
  onChanged,
}: {
  status: TelegramStatus;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (token.trim() === "") return;
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api("/admin/telegram/token", {
          method: "PUT",
          body: { token: token.trim() },
          schema: telegramStatusSchema,
        }),
      );
      setToken("");
      toast({ tone: "success", title: t("admin.telegram.token.saved") });
      onChanged();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    await reauth.run(() => api("/admin/telegram/token", { method: "DELETE" }));
    toast({ tone: "success", title: t("admin.telegram.disconnected") });
    onChanged();
  };

  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle>{t("admin.telegram.connection.title")}</CardTitle>
        <Badge tone={status.configured ? "success" : "neutral"}>
          {status.configured
            ? t("admin.telegram.status.connected")
            : t("admin.telegram.status.notConfigured")}
        </Badge>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-text">{t("admin.telegram.guide.title")}</p>
        <ol className="list-decimal ps-5 text-sm text-text-muted">
          <li>{t("admin.telegram.guide.step1")}</li>
          <li>{t("admin.telegram.guide.step2")}</li>
          <li>{t("admin.telegram.guide.step3")}</li>
        </ol>
      </div>

      {canWrite ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            void save(event);
          }}
        >
          <Field label={t("admin.telegram.token.label")} hint={t("admin.telegram.token.hint")}>
            {(control) => (
              <Input
                {...control}
                type="password"
                name="telegram-token"
                autoComplete="off"
                dir="ltr"
                value={token}
                disabled={busy}
                onChange={(event) => {
                  setToken(event.target.value);
                }}
              />
            )}
          </Field>
          {status.configured && status.tokenHint ? (
            <p className="text-sm text-text-muted">
              {t("admin.telegram.token.hintLabel")}:{" "}
              <bdi dir="ltr" className="font-mono">
                {status.tokenHint}
              </bdi>
            </p>
          ) : null}
          {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
          <div className="flex flex-wrap justify-end gap-3">
            {status.configured ? (
              <Button
                type="button"
                variant="danger"
                name="telegram-disconnect"
                disabled={busy}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t("admin.telegram.disconnect")}
              </Button>
            ) : null}
            <Button
              type="submit"
              name="telegram-save"
              loading={busy}
              disabled={token.trim() === ""}
            >
              {t("admin.telegram.token.save")}
            </Button>
          </div>
        </form>
      ) : null}

      {status.configured ? <BotStatus status={status} /> : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("admin.telegram.disconnect.title")}
        description={t("admin.telegram.disconnect.body")}
        confirmLabel={t("admin.telegram.disconnect.confirm")}
        tone="danger"
        onConfirm={disconnect}
      />
    </Card>
  );
}

function BotStatus({ status }: { status: TelegramStatus }) {
  const { toast } = useToast();
  const username = status.botUsername;
  const copy = async () => {
    if (!username) return;
    await navigator.clipboard.writeText(botLink(username));
    toast({ tone: "success", title: t("admin.telegram.bot.copied") });
  };
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text-muted">{t("admin.telegram.bot")}</span>
        <span className="font-semibold text-text">{status.botName ?? ""}</span>
        {username ? (
          <a
            href={botLink(username)}
            target="_blank"
            rel="noreferrer"
            dir="ltr"
            className="inline-flex items-center gap-1 font-mono text-primary underline"
          >
            @{username}
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">{t("admin.telegram.bot.open")}</span>
          </a>
        ) : null}
        {username ? (
          <Button
            type="button"
            variant="secondary"
            name="telegram-copy-link"
            onClick={() => {
              void copy();
            }}
          >
            <Copy aria-hidden="true" className="size-4" />
            {t("admin.telegram.bot.copy")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-text-muted">{t("admin.telegram.webhook")}</span>
        <Badge tone={status.webhookOk ? "success" : "danger"}>
          {status.webhookOk ? t("admin.telegram.webhook.ok") : t("admin.telegram.webhook.error")}
        </Badge>
        <span className="text-sm text-text-muted">
          {t("admin.telegram.pending")}: {status.pendingUpdates}
        </span>
      </div>
      {status.lastError ? (
        <p role="alert" className="text-sm text-danger">
          {t("admin.telegram.webhook.lastError", { error: status.lastError })}
        </p>
      ) : null}
    </div>
  );
}

function StatsCards({ status }: { status: TelegramStatus }) {
  const items = [
    ["admin.telegram.stats.chats", status.stats.chats],
    ["admin.telegram.stats.linkedChats", status.stats.linkedChats],
    ["admin.telegram.stats.sharedPhones", status.stats.sharedPhones],
    ["admin.telegram.stats.analysesToday", status.stats.analysesToday],
    ["admin.telegram.stats.messagesToday", status.stats.messagesToday],
  ] as const;
  return (
    <section aria-label={t("admin.telegram.stats.title")}>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([key, value]) => (
          <li key={key}>
            <Card elevation="flat" padding="compact" className="flex flex-col gap-1">
              <span className="text-sm text-text-muted">{t(key)}</span>
              <span className="text-2xl font-bold text-text">{value.toLocaleString()}</span>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsCard({ canWrite, onSaved }: { canWrite: boolean; onSaved: () => void }) {
  const settings = useResource("/admin/telegram/settings", telegramSettingsSchema);
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-4">
      <CardTitle>{t("admin.telegram.settings.title")}</CardTitle>
      <ResourceBoundary resource={settings}>
        {(data) => (
          <SettingsForm
            initial={data}
            canWrite={canWrite}
            onSaved={() => {
              settings.reload();
              onSaved();
            }}
          />
        )}
      </ResourceBoundary>
    </Card>
  );
}

function SettingsForm({
  initial,
  canWrite,
  onSaved,
}: {
  initial: TelegramSettings;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const reauth = useReauth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<TelegramSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const disabled = busy || !canWrite;
  const set = <K extends keyof TelegramSettings>(key: K, value: TelegramSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await reauth.run(() =>
        api("/admin/telegram/settings", {
          method: "PUT",
          body: { ...draft, supportUsername: draft.supportUsername.trim().replace(/^@/, "") },
          schema: telegramSettingsSchema,
        }),
      );
      toast({ tone: "success", title: t("admin.telegram.settings.saved") });
      onSaved();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const counter = (value: string) =>
    t("admin.telegram.settings.counter", { count: value.length, max: TELEGRAM_WELCOME_MAX });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <Checkbox
        role="switch"
        name="telegram-enabled"
        label={t("admin.telegram.settings.enabled")}
        checked={draft.enabled}
        disabled={disabled}
        onChange={(event) => {
          set("enabled", event.target.checked);
        }}
      />
      <Checkbox
        role="switch"
        name="telegram-ads-enabled"
        label={t("admin.telegram.settings.adsEnabled")}
        checked={draft.adsEnabled}
        disabled={disabled}
        onChange={(event) => {
          set("adsEnabled", event.target.checked);
        }}
      />
      <Field label={t("admin.telegram.settings.welcomeAr")} hint={counter(draft.welcomeAr)}>
        {(control) => (
          <Textarea
            {...control}
            name="welcome-ar"
            rows={4}
            maxLength={TELEGRAM_WELCOME_MAX}
            value={draft.welcomeAr}
            disabled={disabled}
            onChange={(event) => {
              set("welcomeAr", event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t("admin.telegram.settings.welcomeEn")} hint={counter(draft.welcomeEn)}>
        {(control) => (
          <Textarea
            {...control}
            name="welcome-en"
            rows={4}
            dir="ltr"
            maxLength={TELEGRAM_WELCOME_MAX}
            value={draft.welcomeEn}
            disabled={disabled}
            onChange={(event) => {
              set("welcomeEn", event.target.value);
            }}
          />
        )}
      </Field>
      <Field
        label={t("admin.telegram.settings.support")}
        hint={t("admin.telegram.settings.supportHint")}
      >
        {(control) => (
          <Input
            {...control}
            name="support-username"
            dir="ltr"
            maxLength={TELEGRAM_SUPPORT_MAX}
            value={draft.supportUsername}
            disabled={disabled}
            onChange={(event) => {
              set("supportUsername", event.target.value);
            }}
          />
        )}
      </Field>
      {failure ? <ErrorNotice error={failure} supportHref={null} /> : null}
      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" name="telegram-settings-save" loading={busy}>
            {t("admin.telegram.settings.save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function FeaturesCard() {
  return (
    <Card elevation="flat" padding="compact" className="flex flex-col gap-2">
      <CardTitle>{t("admin.telegram.features.title")}</CardTitle>
      <ul className="list-disc ps-5 text-sm text-text-muted">
        <li>{t("admin.telegram.features.start")}</li>
        <li>{t("admin.telegram.features.photo")}</li>
        <li>{t("admin.telegram.features.text")}</li>
        <li>{t("admin.telegram.features.link")}</li>
      </ul>
    </Card>
  );
}
