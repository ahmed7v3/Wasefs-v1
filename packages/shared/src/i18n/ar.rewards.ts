/*
 * Strings of referrals, points and rewards (Phase 3, Task 3.11). `rewards.notify.*` are the in-app
 * notification texts (the `user_notifications.kind` is `rewards.<name>`), `rewards.activity.*` the
 * lines of the activity feed, `rewards.event.*` what earned a reward. Arabic is the source.
 */
export const arRewards = {
  "rewards.coupon.title": "خصم الدعوة على أول اشتراك",

  "rewards.notify.points_earned": "حصلت على {points} نقطة",
  "rewards.notify.points_released": "أصبحت {points} نقطة متاحة للاستخدام",
  "rewards.notify.credits_earned": "حصلت على {credits} رصيد هدية",
  "rewards.notify.coupon_ready": "كود خصم {percent}% على أول اشتراك: {code}",

  "rewards.event.referee_verified": "تسجيل صديق وتوثيق حسابه",
  "rewards.event.first_payment": "أول اشتراك لصديق",
  "rewards.event.renewal": "تجديد اشتراك صديق",
  "rewards.event.credit_pack": "شراء صديق لباقة رصيد",
  "rewards.event.org_member_joined": "انضمام عضو إلى مؤسسة",

  "rewards.activity.reward_pending": "نقاط قيد الانتظار",
  "rewards.activity.reward_release": "نقاط أصبحت متاحة",
  "rewards.activity.reward_reverse": "نقاط ملغاة",
  "rewards.activity.convert_to_credits": "تحويل نقاط إلى رصيد",
  "rewards.activity.withdraw_hold": "نقاط محجوزة لطلب سحب",
  "rewards.activity.withdraw_paid": "سحب نقدي مدفوع",
  "rewards.activity.withdraw_release": "نقاط أُعيدت من طلب سحب",
  "rewards.activity.admin_adjust": "تعديل من الإدارة",
  "rewards.activity.expiry": "نقاط منتهية الصلاحية",

  // Deals (Task 3.10): why a deal was chosen, and why a candidate lost (admin simulator).
  "deals.why.user": "اتفاق «{name}» مخصص لهذا المستخدم مباشرة",
  "deals.why.org_owner": "اتفاق «{name}» مخصص لمؤسسة {org}",
  "deals.why.org_member": "اتفاق «{name}» طُبّق لأن المستخدم عضو في {org}",
  "deals.why.join_link": "اتفاق «{name}» طُبّق لأن المستخدم انضم عبر رابط دعوة {org}",
  "deals.why.referral_code": "اتفاق «{name}» طُبّق بسبب كود الإحالة {code}",
  "deals.why.email_domain": "اتفاق «{name}» طُبّق على نطاق البريد {domain}",
  "deals.lost.outranked": "اتفاق «{name}» غلبه اتفاق «{winner}» الأعلى أولوية أو الأحدث",
  "deals.lost.no_matching_term": "اتفاق «{name}» لا يحدد سعرًا لهذه الباقة أو المدة أو العملة",
  "deals.lost.membership_expired": "انتهت مدة عضوية اتفاق «{name}»",
  "deals.lost.not_new_member": "اتفاق «{name}» للأعضاء الجدد فقط",
  "deals.lost.billing_mode": "اتفاق «{name}» تدفعه المؤسسة ولا يخفض سعر العضو الشخصي",
  "deals.lost.invalid_terms": "شروط اتفاق «{name}» غير صالحة",
} as const;
