/*
 * Strings of the conversion engine (Phase 3, Task 3.14; docs/GROWTH-STRATEGY.md). `growth.prompt.*`
 * are the value-moment cards (one key per kind and variant), `growth.cta.*` their buttons,
 * `growth.taste.*` the free Deep try, `growth.value.*` the value ledger, and `email.lifecycle.*` the
 * marketing mails. The rule of GROWTH §4 applies to every line: say what the product does, never
 * what could happen to the reader's health, no pressure and no confirm-shaming. Arabic is the source.
 */
export const arGrowth = {
  "growth.prompt.analysis_taste.a":
    "حلّلنا روشتتك. {count} بنود تحتاج تدقيقًا. التحليل العميق يراجعها بدقة أعلى، جرّبه مجانًا هذه المرة.",
  "growth.prompt.analysis_taste.b":
    "في روشتتك {count} بنود غير مؤكدة. جرّب التحليل العميق عليها مجانًا مرة واحدة هذا الأسبوع.",
  "growth.prompt.credits_low.a": "استهلكت {used} من {total} رصيدًا هذا الشهر.",
  "growth.prompt.credits_low.b": "بقي لك {left} رصيدًا هذا الشهر من {total}.",
  "growth.prompt.credits_out.a":
    "انتهى رصيدك المجاني. يتجدد في {date}، أو يمكنك شراء رصيد إضافي الآن.",
  "growth.prompt.credits_out.b": "رصيدك يتجدد في {date}. إن احتجت قبل ذلك، يمكنك شراء رصيد إضافي.",
  "growth.prompt.locked_feature.deep.a":
    "التحليل العميق يراجع البنود غير المؤكدة بدقة أعلى، وهو متاح في الباقات المدفوعة.",
  "growth.prompt.locked_feature.web_search.a":
    "البحث في الويب يضيف مصادر حديثة إلى إجابات المساعد، وهو متاح في الباقات المدفوعة.",
  "growth.prompt.org_usage.a":
    "فريقك استخدم {analyses} تحليلًا هذا الشهر. باقة العيادة مصممة لفرق العمل وتخفض تكلفة التحليل.",
  "growth.prompt.expiring_free_credits.a": "لديك {credits} رصيدًا ينتهي بعد {days} أيام.",
  "growth.prompt.plan_expiring.a": "باقتك تنتهي بعد {days} أيام. جدّد بنقرة.",
  "growth.cta.taste": "جرّب التحليل العميق مجانًا",
  "growth.cta.pricing": "شاهد الباقات",
  "growth.cta.pack": "اشترِ رصيدًا إضافيًا",
  "growth.cta.renew": "جدّد الآن",
  "growth.cta.analyze": "حلّل روشتة الآن",
  "growth.cta.dismiss": "ليس الآن",
  "growth.prompt.closeLabel": "إغلاق الاقتراح",

  "growth.taste.title": "التحليل العميق مقارنةً بالتحليل الأول",
  "growth.taste.running": "نعيد قراءة الروشتة نفسها بالتحليل العميق…",
  "growth.taste.improved": "البند {index}: كان «{before}» وأصبح «{after}»",
  "growth.taste.same": "لم يتغير هذا البند",
  "growth.taste.summary": "تحسّن {improved} من {total} بنود.",
  "growth.taste.after": "التحليل العميق متاح في باقة {plan} بسعر {price}.",
  "growth.taste.refusal.not_eligible": "التجربة المجانية متاحة مرة واحدة في الأسبوع للحسابات المجانية الموثّقة.",
  "growth.taste.refusal.weekly_limit": "استخدمت تجربتك المجانية لهذا الأسبوع.",
  "growth.taste.refusal.budget": "التجارب المجانية متوقفة مؤقتًا. حاول لاحقًا.",
  "growth.taste.before": "التحليل الأول",
  "growth.taste.deep": "التحليل العميق",
  "growth.taste.improvedLabel": "تحسّن",
  "growth.taste.afterCalm": "التحليل العميق جزء من الباقات المدفوعة، إن احتجته.",

  "growth.value.title": "ما استفدته من وصفة",
  "growth.value.analyses": "حلّلت {count} روشتة",
  "growth.value.drugs": "راجعت {count} دواءً",
  "growth.value.minutes": "وفّرت ≈ {hours} ساعات (تقدير)",
  "growth.value.estimateNote": "الوقت الموفَّر تقدير تقريبي بحسب عدد التحليلات.",
  "growth.proof.analysesThisWeek": "حُلّلت {count} روشتة هذا الأسبوع",
  "growth.proof.mostChosen": "الأكثر اختيارًا",
  "growth.offer.title": "عرض لك",
  "growth.offer.endsAt": "ينتهي في {date}",
  "growth.offer.percent": "خصم {percent}% على الاشتراك",

  "email.lifecycle.unsubscribe": "إلغاء الاشتراك في هذه الرسائل",
  "email.lifecycle.day1_guide.subject": "بدأت؟ هذه طريقة التصوير الأفضل",
  "email.lifecycle.day1_guide.body":
    "لأفضل قراءة: صوّر الروشتة في ضوء جيد، والورقة مسطحة وكاملة داخل الإطار، بدون ظل أو انعكاس. التحليل الأول يستغرق دقيقة تقريبًا.",
  "email.lifecycle.day1_guide.button": "ارفع أول روشتة",
  "email.lifecycle.day3_value.subject": "ما استفدته حتى الآن",
  "email.lifecycle.day3_value.body":
    "حلّلت {analyses} روشتة وراجعت {drugs} دواءً، ووفّرت حوالي {minutes} دقيقة (تقدير تقريبي).",
  "email.lifecycle.day3_value.button": "افتح لوحتك",
  "email.lifecycle.day6_offer.subject": "عرض لك: خصم {percent}% على الشهر الأول",
  "email.lifecycle.day6_offer.body":
    "شكرًا لاستخدامك وصفة. لديك خصم {percent}% على الشهر الأول من أي باقة، صالح حتى {date}. بدون تجديد تلقائي.",
  "email.lifecycle.day6_offer.button": "شاهد العرض",
  "email.lifecycle.winback.subject": "نحتفظ بسجلك. عد متى شئت",
  "email.lifecycle.winback.body":
    "انتهت باقتك، وسجلك محفوظ كما هو. إن أردت العودة، لديك خصم {percent}% صالح حتى {date}.",
  "email.lifecycle.winback.button": "عُد إلى وصفة",
  "email.lifecycle.last_call.subject": "سجلك في وصفة ما زال محفوظًا",
  "email.lifecycle.last_call.body":
    "هذه آخر رسالة منا لفترة. حسابك المجاني يعمل، ورصيدك الشهري يتجدد تلقائيًا متى احتجته.",
  "email.lifecycle.last_call.button": "حلّل روشتة",
  "email.lifecycle.value_recap.subject": "ملخص استخدامك هذا الشهر",
  "email.lifecycle.value_recap.body":
    "هذا الشهر حلّلت {analyses} روشتة وراجعت {drugs} دواءً، ووفّرت حوالي {minutes} دقيقة (تقدير تقريبي).",
  "email.lifecycle.value_recap.button": "افتح لوحتك",

  "growth.unsubscribe.pageTitle": "إلغاء رسائل النصائح والعروض",
  "growth.unsubscribe.lead": "اضغط الزر لإيقاف رسائل النصائح والعروض. ستصلك رسائل الحساب والدفع المهمة كالمعتاد.",
  "growth.unsubscribe.confirm": "إيقاف هذه الرسائل",
  "growth.unsubscribe.title": "تم إلغاء الاشتراك",
  "growth.unsubscribe.body":
    "لن تصلك رسائل العروض والنصائح بعد الآن. رسائل الحساب والدفع المهمة ستصلك كالمعتاد. يمكنك تفعيلها من صفحة حسابك متى شئت.",
  "growth.unsubscribe.invalid": "هذا الرابط غير صالح.",
  "growth.consent.label": "أرسلوا لي نصائح الاستخدام والعروض بالبريد (رسالة واحدة في الأسبوع على الأكثر)",
  "growth.consent.accountLabel": "رسائل النصائح والعروض بالبريد",
  "growth.consent.accountHint": "رسالة واحدة في الأسبوع على الأكثر، ويمكنك الإلغاء بنقرة من أي رسالة.",
} as const;
