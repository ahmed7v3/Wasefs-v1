/*
 * Strings of cash withdrawals (Phase 3, Task 3.12). `rewards.notify.*` are in-app notices (the
 * `user_notifications.kind` is `rewards.<name>`), `rewards.withdrawal.refusal.*` explain each refusal,
 * `rewards.withdrawal.reject.*` are the reasons an admin picks, and the `whatsapp.customer.*` and
 * `email.withdrawal.*` keys are the same events on the customer's other channels. Arabic is the source.
 */
export const arWithdrawals = {
  "rewards.notify.withdrawal_requested": "استلمنا طلب سحب {points} نقطة بقيمة {amount}",
  "rewards.notify.withdrawal_approved":
    "تمت الموافقة على طلب سحب {points} نقطة وسيُحوَّل المبلغ قريبًا",
  "rewards.notify.withdrawal_rejected":
    "تم رفض طلب السحب وأُعيدت {points} نقطة إلى رصيدك: {reason}",
  "rewards.notify.withdrawal_paid": "تم تحويل {amount} إلى وجهة الصرف. رقم العملية: {reference}",
  "rewards.notify.withdrawal_canceled": "تم إلغاء طلب السحب وأُعيدت {points} نقطة إلى رصيدك",
  "rewards.notify.payout_destination_added":
    "أُضيفت وجهة صرف جديدة إلى حسابك. تصبح متاحة للسحب بعد {hours} ساعة. إن لم تكن أنت فغيّر كلمة المرور فورًا.",

  "rewards.withdrawal.reject.suspected_fraud": "اشتباه في نشاط غير سليم",
  "rewards.withdrawal.reject.destination_invalid": "وجهة الصرف غير صحيحة",
  "rewards.withdrawal.reject.account_review": "الحساب قيد المراجعة",
  "rewards.withdrawal.reject.limit_exceeded": "تجاوز حدود السحب",
  "rewards.withdrawal.reject.other": "سبب آخر",

  "rewards.withdrawal.refusal.not_enough_points": "رصيدك النقدي لا يكفي لهذا المبلغ",
  "rewards.withdrawal.refusal.below_minimum": "المبلغ أقل من الحد الأدنى للسحب",
  "rewards.withdrawal.refusal.phone_unverified": "وثّق رقم هاتفك أولًا",
  "rewards.withdrawal.refusal.account_too_new":
    "حسابك جديد؛ يمكنك السحب بعد انقضاء المدة المطلوبة",
  "rewards.withdrawal.refusal.open_request": "لديك طلب سحب قيد المعالجة",
  "rewards.withdrawal.refusal.monthly_cap": "تجاوزت الحد الشهري للسحب",
  "rewards.withdrawal.refusal.cash_out_off": "السحب النقدي غير متاح حاليًا",
  "rewards.withdrawal.refusal.reward_debt": "عليك نقاط مستردة تُخصم من مكافآتك القادمة أولًا",
  "rewards.withdrawal.refusal.destination_cooldown":
    "وجهة الصرف جديدة؛ تصبح متاحة بعد انتهاء مدة الأمان",
  "rewards.withdrawal.refusal.method_disabled": "طريقة الصرف هذه غير متاحة حاليًا",
  "rewards.withdrawal.refusal.amount_out_of_range": "المبلغ خارج حدود طريقة الصرف",
  "rewards.withdrawal.refusal.request_id_reused": "تكرر رقم الطلب لطلب مختلف",

  "rewards.payout.field.number": "رقم المحفظة",
  "rewards.payout.field.address": "عنوان إنستاباي أو رقم الموبايل",
  "rewards.payout.field.iban": "رقم الآيبان (IBAN)",

  "whatsapp.customer.withdrawalRequested":
    "استلمنا طلب سحب {points} نقطة بقيمة {amount}. سنراجعه خلال {hours} ساعة.",
  "whatsapp.customer.withdrawalApproved":
    "تمت الموافقة على طلب سحب {points} نقطة. سيصلك المبلغ {amount} قريبًا.",
  "whatsapp.customer.withdrawalRejected":
    "لم نتمكن من تنفيذ طلب السحب: {reason}. أُعيدت {points} نقطة إلى رصيدك.",
  "whatsapp.customer.withdrawalPaid": "تم تحويل {amount} إلى وجهة الصرف. رقم العملية: {reference}.",
  "whatsapp.customer.withdrawalCanceled": "تم إلغاء طلب السحب وأُعيدت {points} نقطة إلى رصيدك.",
  "whatsapp.customer.payoutDestinationAdded":
    "أُضيفت وجهة صرف جديدة إلى حسابك وتصبح متاحة بعد {hours} ساعة. إن لم تكن أنت فغيّر كلمة المرور فورًا.",

  "email.withdrawal.requested.subject": "استلمنا طلب السحب",
  "email.withdrawal.requested.body":
    "استلمنا طلب سحب {points} نقطة بقيمة {amount} وسنراجعه قريبًا.",
  "email.withdrawal.approved.subject": "تمت الموافقة على طلب السحب",
  "email.withdrawal.approved.body":
    "تمت الموافقة على سحب {points} نقطة بقيمة {amount}، وسيصلك المبلغ قريبًا.",
  "email.withdrawal.rejected.subject": "تعذر تنفيذ طلب السحب",
  "email.withdrawal.rejected.body":
    "تعذر تنفيذ طلب سحب {points} نقطة: {reason}. أُعيدت النقاط إلى رصيدك.",
  "email.withdrawal.paid.subject": "تم تحويل مبلغ السحب",
  "email.withdrawal.paid.body": "تم تحويل {amount} إلى وجهة الصرف. رقم العملية: {reference}.",
  "email.withdrawal.canceled.subject": "تم إلغاء طلب السحب",
  "email.withdrawal.canceled.body": "تم إلغاء طلب السحب وأُعيدت {points} نقطة إلى رصيدك.",
  "email.withdrawal.destination_added.subject": "أُضيفت وجهة صرف جديدة إلى حسابك",
  "email.withdrawal.destination_added.body":
    "أُضيفت وجهة صرف جديدة إلى حسابك، وتصبح متاحة للسحب بعد فترة أمان. إن لم تكن أنت من أضافها فغيّر كلمة المرور فورًا وتواصل مع الدعم.",
  "email.withdrawal.note": "ملاحظة من المراجع: {note}",
  "email.withdrawal.button": "فتح صفحة المكافآت",
} as const;
