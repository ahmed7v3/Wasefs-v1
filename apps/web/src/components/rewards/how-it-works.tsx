import { t } from "@wasfa/shared/i18n";

import { formatNumber } from "../../lib/admin-format";
import { formatPercent, longestHoldDays } from "../../lib/rewards-text";

import type { MeRewards } from "@wasfa/shared/schemas/rewards";
import type { WithdrawalEligibility } from "@wasfa/shared/schemas/withdrawals";

export interface HowItWorksProps {
  rewards: MeRewards;
  eligibility: WithdrawalEligibility | null;
}

/**
 * The honest rules in a few sentences (REFERRALS §10, block 6): when points arrive, what they can
 * become, and why a reward might be held. The numbers are the live settings, never hard-coded.
 */
export function HowItWorks({ rewards, eligibility }: HowItWorksProps) {
  const hold = longestHoldDays(rewards.offers);
  const { conversion } = rewards;
  const items: string[] = [
    t("rewardsPage.how.verified"),
    hold > 0 ? t("rewardsPage.how.hold", { days: hold }) : t("rewardsPage.how.noHold"),
    conversion.bonusBps > 0
      ? t("rewardsPage.how.convert", {
          rate: formatNumber(conversion.pointsPerCredit),
          percent: formatPercent(conversion.bonusBps),
        })
      : t("rewardsPage.how.convertNoBonus", { rate: formatNumber(conversion.pointsPerCredit) }),
    eligibility
      ? t("rewardsPage.how.withdraw", {
          minimum: formatNumber(eligibility.minWithdrawalPoints),
          days: eligibility.minAccountAgeDays,
        })
      : t("rewardsPage.how.withdrawSoon"),
    t("rewardsPage.how.held"),
    t("rewardsPage.how.notMoney"),
  ];

  return (
    <section aria-labelledby="how-title" className="flex flex-col gap-3">
      <h2 id="how-title" className="font-heading text-xl font-bold text-text">
        {t("rewardsPage.how.title")}
      </h2>
      <ul className="flex list-disc flex-col gap-2 rounded-xl bg-primary-soft p-4 ps-8 text-base text-text sm:p-5 sm:ps-9">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
