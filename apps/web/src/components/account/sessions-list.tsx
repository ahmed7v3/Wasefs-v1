"use client";

import { t } from "@wasfa/shared/i18n";
import {
  revokeSessionsResponseSchema,
  sessionListResponseSchema,
  type SessionItem,
} from "@wasfa/shared/schemas/user";
import { Badge, Button, Card, Dialog, Skeleton, useToast } from "@wasfa/ui";
import { Laptop, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api-client";
import { formatRelative } from "../../lib/dates";
import { parseUserAgent } from "../../lib/user-agent";
import { ErrorNotice } from "../error-notice";

/** "Chrome on Windows"; the pieces that could not be read are left out, and nothing at all means "unknown device". */
export function deviceLabel(userAgent: string | null): string {
  const { browser, os } = parseUserAgent(userAgent);
  if (browser && os) return t("account.sessions.device", { browser, os });
  return browser ?? os ?? t("account.sessions.unknownDevice");
}

function SessionRow({
  session,
  busy,
  onRevoke,
}: {
  session: SessionItem;
  busy: boolean;
  onRevoke: (session: SessionItem) => void;
}) {
  const device = deviceLabel(session.userAgent);
  const { os } = parseUserAgent(session.userAgent);
  const Icon = os === "iOS" || os === "Android" ? Smartphone : Laptop;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 p-4">
      <span
        aria-hidden
        className="inline-flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"
      >
        <Icon className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-text">
          {device}
          {session.current ? <Badge tone="success">{t("account.sessions.current")}</Badge> : null}
        </p>
        {session.ipAddress ? (
          <p className="text-sm text-text-muted">
            {t("account.sessions.ip")} <bdi dir="ltr">{session.ipAddress}</bdi>
          </p>
        ) : null}
        <p className="text-sm text-text-muted">
          {t("account.sessions.lastSeen", { when: formatRelative(session.lastSeenAt) })}
        </p>
      </div>
      {session.current ? null : (
        <Button
          variant="secondary"
          name="revoke-session"
          className="w-full sm:w-auto"
          loading={busy}
          aria-label={t("account.sessions.revokeLabel", { device })}
          onClick={() => {
            onRevoke(session);
          }}
        >
          {t("account.sessions.revoke")}
        </Button>
      )}
    </li>
  );
}

/** Where the account is signed in (`GET /me/sessions`), with revoke-one and revoke-all-others. */
export function SessionsList() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionItem[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  const load = useCallback((signal?: AbortSignal) => {
    setLoadError(null);
    api("/me/sessions", { schema: sessionListResponseSchema, ...(signal ? { signal } : {}) })
      .then((result) => {
        setSessions(result.items);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(error);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => {
      controller.abort();
    };
  }, [load]);

  const revoke = (session: SessionItem) => {
    setBusyId(session.id);
    setActionError(null);
    api(`/me/sessions/${session.id}`, { method: "DELETE" })
      .then(() => {
        setSessions((current) => current?.filter((item) => item.id !== session.id) ?? null);
        toast({ tone: "success", title: t("account.sessions.revoked") });
      })
      .catch((error: unknown) => {
        setActionError(error);
      })
      .finally(() => {
        setBusyId(null);
      });
  };

  const revokeAll = () => {
    setRevokingAll(true);
    setActionError(null);
    api("/me/sessions", { method: "DELETE", schema: revokeSessionsResponseSchema })
      .then((result) => {
        setSessions((current) => current?.filter((item) => item.current) ?? null);
        setConfirmAll(false);
        toast({
          tone: "success",
          title: t("account.sessions.revokedAll", { count: result.revoked }),
        });
      })
      .catch((error: unknown) => {
        setConfirmAll(false);
        setActionError(error);
      })
      .finally(() => {
        setRevokingAll(false);
      });
  };

  const others = sessions?.filter((session) => !session.current) ?? [];

  return (
    <Card className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="font-heading text-xl font-semibold text-text">
          {t("account.sessions.title")}
        </h2>
        <p className="text-base text-text-muted">{t("account.sessions.lead")}</p>
      </header>

      {loadError ? (
        <ErrorNotice
          error={loadError}
          onRetry={() => {
            load();
          }}
        />
      ) : null}
      {actionError ? <ErrorNotice error={actionError} /> : null}

      {sessions === null && !loadError ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}

      {sessions ? (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              busy={busyId === session.id}
              onRevoke={revoke}
            />
          ))}
        </ul>
      ) : null}

      {sessions && others.length === 0 ? (
        <p className="text-base text-text-muted">{t("account.sessions.empty")}</p>
      ) : null}

      {others.length > 0 ? (
        <div>
          <Button
            variant="secondary"
            name="revoke-all-sessions"
            onClick={() => {
              setConfirmAll(true);
            }}
          >
            {t("account.sessions.revokeAll")}
          </Button>
        </div>
      ) : null}

      <Dialog
        open={confirmAll}
        onOpenChange={(open) => {
          if (!open && !revokingAll) setConfirmAll(false);
        }}
        title={t("account.sessions.revokeAllTitle")}
        description={t("account.sessions.revokeAllBody")}
        actions={
          <>
            <Button
              variant="ghost"
              name="cancel"
              onClick={() => {
                setConfirmAll(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              name="confirm-revoke-all"
              loading={revokingAll}
              onClick={revokeAll}
            >
              {t("account.sessions.revokeAll")}
            </Button>
          </>
        }
      />
    </Card>
  );
}
