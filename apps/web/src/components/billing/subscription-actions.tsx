"use client";

import { t } from "@wasfa/shared/i18n/public";
import { Button, Dialog, buttonStyles } from "@wasfa/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cancelSubscription, resumeSubscription, startTrial } from "../../lib/billing-api";
import { ErrorNotice } from "../error-notice";

export interface SubscriptionActionsProps {
  /** A live paid or granted subscription exists. */
  hasSubscription: boolean;
  /** Renewal makes sense: not a trial, so there is a paid period to extend. */
  canRenew: boolean;
  cancelAtPeriodEnd: boolean;
  /** The end of the period as a ready date ("15 نوفمبر 2026"), for the confirmation sentence. */
  periodEnd: string | null;
  upgrades: readonly { key: string; name: string; href: string }[];
  trials: readonly { key: string; name: string; days: number }[];
}

/**
 * The account's actions. Cancelling stops the renewal reminders and keeps access to the period end;
 * it is as easy as buying (one confirm), and resuming is one tap. Each action refreshes the server
 * page so the chips and dates it shows are the server's.
 */
export function SubscriptionActions({
  hasSubscription,
  canRenew,
  cancelAtPeriodEnd,
  periodEnd,
  upgrades,
  trials,
}: SubscriptionActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function run(name: string, action: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await action();
      setConfirming(false);
      router.refresh();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        {canRenew ? (
          <Link href="/checkout?renew=1" className={buttonStyles()}>
            {t("billing.account.renew")}
          </Link>
        ) : null}
        {upgrades.map((upgrade) => (
          <Link
            key={upgrade.key}
            href={upgrade.href}
            className={buttonStyles({ variant: canRenew ? "secondary" : "primary" })}
          >
            {t("billing.account.upgradeTo", { name: upgrade.name })}
          </Link>
        ))}
        {hasSubscription && cancelAtPeriodEnd ? (
          <Button
            variant="secondary"
            loading={busy === "resume"}
            disabled={busy !== null}
            onClick={() => {
              void run("resume", resumeSubscription);
            }}
          >
            {t("billing.account.resume")}
          </Button>
        ) : null}
        {hasSubscription && !cancelAtPeriodEnd ? (
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {t("billing.account.cancel")}
          </Button>
        ) : null}
      </div>

      {upgrades.length > 0 ? (
        <p className="text-sm text-text-muted">{t("billing.account.upgradeExplain")}</p>
      ) : null}

      {trials.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg bg-primary-soft p-4">
          <p className="text-base font-semibold text-primary">{t("billing.account.trialLead")}</p>
          <div className="flex flex-wrap gap-3">
            {trials.map((trial) => (
              <Button
                key={trial.key}
                variant="secondary"
                loading={busy === `trial-${trial.key}`}
                disabled={busy !== null}
                onClick={() => {
                  void run(`trial-${trial.key}`, () => startTrial(trial.key));
                }}
              >
                {t("billing.account.startTrial", { name: trial.name, days: trial.days })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <ErrorNotice error={error} /> : null}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("billing.account.cancelTitle")}
        description={
          periodEnd
            ? t("billing.account.cancelBody", { date: periodEnd })
            : t("billing.account.cancelBodyNoDate")
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t("billing.account.cancelBack")}
            </Button>
            <Button
              variant="danger"
              loading={busy === "cancel"}
              disabled={busy !== null}
              onClick={() => {
                void run("cancel", cancelSubscription);
              }}
            >
              {t("billing.account.cancelConfirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}
