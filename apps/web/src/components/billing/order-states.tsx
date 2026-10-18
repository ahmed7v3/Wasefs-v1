import { t } from "@wasfa/shared/i18n";
import { Button, Spinner, buttonStyles } from "@wasfa/ui";
import { CircleCheck, Clock, MessageCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";

import type { ReactNode } from "react";

/*
 * The calm full-state cards of the post-order page (DESIGN-SYSTEM §7 "success" / "error"): an icon,
 * one title, one sentence and at most a primary and a secondary action.
 */

function StateCard({
  icon,
  tone,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const chip = {
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
    info: "bg-primary-soft text-primary",
  }[tone];
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-surface p-6 text-center shadow-card sm:p-10">
      <span
        aria-hidden
        className={`inline-flex size-14 items-center justify-center rounded-full ${chip}`}
      >
        {icon}
      </span>
      <h2 className="font-heading text-2xl font-bold text-text" data-testid="order-state-title">
        {title}
      </h2>
      {children ? (
        <div className="flex max-w-prose flex-col gap-2 text-base text-text-muted">{children}</div>
      ) : null}
      {actions ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
    </section>
  );
}

export function PaidState({
  free,
  manual,
  number,
}: {
  free: boolean;
  manual: boolean;
  number: string;
}) {
  return (
    <StateCard
      tone="success"
      icon={<CircleCheck className="size-8" />}
      title={free ? t("billing.order.paid.freeTitle") : t("billing.order.paid.title")}
      actions={
        <>
          <Link href="/billing" className={buttonStyles()}>
            {t("billing.order.paid.toBilling")}
          </Link>
          <Link href="/dashboard" className={buttonStyles({ variant: "secondary" })}>
            {t("billing.order.paid.toDashboard")}
          </Link>
        </>
      }
    >
      <p role="status">
        {manual ? t("billing.order.paid.manualBody") : t("billing.order.paid.body")}
      </p>
      <p className="text-sm">{t("billing.order.number", { number })}</p>
    </StateCard>
  );
}

export function ExpiredState({ number, canceled }: { number: string; canceled: boolean }) {
  return (
    <StateCard
      tone="warning"
      icon={<Clock className="size-8" />}
      title={canceled ? t("billing.order.canceled.title") : t("billing.order.expired.title")}
      actions={
        <Link href="/pricing" className={buttonStyles()}>
          {t("billing.order.startAgain")}
        </Link>
      }
    >
      <p>{canceled ? t("billing.order.canceled.body") : t("billing.order.expired.body")}</p>
      <p className="text-sm">{t("billing.order.number", { number })}</p>
    </StateCard>
  );
}

export function FailedState({
  number,
  supportHref,
}: {
  number: string;
  supportHref: string | null;
}) {
  return (
    <StateCard
      tone="danger"
      icon={<TriangleAlert className="size-8" />}
      title={t("billing.order.failed.title")}
      actions={
        <>
          <Link href="/pricing" className={buttonStyles()}>
            {t("billing.order.startAgain")}
          </Link>
          {supportHref ? (
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ variant: "secondary" })}
            >
              <MessageCircle aria-hidden className="size-4" />
              {t("billing.help.whatsapp")}
            </a>
          ) : null}
        </>
      }
    >
      <p role="alert">{t("billing.order.failed.body")}</p>
      <p className="text-sm">{t("billing.order.number", { number })}</p>
    </StateCard>
  );
}

export function PendingState({
  number,
  supportHref,
  stopped,
  onRefresh,
}: {
  number: string;
  supportHref: string | null;
  /** Polling gave up after ten minutes: offer a manual refresh instead of a spinner. */
  stopped: boolean;
  onRefresh: () => void;
}) {
  return (
    <StateCard
      tone="info"
      icon={stopped ? <Clock className="size-8" /> : <Spinner className="size-8" />}
      title={stopped ? t("billing.order.pending.stoppedTitle") : t("billing.order.pending.title")}
      actions={
        stopped ? (
          <Button onClick={onRefresh}>{t("billing.order.pending.refresh")}</Button>
        ) : undefined
      }
    >
      <p role="status">
        {stopped ? t("billing.order.pending.stoppedBody") : t("billing.order.pending.body")}
      </p>
      <p className="text-sm">{t("billing.order.number", { number })}</p>
      <details className="mt-2 w-full max-w-prose rounded-lg border border-border/60 p-3 text-start">
        <summary className="min-h-11 cursor-pointer font-semibold text-primary focus-visible:outline-none focus-visible:shadow-focus">
          {t("billing.order.help.summary")}
        </summary>
        <div className="mt-2 flex flex-col gap-3 text-base text-text">
          <p>{t("billing.order.help.body", { number })}</p>
          {supportHref ? (
            <a
              href={supportHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              <MessageCircle aria-hidden className="size-4" />
              {t("billing.help.whatsapp")}
            </a>
          ) : (
            <Link
              href="/contact"
              className={buttonStyles({ variant: "secondary", className: "self-start" })}
            >
              {t("common.contactSupport")}
            </Link>
          )}
        </div>
      </details>
    </StateCard>
  );
}
