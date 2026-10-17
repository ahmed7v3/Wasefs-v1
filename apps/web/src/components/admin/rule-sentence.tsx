import { t } from "@wasfa/shared/i18n";

import { discountSentence, type DiscountRuleInput } from "../../lib/admin-revenue";

/** The rule of a discount as one readable sentence, so the admin checks what they built in words. */
export function RuleSentence({ rule }: { rule: DiscountRuleInput }) {
  return (
    <p
      className="rounded-lg bg-primary-soft px-4 py-3 text-base text-text"
      data-testid="rule-sentence"
    >
      <span className="font-semibold">{t("admin.revenue.rule.heading")} </span>
      {discountSentence(rule)}
    </p>
  );
}
