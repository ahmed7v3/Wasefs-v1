/*
 * Strings of the «الدعوات والمكافآت» page (Phase 3, Task 3.11, web). The `rewards.*` keys of the
 * activity feed and the events live in `ar.rewards.ts`; these are the page's own labels and the
 * sentences that describe an offer. Arabic is the source; English is typed against it.
 */
export const arReferralsWeb = {
  "nav.rewards": "الدعوات والمكافآت",

  "rewardsPage.title": "الدعوات والمكافآت",
  "rewardsPage.lead": "ادعُ أصدقاءك، وتكسب أنت وهم عند كل خطوة. كل رقم هنا يأتي من الخادم.",
  "rewardsPage.disabled": "برنامج الدعوات متوقف مؤقتًا. رصيدك محفوظ، ولن تُضاف نقاط جديدة الآن.",
  "rewardsPage.points": "{count} نقطة",
  "rewardsPage.listSeparator": "، ",

  // --- Hero: code, link, share ----------------------------------------------------------------------
  "rewardsPage.hero.title": "شارك رابطك",
  "rewardsPage.hero.you": "أنت:",
  "rewardsPage.hero.friend": "وصديقك:",
  "rewardsPage.hero.noOffers": "لا توجد مكافآت دعوة مفعّلة الآن.",
  "rewardsPage.hero.code": "كود الدعوة",
  "rewardsPage.hero.link": "رابط الدعوة",
  "rewardsPage.share.whatsapp": "مشاركة عبر واتساب",
  "rewardsPage.share.telegram": "مشاركة عبر تيليجرام",
  "rewardsPage.share.message":
    "جرّب وصفة AI لقراءة الروشتات والتحقق من الأدوية. سجّل من هنا: {link}",

  // --- What each side gets (one phrase per event) ---------------------------------------------------
  "rewardsPage.reward.fixed_points": "{value} نقطة",
  "rewardsPage.reward.fixed_credits": "{value} رصيد",
  "rewardsPage.reward.percent_of_net_bps": "{value}% من قيمة الدفع",
  "rewardsPage.offer.referrer.referee_verified": "{reward} عند توثيق حساب صديقك",
  "rewardsPage.offer.referrer.first_payment": "{reward} عند أول اشتراك له",
  "rewardsPage.offer.referrer.renewal": "{reward} عند كل تجديد له",
  "rewardsPage.offer.referrer.credit_pack": "{reward} عند شرائه باقة رصيد",
  "rewardsPage.offer.referrer.org_member_joined": "{reward} عند انضمامه إلى مؤسسة",
  "rewardsPage.offer.referee.referee_verified": "{reward} عند توثيق حسابه",
  "rewardsPage.offer.referee.first_payment": "{reward} عند أول اشتراك",
  "rewardsPage.offer.referee.renewal": "{reward} عند كل تجديد",
  "rewardsPage.offer.referee.credit_pack": "{reward} عند شراء باقة رصيد",
  "rewardsPage.offer.referee.org_member_joined": "{reward} عند انضمامه إلى مؤسسة",
  "rewardsPage.offer.referee.discount": "خصم {percent}% على أول اشتراك",

  // --- Balance --------------------------------------------------------------------------------------
  "rewardsPage.balance.title": "رصيد النقاط",
  "rewardsPage.balance.cash": "نقاط نقدية",
  "rewardsPage.balance.cashValue": "تساوي {value}",
  "rewardsPage.balance.creditOnly": "نقاط للرصيد فقط",
  "rewardsPage.balance.creditOnlyNote": "تتحول إلى رصيد تحليلات فقط",
  "rewardsPage.balance.pending": "قيد الانتظار",
  "rewardsPage.balance.pendingIn": "ستُضاف خلال {days} يوم",
  "rewardsPage.balance.debt":
    "عليك {count} نقطة من مكافآت مستردة، وتُخصم من مكافآتك القادمة قبل أن تصل إلى رصيدك.",

  "rewardsPage.convert.open": "تحويل إلى رصيد",
  "rewardsPage.convert.bonusBadge": "+{percent}% رصيد إضافي عند التحويل",
  "rewardsPage.convert.title": "تحويل النقاط إلى رصيد",
  "rewardsPage.convert.lead":
    "نستخدم النقاط المخصصة للرصيد أولًا ثم النقاط النقدية. تُضاف الأرصدة إلى حسابك فور التأكيد.",
  "rewardsPage.convert.field": "عدد النقاط",
  "rewardsPage.convert.available": "المتاح للتحويل: {count} نقطة",
  "rewardsPage.convert.invalid": "اكتب عددًا صحيحًا من النقاط.",
  "rewardsPage.convert.all": "تحويل كل النقاط",
  "rewardsPage.convert.calculating": "جارٍ الحساب…",
  "rewardsPage.convert.rate": "كل {rate} نقاط تعطيك رصيدًا واحدًا، وتظهر النتيجة هنا قبل التأكيد.",
  "rewardsPage.convert.youGet": "ستحصل على {credits} رصيد",
  "rewardsPage.convert.bonus": "تشمل مكافأة التحويل {percent}%.",
  "rewardsPage.convert.from": "من النقاط للرصيد فقط: {creditOnly}، ومن النقاط النقدية: {cash}",
  "rewardsPage.convert.previewFailed": "تعذر حساب الرصيد الآن، جرّب مرة أخرى.",
  "rewardsPage.convert.confirm": "تأكيد التحويل",
  "rewardsPage.convert.done": "تمت إضافة {credits} رصيد إلى حسابك",

  "rewardsPage.withdraw.open": "سحب",
  "rewardsPage.withdraw.progress": "التقدم نحو الحد الأدنى للسحب",
  "rewardsPage.withdraw.needMore":
    "تحتاج {missing} نقطة نقدية أخرى للوصول إلى الحد الأدنى للسحب ({minimum} نقطة).",
  "rewardsPage.withdraw.off": "السحب النقدي غير متاح حاليًا.",
  "rewardsPage.withdraw.soon": "طلب السحب النقدي سيتوفر هنا قريبًا.",

  // --- Progress ---------------------------------------------------------------------------------------
  "rewardsPage.progress.title": "تقدّمك",
  "rewardsPage.progress.invited": "سجّلوا",
  "rewardsPage.progress.verified": "وثّقوا حساباتهم",
  "rewardsPage.progress.paid": "اشتركوا",
  "rewardsPage.progress.tier": "مستواك:",
  "rewardsPage.progress.noTier": "بداية الطريق",
  "rewardsPage.progress.next": "بقي {missing} اشتراكات لتصل إلى «{name}» وتزيد مكافآتك {bonus}%.",
  "rewardsPage.progress.top": "وصلت إلى أعلى مستوى.",

  // --- Activity ---------------------------------------------------------------------------------------
  "rewardsPage.activity.title": "النشاط",
  "rewardsPage.activity.empty": "لا توجد حركة بعد",
  "rewardsPage.activity.emptyHint": "ستظهر هنا نقاطك عندما يسجّل أصدقاؤك ويوثّقون حساباتهم.",
  "rewardsPage.activity.releaseAt": "تُتاح في {date}",
  "rewardsPage.activity.more": "عرض المزيد",
  "rewardsPage.bucket.pending": "قيد الانتظار",
  "rewardsPage.bucket.cash": "نقدية",
  "rewardsPage.bucket.credit_only": "للرصيد فقط",

  // --- One-time custom code -----------------------------------------------------------------------------
  "rewardsPage.vanity.open": "تخصيص الكود",
  "rewardsPage.vanity.used": "تم تخصيص الكود",
  "rewardsPage.vanity.title": "تخصيص كود الدعوة",
  "rewardsPage.vanity.lead": "اختر كودًا يسهل تذكره، من 3 إلى 20 حرفًا إنجليزيًا أو رقمًا.",
  "rewardsPage.vanity.field": "الكود الجديد",
  "rewardsPage.vanity.hint": "حروف إنجليزية وأرقام فقط.",
  "rewardsPage.vanity.once": "يمكنك تغيير الكود مرة واحدة فقط، فتأكد منه قبل الحفظ.",
  "rewardsPage.vanity.confirm": "حفظ الكود",
  "rewardsPage.vanity.saved": "أصبح كودك {code}",

  // --- How it works -----------------------------------------------------------------------------------
  "rewardsPage.how.title": "كيف يعمل؟",
  "rewardsPage.how.verified":
    "تُحتسب الدعوة بعد أن يوثّق صديقك بريده الإلكتروني ورقم هاتفه، وقد نطلب منه أن يُكمل أول تحليل له.",
  "rewardsPage.how.hold":
    "تبقى المكافآت قيد الانتظار حتى {days} يومًا للتأكد من عدم استرداد الدفع، ثم تصبح متاحة.",
  "rewardsPage.how.noHold": "تصبح المكافآت متاحة فور احتسابها.",
  "rewardsPage.how.convert":
    "كل {rate} نقاط تتحول إلى رصيد واحد، مع مكافأة إضافية {percent}% عند التحويل.",
  "rewardsPage.how.convertNoBonus": "كل {rate} نقاط تتحول إلى رصيد واحد.",
  "rewardsPage.how.withdraw":
    "يمكن سحب النقاط النقدية فقط، بحد أدنى {minimum} نقطة وبعد مرور {days} أيام على إنشاء حسابك.",
  "rewardsPage.how.withdrawSoon": "السحب النقدي سيتوفر هنا قريبًا.",
  "rewardsPage.how.held":
    "قد نراجع مكافأة قبل إضافتها إذا بدت غير معتادة، مثل حسابات متكررة من الجهاز نفسه.",
  "rewardsPage.how.notMoney": "النقاط مكافأة وليست مالًا: لا تُحوَّل لشخص آخر ولا تُشترى.",

  // --- Reasons ------------------------------------------------------------------------------------------
  "rewardsPage.reason.vanity_used": "سبق أن خصّصت كودك مرة، ولا يمكن تغييره ثانية.",
  "rewardsPage.reason.code_taken": "هذا الكود مستخدم، اختر غيره.",
  "rewardsPage.reason.reserved_code": "لا يمكن استخدام هذا الكود، اختر غيره.",
  "rewardsPage.reason.insufficient_points": "نقاطك المتاحة أقل من العدد المطلوب.",
  "rewardsPage.reason.below_minimum": "هذا العدد صغير جدًا ولا يعطي رصيدًا كاملًا.",
  "rewardsPage.reason.open_reward_debt": "لا يمكن التحويل الآن لأن عليك مكافآت مستردة تُخصم أولًا.",
  "rewardsPage.reason.idempotency_key_reused": "تعذر تأكيد هذا الطلب، أعد المحاولة.",
} as const;
