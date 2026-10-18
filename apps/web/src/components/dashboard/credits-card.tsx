"use client";

import { t, type MessageKey } from "@wasfa/shared/i18n";
import { meCreditsResponseSchema, type MeCreditsResponse } from "@wasfa/shared/schemas/credits";
import { Skeleton } from "@wasfa/ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { formatNumber } from "../../lib/admin-format";
import { ApiRequestError } from "../../lib/api-error";
import { formatDate } from "../../lib/dates";
import { useResource } from "../../lib/use-admin-data";
import { payerView } from "../../lib/wallet-view";
import { creditsPath, setWorkspaceOrgId } from "../../lib/workspace";
import { ErrorNotice } from "../error-notice";
import { PayerLine } from "../workspace/payer-line";

import { DashboardPanel } from "./dashboard-panel";

/** The tasks a person recognizes; the background ones (titles, summaries) are not shown. */
const SHOWN_TASKS: ReadonlyArray<{
  task: MeCreditsResponse["today"][number]["task"];
  label: MessageKey;
}> = [
  { task: "rx_extract", label: "dashboard.credits.task.rx_extract" },
  { task: "chat", label: "dashboard.credits.task.chat" },
  { task: "deep_think", label: "dashboard.credits.task.deep_think" },
  { task: "web_search", label: "dashboard.credits.task.web_search" },
];

/** The contract has only personal wallets today (`ownerType: "user"`); an organization wallet reuses this row. */
export function walletOwnerLabel(ownerType: string): string {
  return ownerType === "org" ? t("dashboard.credits.owner.org") : t("dashboard.credits.owner.user");
}

/** Room of the loaded card: the skeleton, the error and the data all fill it. */
const MIN_HEIGHT = "min-h-[27rem]";

function Usage({ data }: { data: MeCreditsResponse }) {
  const rows = SHOWN_TASKS.flatMap(({ task, label }) => {
    const row = data.today.find((entry) => entry.task === task);
    return row ? [{ ...row, label }] : [];
  });
  if (rows.length === 0) {
    return <p className="text-base text-text-muted">{t("dashboard.credits.todayEmpty")}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const capped = row.dailyCap !== null && row.dailyCap > 0;
        const percent = capped
          ? Math.min(100, Math.round((row.used / (row.dailyCap ?? 1)) * 100))
          : 0;
        return (
          <li key={row.task} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-base">
              <span className="text-text">{t(row.label)}</span>
              <span className="text-text-muted tabular-nums">
                {row.dailyCap === null
                  ? t("dashboard.credits.usedNoCap", { used: formatNumber(row.used) })
                  : t("dashboard.credits.used", {
                      used: formatNumber(row.used),
                      cap: formatNumber(row.dailyCap),
                    })}
              </span>
            </div>
            {capped ? (
              <div aria-hidden className="h-2 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ inlineSize: `${String(percent)}%` }}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Balance, plan, who owns the wallet, the next monthly grant and today's usage against the caps (`GET /me/credits`). */
export function CreditsCard({ orgId = null }: { orgId?: string | null }) {
  const router = useRouter();
  const credits = useResource(creditsPath(orgId), meCreditsResponseSchema);
  const stale =
    credits.status === "error" &&
    orgId !== null &&
    credits.error instanceof ApiRequestError &&
    credits.error.code === "NOT_FOUND";
  // An organization the person no longer belongs to: forget it and show the personal account.
  useEffect(() => {
    if (stale) {
      setWorkspaceOrgId(null);
      router.refresh();
    }
  }, [stale, router]);
  const payer = credits.status === "ready" ? payerView(credits.data) : null;

  return (
    <DashboardPanel id="credits-title" title={t("dashboard.credits.title")} className={MIN_HEIGHT}>
      {credits.status === "loading" ? (
        <div role="status" aria-label={t("ui.loading")} className="flex flex-1 flex-col gap-4">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : credits.status === "error" ? (
        <ErrorNotice error={credits.error} onRetry={credits.reload} supportHref={null} />
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-muted">{t("dashboard.credits.balanceLabel")}</p>
            <p className="font-heading text-4xl font-bold text-primary tabular-nums">
              {t("dashboard.credits.balance", {
                balance: formatNumber(payer?.balance ?? credits.data.wallet.balance),
              })}
            </p>
            {payer ? <PayerLine payer={payer} /> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-base">
            <div>
              <dt className="text-sm text-text-muted">{t("dashboard.credits.plan")}</dt>
              <dd className="font-semibold text-text">{credits.data.plan.nameAr}</dd>
              <dd className="text-sm text-text-muted tabular-nums">
                {t("dashboard.credits.monthly", {
                  count: formatNumber(credits.data.monthlyCredits),
                })}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-text-muted">{t("dashboard.credits.wallet")}</dt>
              <dd className="font-semibold text-text">
                {payer?.kind === "org"
                  ? walletOwnerLabel("org")
                  : walletOwnerLabel(credits.data.wallet.ownerType)}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-sm text-text-muted">{t("dashboard.credits.next")}</dt>
              <dd className="font-semibold text-text tabular-nums">
                {formatDate(credits.data.nextGrantAt)}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-lg font-semibold text-text">
              {t("dashboard.credits.todayTitle")}
            </h3>
            <Usage data={credits.data} />
          </div>
        </>
      )}
    </DashboardPanel>
  );
}
