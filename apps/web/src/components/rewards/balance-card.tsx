"use client";

import { t } from "@wasfa/shared/i18n";
import { Button, Card, buttonStyles, moneyText } from "@wasfa/ui";
import { ArrowLeftRight, Banknote } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatNumber } from "../../lib/admin-format";
import { daysUntil, formatPercent } from "../../lib/rewards-text";

import { ConvertDialog } from "./convert-dialog";

import type { MeRewards } from "@wasfa/shared/schemas/rewards";
import type { WithdrawalEligibility } from "@wasfa/shared/schemas/withdrawals";

export interface BalanceCardProps {
  rewards: MeRewards;
  /** `null` when the eligibility call failed: the card then says cash-out is not available yet. */
  eligibility: WithdrawalEligibility | null;
  onChanged: () => void;
}

function Figure({
  label,
  value,
  note,
  testId,
}: {
  label: string;
  value: string;
  note?: string | undefined;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="font-heading text-2xl font-bold tabular-nums text-text" data-testid={testId}>
        {value}
      </dd>
      {note ? <dd className="text-sm text-text-muted">{note}</dd> : null}
    </div>
  );
}

/** Why cash-out is disabled right now, in one sentence; the withdraw flow itself comes in a later task. */
function withdrawReason(eligibility: WithdrawalEligibility | null): string {
  if (eligibility === null) return t("rewardsPage.withdraw.soon");
  if (!eligibility.available) return t("rewardsPage.withdraw.off");
  if (eligibility.pointsToMinimum > 0) {
    return t("rewardsPage.withdraw.needMore", {
      missing: formatNumber(eligibility.pointsToMinimum),
      minimum: formatNumber(eligibility.minWithdrawalPoints),
    });
  }
  return t("rewardsPage.withdraw.soon");
}

/** Block 2 of REFERRALS §10: cash, credit-only and pending points, with convert and (disabled) withdraw. */
export function BalanceCard({ rewards, eligibility, onChanged }: BalanceCardProps) {
  const [converting, setConverting] = useState(false);
  const [now] = useState(() => Date.now());
  const { balances, conversion } = rewards;
  const convertible = balances.cash + balances.creditOnly;
  const pendingNote =
    balances.pending > 0 && balances.pendingReleaseAt
      ? t("rewardsPage.balance.pendingIn", { days: daysUntil(balances.pendingReleaseAt, now) })
      : undefined;
  const reasonId = "withdraw-reason";
  // The withdraw page explains every remaining rule (destination, cooldown, limits); the button only
  // waits for cash-out to be on and the minimum to be reached.
  const canWithdraw = eligibility?.available === true && eligibility.pointsToMinimum === 0;

  return (
    <Card elevation="card" className="flex flex-col gap-5">
      <h2 className="font-heading text-xl font-bold text-text">{t("rewardsPage.balance.title")}</h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Figure
          testId="points-cash"
          label={t("rewardsPage.balance.cash")}
          value={t("rewardsPage.points", { count: formatNumber(balances.cash) })}
          note={t("rewardsPage.balance.cashValue", {
            value: moneyText(balances.cashValueMinor, balances.currency),
          })}
        />
        <Figure
          testId="points-credit-only"
          label={t("rewardsPage.balance.creditOnly")}
          value={t("rewardsPage.points", { count: formatNumber(balances.creditOnly) })}
          note={t("rewardsPage.balance.creditOnlyNote")}
        />
        <Figure
          testId="points-pending"
          label={t("rewardsPage.balance.pending")}
          value={t("rewardsPage.points", { count: formatNumber(balances.pending) })}
          note={pendingNote}
        />
      </dl>
      {rewards.debt > 0 ? (
        <p className="rounded-md bg-warning-soft p-3 text-base text-text">
          {t("rewardsPage.balance.debt", { count: formatNumber(rewards.debt) })}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            name="open-convert"
            disabled={convertible < 1}
            onClick={() => {
              setConverting(true);
            }}
          >
            <ArrowLeftRight aria-hidden className="size-4" />
            {t("rewardsPage.convert.open")}
          </Button>
          {conversion.bonusBps > 0 ? (
            <span className="text-sm font-semibold text-success">
              {t("rewardsPage.convert.bonusBadge", { percent: formatPercent(conversion.bonusBps) })}
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <div>
            {canWithdraw ? (
              <Link
                href="/rewards/withdraw"
                className={buttonStyles({ variant: "secondary" })}
                data-testid="withdraw-link"
              >
                <Banknote aria-hidden className="size-4" />
                {t("rewardsPage.withdraw.open")}
              </Link>
            ) : (
              <Button name="withdraw" variant="secondary" disabled aria-describedby={reasonId}>
                <Banknote aria-hidden className="size-4" />
                {t("rewardsPage.withdraw.open")}
              </Button>
            )}
          </div>
          {eligibility?.available && eligibility.pointsToMinimum > 0 ? (
            <progress
              value={Math.min(eligibility.cash, eligibility.minWithdrawalPoints)}
              max={eligibility.minWithdrawalPoints}
              aria-label={t("rewardsPage.withdraw.progress")}
              className="h-2 w-full max-w-sm overflow-hidden rounded-full [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-neutral-100 [&::-webkit-progress-value]:bg-primary"
            />
          ) : null}
          {canWithdraw ? null : (
            <p id={reasonId} className="text-sm text-text-muted">
              {withdrawReason(eligibility)}
            </p>
          )}
        </div>
      </div>

      <ConvertDialog
        open={converting}
        available={convertible}
        conversion={conversion}
        onClose={() => {
          setConverting(false);
        }}
        onConverted={onChanged}
      />
    </Card>
  );
}
