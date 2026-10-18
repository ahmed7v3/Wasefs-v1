import { t } from "@wasfa/shared/i18n";
import { Badge, Card } from "@wasfa/ui";

import { formatNumber } from "../../lib/admin-format";
import { formatPercent } from "../../lib/rewards-text";

import type { MeRewards } from "@wasfa/shared/schemas/rewards";

/** Block 3 of REFERRALS §10: invited, verified and paid counts, and the tier when the program has tiers. */
export function ProgressCard({ rewards }: { rewards: MeRewards }) {
  const { counts, tier } = rewards;
  const missing = tier?.next ? Math.max(0, tier.next.minPaidReferrals - tier.paidReferrals) : 0;

  return (
    <Card elevation="card" className="flex flex-col gap-4">
      <h2 className="font-heading text-xl font-bold text-text">
        {t("rewardsPage.progress.title")}
      </h2>
      <dl className="grid grid-cols-3 gap-3">
        {(
          [
            ["invited", counts.invited],
            ["verified", counts.verified],
            ["paid", counts.paid],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-sm text-text-muted">{t(`rewardsPage.progress.${key}`)}</dt>
            <dd
              className="font-heading text-3xl font-bold tabular-nums text-text"
              data-testid={`count-${key}`}
            >
              {formatNumber(value)}
            </dd>
          </div>
        ))}
      </dl>
      {tier ? (
        <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
          <p className="flex flex-wrap items-center gap-2 text-base text-text">
            {t("rewardsPage.progress.tier")}
            {tier.current ? (
              <Badge tone="info">{tier.current.nameAr}</Badge>
            ) : (
              <Badge tone="neutral">{t("rewardsPage.progress.noTier")}</Badge>
            )}
          </p>
          {tier.next ? (
            <p className="text-sm text-text-muted">
              {t("rewardsPage.progress.next", {
                missing: formatNumber(missing),
                name: tier.next.nameAr,
                bonus: formatPercent(tier.next.bonusBps),
              })}
            </p>
          ) : (
            <p className="text-sm text-text-muted">{t("rewardsPage.progress.top")}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
