/** Plain-language sentence of a reward rule (ADMIN-CONSOLE-SPEC §6.1), assembled by `renderRuleSentence`. */
export const arAdminGrowth = {
  "rewards.rule_sentence.main": "عندما {when}، {who} {reward}.",
  "rewards.rule_sentence.when.referee_verified": "يوثّق المدعو حسابه",
  "rewards.rule_sentence.when.first_payment": "يدفع المدعو لأول مرة",
  "rewards.rule_sentence.when.renewal": "يجدّد المدعو اشتراكه",
  "rewards.rule_sentence.when.credit_pack": "يشتري المدعو باقة رصيد",
  "rewards.rule_sentence.when.org_member_joined": "ينضم المدعو إلى مؤسسة",
  "rewards.rule_sentence.who.referrer": "يحصل الداعي على",
  "rewards.rule_sentence.who.referee": "يحصل المدعو على",
  "rewards.rule_sentence.reward.fixed_points": "{value} نقطة",
  "rewards.rule_sentence.reward.percent_of_net_bps": "{percent}% من المبلغ نقاطًا",
  "rewards.rule_sentence.reward.fixed_credits": "{value} رصيدًا",
  "rewards.rule_sentence.redeem.cash_or_credits": "قابلة للسحب أو للتحويل إلى رصيد",
  "rewards.rule_sentence.redeem.credits_only": "قابلة للتحويل إلى رصيد فقط",
  "rewards.rule_sentence.hold.none": "فورًا",
  "rewards.rule_sentence.hold.days": "بعد {days} يومًا",
} as const;
