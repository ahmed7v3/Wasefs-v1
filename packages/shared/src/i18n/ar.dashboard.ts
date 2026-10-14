/*
 * Strings of the dashboard v2 (Phase 2, Task 2.12): quick capture, credits, recent work and the
 * six tools. The verification banner and the invitations keep their `dashboard.verify.*` and
 * `dashboard.invites.*` keys in `ar.ts`.
 */
export const arDashboard = {
  "dashboard.capture.title": "تصوير سريع",
  "dashboard.capture.lead": "أفلت صورة الروشتة أو الصقها هنا وننتقل بك إلى التحليل مباشرة.",
  "dashboard.capture.going": "تم رفع الصور، ننقلك إلى تحليل الروشتة…",

  "dashboard.credits.title": "رصيدك",
  "dashboard.credits.balance": "{balance} كريدت",
  "dashboard.credits.balanceLabel": "الرصيد الحالي",
  "dashboard.credits.plan": "الباقة",
  "dashboard.credits.wallet": "المحفظة",
  "dashboard.credits.owner.user": "شخصية",
  "dashboard.credits.owner.org": "المؤسسة",
  "dashboard.credits.monthly": "{count} كريدت شهريًا",
  "dashboard.credits.next": "التجديد القادم",
  "dashboard.credits.todayTitle": "استخدام اليوم",
  "dashboard.credits.todayEmpty": "لا استخدام مسجّل اليوم.",
  "dashboard.credits.used": "{used} من {cap}",
  "dashboard.credits.usedNoCap": "{used} (بلا حد يومي)",
  "dashboard.credits.task.rx_extract": "تحليل الروشتات",
  "dashboard.credits.task.chat": "المحادثات",
  "dashboard.credits.task.deep_think": "الإجابات العميقة",
  "dashboard.credits.task.web_search": "البحث في الويب",

  "dashboard.rx.title": "آخر التحليلات",
  "dashboard.rx.empty": "لا توجد تحليلات بعد",
  "dashboard.rx.emptyHint": "حلّل أول روشتة وستجدها هنا.",
  "dashboard.rx.start": "حلّل روشتة",
  "dashboard.rx.all": "كل التحليلات",
  "dashboard.rx.items": "{count} أدوية",
  "dashboard.rx.noItems": "بلا أدوية",
  "dashboard.rx.status.queued": "في الانتظار",
  "dashboard.rx.status.processing": "قيد القراءة",
  "dashboard.rx.status.verifying": "قيد المراجعة",
  "dashboard.rx.status.done": "جاهز",
  "dashboard.rx.status.failed": "تعذّر",
  "dashboard.rx.status.refunded": "أُعيد الرصيد",

  "dashboard.chats.title": "آخر المحادثات",
  "dashboard.chats.empty": "لا توجد محادثات بعد",
  "dashboard.chats.emptyHint": "اسأل عن دواء أو اشرح تحليلًا وستجد المحادثة هنا.",
  "dashboard.chats.start": "ابدأ محادثة",

  "dashboard.load.failed": "تعذّر تحميل هذا القسم.",

  "dashboard.tools.title": "أدواتك",
  "dashboard.tools.rx.title": "تحليل الروشتة",
  "dashboard.tools.rx.desc": "ارفع صورة الروشتة واحصل على أسماء الأدوية والجرعات والتحذيرات.",
  "dashboard.tools.drug-info.title": "معلومات دواء",
  "dashboard.tools.drug-info.desc": "الاستخدامات والجرعات والتحذيرات والبدائل لأي دواء.",
  "dashboard.tools.lab-test-interpretation.title": "شرح تحليل",
  "dashboard.tools.lab-test-interpretation.desc": "افهم نتيجة التحليل ومعنى كل رقم بلغة بسيطة.",
  "dashboard.tools.imaging-educational.title": "شرح تقرير أشعة",
  "dashboard.tools.imaging-educational.desc": "تبسيط مصطلحات تقرير الأشعة لأغراض التوعية.",
  "dashboard.tools.dose-calculator.title": "حاسبة جرعة",
  "dashboard.tools.dose-calculator.desc": "احسب الجرعة المناسبة بحسب العمر والوزن.",
  "dashboard.tools.drug-interaction-check.title": "تداخلات الأدوية",
  "dashboard.tools.drug-interaction-check.desc": "اعرف إن كانت أدويتك تتعارض مع بعضها.",
  "dashboard.tools.open": "افتح",
} as const;
