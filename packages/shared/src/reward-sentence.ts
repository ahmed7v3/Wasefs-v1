import { t, type Locale, type MessageKey } from "./i18n/index.js";

import type { RewardBeneficiary, RewardEvent, RewardKind, RewardRedeemableAs } from "./rewards.js";

/*
 * The plain-language sentence of a reward rule (ADMIN-CONSOLE-SPEC §6.1): "When the invitee pays
 * for the first time, the referrer gets 20% of the amount as points redeemable as cash or credits
 * after 14 days." The API sends `{ key, params }` with plain values (never prose, so the locale is the
 * viewer's); `renderRuleSentence` builds the text from the parts in `rewards.rule_sentence.*`.
 */

export interface RuleSentenceInput {
  event: RewardEvent;
  beneficiary: RewardBeneficiary;
  rewardKind: RewardKind;
  value: number;
  redeemableAs: RewardRedeemableAs;
  holdDays: number;
}

export interface RuleSentence {
  key: "rewards.rule_sentence.main";
  params: {
    event: RewardEvent;
    beneficiary: RewardBeneficiary;
    rewardKind: RewardKind;
    value: number;
    /** `value` as a percentage (basis points / 100); same as `value` for the other kinds. */
    percent: number;
    redeemableAs: RewardRedeemableAs;
    holdDays: number;
  };
}

export function ruleSentence(rule: RuleSentenceInput): RuleSentence {
  return {
    key: "rewards.rule_sentence.main",
    params: {
      event: rule.event,
      beneficiary: rule.beneficiary,
      rewardKind: rule.rewardKind,
      value: rule.value,
      percent: rule.rewardKind === "percent_of_net_bps" ? rule.value / 100 : rule.value,
      redeemableAs: rule.redeemableAs,
      holdDays: rule.holdDays,
    },
  };
}

export function renderRuleSentence(sentence: RuleSentence, locale: Locale): string {
  const p = sentence.params;
  const part = (key: string, params?: Record<string, string | number>) =>
    t(`rewards.rule_sentence.${key}` as MessageKey, params, locale);
  // Credits are granted at once; only points have a bucket to redeem from and a hold to wait out.
  const reward = [
    part(`reward.${p.rewardKind}`, { value: p.value, percent: p.percent }),
    ...(p.rewardKind === "fixed_credits" ? [] : [part(`redeem.${p.redeemableAs}`)]),
    p.holdDays > 0 && p.rewardKind !== "fixed_credits"
      ? part("hold.days", { days: p.holdDays })
      : part("hold.none"),
  ].join(" ");
  return t(
    sentence.key,
    {
      when: part(`when.${p.event}`),
      who: part(`who.${p.beneficiary}`),
      reward,
    },
    locale,
  );
}
