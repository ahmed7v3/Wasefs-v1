/*
 * Settings pages of the admin: section titles, Arabic labels, units and a help line for every
 * field (`admin.settings.field.<key>.<path>` and `admin.settings.help.<key>.<path>`). The stored
 * keys and values do not change; this is how they read on screen.
 */
export const arAdminSettings = {
  // Navigation entries of the settings pages that live with their feature.
  "admin.nav.group.payments": "إعداد الدفع",
  "admin.nav.group.notifications": "الإشعارات والتواصل",
  "admin.nav.billingSettings": "إعدادات الفوترة",
  "admin.nav.billingSettings.description":
    "قواعد الطلبات والدفع والاشتراكات، ومراجعة الدفعات اليدوية، وبيانات الشركة على الإيصالات.",
  "admin.nav.growthSettings": "إعدادات النمو والمكافآت",
  "admin.nav.growthSettings.description":
    "تشغيل برنامج الإحالات والنقاط وقواعد السحب والحماية من الاحتيال، وحملات الترقية والعروض والرسائل التسويقية.",
  "admin.nav.notifications": "إعدادات الإشعارات",
  "admin.nav.notifications.description":
    "متى وكيف تصل تنبيهات الإدارة، وتنبيهات واتساب للمسؤولين، وساعات العمل التي تُرسل فيها التذكيرات.",

  // Page chrome.
  "admin.settings.onThisPage": "في هذه الصفحة",
  "admin.settings.unsaved": "لديك تغييرات لم تُحفظ بعد.",
  "admin.settings.discard": "تراجع عن التغييرات",
  "admin.settings.defaultIs": "القيمة الافتراضية: {value}",
  "admin.settings.on": "مفعّل",
  "admin.settings.off": "معطّل",
  "admin.settings.empty": "فارغ",
  "admin.settings.error.tooPrecise": "القيمة أدق من المسموح. استخدم رقمين عشريين على الأكثر.",
  "admin.settings.error.endAfterStart": "يجب أن تكون ساعة النهاية بعد ساعة البداية.",
  "admin.settings.section.more": "إعدادات أخرى",
  "admin.settings.section.more.description": "إعدادات أُضيفت حديثًا ولم تُصنَّف بعد.",

  // Units shown beside a number.
  "admin.settings.unit.bps": "%",
  "admin.settings.unit.minor": "ج.م",
  "admin.settings.unit.minutes": "دقيقة",
  "admin.settings.unit.hours": "ساعة",
  "admin.settings.unit.days": "يوم",
  "admin.settings.unit.months": "شهر",
  "admin.settings.unit.points": "نقطة",
  "admin.settings.unit.credits": "كريدت",
  "admin.settings.unit.egpPerUsd": "ج.م لكل دولار",
  "admin.settings.unit.hourOfDay": "الساعة (0-24)",
  "admin.settings.unit.perHour": "في الساعة",
  "admin.settings.unit.perWeek": "في الأسبوع",
  "admin.settings.unit.perDay": "في اليوم",

  "admin.settings.option.raise": "رفع المبلغ إلى الحد الأدنى",
  "admin.settings.option.refuse": "رفض الطلب",

  // The general page's groups.
  "admin.settings.group.access": "التسجيل والدخول",
  "admin.settings.group.access.description":
    "من يستطيع إنشاء حساب، ووضع الصيانة، وطرق تسجيل الدخول والتحقق من الهاتف.",
  "admin.settings.group.contact": "التواصل والروابط",
  "admin.settings.group.contact.description":
    "قنوات التواصل التي تظهر للزوار، وحسابات المنصة على مواقع التواصل.",
  "admin.settings.group.locale": "اللغة والعملة",
  "admin.settings.group.locale.description":
    "اللغة الافتراضية، وطريقة عرض الأرقام والتواريخ، والعملات المتاحة للدفع.",
  "admin.settings.group.analysis": "التحليل والملفات",
  "admin.settings.group.analysis.description":
    "الاستخدام المجاني، وتكلفة تحليل الروشتة وحدوده، ومدة الاحتفاظ بالصور المرفوعة.",

  // Help of the general keys.
  "admin.settings.help.access.signupOpen":
    "عند إيقافه لا يستطيع أحد إنشاء حساب جديد، ويظل الدخول متاحًا لأصحاب الحسابات الحالية.",
  "admin.settings.help.access.maintenanceMode":
    "يعرض للزوار صفحة «الموقع تحت الصيانة» ويوقف الاستخدام. لوحة الإدارة تبقى متاحة لك.",
  "admin.settings.help.auth.providers.google":
    "«مفعّل» يُظهر زر الدخول بجوجل، و«قريبًا» يُظهره معطّلًا، و«معطّل» يخفيه.",
  "admin.settings.help.auth.providers.facebook":
    "«مفعّل» يُظهر زر الدخول بفيسبوك، و«قريبًا» يُظهره معطّلًا، و«معطّل» يخفيه.",
  "admin.settings.help.auth.blockedEmailDomains":
    "نطاقات بريد لا يُسمح بالتسجيل بها، مثل mailinator.com. تُضاف إلى قائمة النطاقات المؤقتة المحظورة مسبقًا.",
  "admin.settings.help.auth.phoneVerification":
    "طريقة التحقق من رقم الهاتف. «معطّل» يوقف التحقق مؤقتًا لكل المستخدمين.",
  "admin.settings.help.contact.whatsapp": "يظهر زر واتساب في مركز التواصل. اتركه فارغًا لإخفائه.",
  "admin.settings.help.contact.telegram": "اسم المستخدم على تيليجرام بدون @. اتركه فارغًا لإخفائه.",
  "admin.settings.help.locale.defaultLocale": "لغة الموقع لمن لم يختر لغة بعد.",
  "admin.settings.help.locale.westernDigits": "يعرض 123 بدل ١٢٣ في كل الموقع.",
  "admin.settings.help.locale.showHijriDates":
    "يضيف التاريخ الهجري بجانب الميلادي حيث تظهر التواريخ.",
  "admin.settings.help.currency.default":
    "رمز العملة من ثلاثة أحرف، مثل EGP. تُعرض بها الأسعار افتراضيًا، ويجب أن تكون ضمن العملات المفعّلة.",
  "admin.settings.help.currency.enabled":
    "العملات التي يمكن الدفع بها. لا تضف عملة إلا بعد إدخال أسعار الباقات بها.",
  "admin.settings.help.free_tier.monthlyAnalyses":
    "عدد التحليلات التي تُذكر للزائر في صفحة الأسعار وصفحة البداية على أنها مجانية كل شهر.",
  "admin.settings.help.rx.creditsPerPage":
    "يُخصم هذا العدد من رصيد المستخدم عن كل صفحة روشتة يحللها. يظهر له قبل بدء التحليل.",
  "admin.settings.help.rx.maxPages": "أقصى عدد صفحات يمكن رفعها في روشتة واحدة.",
  "admin.settings.help.rx.modelWarnings":
    "يسمح للنموذج بكتابة تنبيهات إضافية في النتيجة (مثل خط غير واضح). أوقفه إن كانت مزعجة.",
  "admin.settings.help.rx.verifyMaxItems":
    "عدد البنود غير المؤكدة التي يعيد النموذج قراءتها للتحقق. رقم أكبر يعني دقة أعلى وتكلفة أكبر.",
  "admin.settings.help.rx.drugMatching":
    "يطابق أسماء الأدوية المقروءة مع قاعدة الأدوية لتصحيح الأسماء واقتراح البدائل.",
  "admin.settings.help.rx.details": "يضيف معلومات كل دواء وملخصًا عامًا للروشتة في النتيجة.",
  "admin.settings.help.uploads.retentionDays":
    "تُحذف صور الروشتات المرفوعة تلقائيًا بعد هذه المدة. النتائج المكتوبة تبقى.",

  // Billing.
  "admin.settings.section.billing.checkout": "الطلبات والدفع",
  "admin.settings.section.billing.checkout.description":
    "كيف يُحسب مبلغ الطلب عند الدفع، وكم يبقى الطلب صالحًا قبل أن ينتهي.",
  "admin.settings.section.billing.subscriptions": "الاشتراكات والتجربة والاسترداد",
  "admin.settings.section.billing.subscriptions.description":
    "ما يحدث عند انتهاء الاشتراك، ومدة طلب الاسترداد، والتجربة المجانية للباقات.",
  "admin.settings.section.billing.review": "مراجعة الدفعات اليدوية والأمان",
  "admin.settings.section.billing.review.description":
    "قواعد مراجعة تحويلات إنستاباي وفودافون كاش، والمبالغ التي تحتاج تأكيدًا إضافيًا.",
  "admin.settings.section.billing.failureSpike": "تنبيه ارتفاع فشل المدفوعات",
  "admin.settings.section.billing.failureSpike.description":
    "يرسل تنبيهًا للمسؤولين إذا فشلت مدفوعات كثيرة في وقت قصير، فغالبًا تكون البوابة متعطلة.",
  "admin.settings.section.billing.company": "بيانات الشركة على الإيصالات",
  "admin.settings.section.billing.company.description":
    "تُطبع على كل إيصال يُرسل للعميل. الحقل الفارغ لا يظهر.",
  "admin.settings.section.billing.fx": "سعر الصرف لحساب الهامش",
  "admin.settings.section.billing.fx.description":
    "تكلفة الذكاء الاصطناعي بالدولار، فيُستخدم هذا السعر في حاسبة الهامش بصفحة الباقات فقط. لا يغيّر أي سعر يدفعه العميل.",
  "admin.settings.field.billing.allowFreeOrders": "السماح بالطلبات المجانية",
  "admin.settings.help.billing.allowFreeOrders":
    "إذا جعل كوبون أو عرض المبلغ صفرًا، يكتمل الطلب دون دفع. عند إيقافه يُرفض الطلب المجاني.",
  "admin.settings.field.billing.minChargeMinor": "أقل مبلغ للدفع",
  "admin.settings.help.billing.minChargeMinor":
    "أقل مبلغ موجب يمكن تحصيله بعد الخصومات. البوابات لا تقبل مبالغ صغيرة جدًا.",
  "admin.settings.field.billing.minChargeMode": "إذا كان المبلغ أقل من الحد الأدنى",
  "admin.settings.help.billing.minChargeMode":
    "«رفع المبلغ» يحصّل الحد الأدنى بدلًا من المبلغ الأصغر، و«رفض الطلب» يطلب من العميل تعديل طلبه.",
  "admin.settings.field.billing.maxTotalDiscountBps": "أقصى خصم إجمالي",
  "admin.settings.help.billing.maxTotalDiscountBps":
    "لا يتجاوز مجموع الخصومات على طلب واحد هذه النسبة من سعره، مهما كانت الكوبونات أو العروض.",
  "admin.settings.field.billing.quoteTtlMinutes": "مدة تثبيت السعر في صفحة الدفع",
  "admin.settings.help.billing.quoteTtlMinutes":
    "يبقى السعر المعروض للعميل ثابتًا هذه المدة، ثم يُعاد حسابه إذا تغيّر سعر أو انتهى عرض.",
  "admin.settings.field.billing.orderTtlHours": "مدة صلاحية الطلب غير المدفوع",
  "admin.settings.help.billing.orderTtlHours":
    "الطلب الذي لم يُدفع خلال هذه المدة ينتهي تلقائيًا. الدفع الذي يصل متأخرًا يُفعَّل رغم ذلك.",
  "admin.settings.field.billing.graceDays": "فترة السماح بعد انتهاء الاشتراك",
  "admin.settings.help.billing.graceDays":
    "يحتفظ العميل بمزايا باقته هذه الأيام بعد انتهاء الاشتراك حتى يجدده، ثم يعود للباقة المجانية.",
  "admin.settings.field.billing.refundWindowDays": "مدة طلب الاسترداد",
  "admin.settings.help.billing.refundWindowDays":
    "عدد الأيام بعد الدفع التي يُسمح فيها بالاسترداد وفق سياسة الاسترداد.",
  "admin.settings.field.billing.trial": "التجربة المجانية",
  "admin.settings.field.billing.trial.credits": "رصيد التجربة",
  "admin.settings.help.billing.trial.credits":
    "رصيد يُمنح مع التجربة المجانية لأي باقة لها أيام تجربة. صفر يوقف التجارب.",
  "admin.settings.field.billing.trial.oncePerPhone": "تجربة واحدة لكل رقم هاتف",
  "admin.settings.help.billing.trial.oncePerPhone":
    "يمنع تكرار التجربة بحسابات جديدة على نفس رقم الهاتف.",
  "admin.settings.field.billing.creditPackValidMonths": "صلاحية باقات الرصيد (غير مستخدم)",
  "admin.settings.help.billing.creditPackValidMonths":
    "لا يؤثر حاليًا. مدة صلاحية الرصيد تُضبط لكل باقة على حدة من صفحة «باقات الرصيد».",
  "admin.settings.field.billing.fourEyesThresholdMinor": "مبلغ يحتاج موافقة مسؤولَين",
  "admin.settings.help.billing.fourEyesThresholdMinor":
    "الدفعات اليدوية بهذا المبلغ أو أكثر تحتاج موافقة مسؤول ثانٍ بعد الأول.",
  "admin.settings.field.billing.reviewSlaMinutes": "المهلة المستهدفة لمراجعة الدفعة",
  "admin.settings.help.billing.reviewSlaMinutes":
    "بعدها تظهر الدفعة «متأخرة» في الطابور، وتصل تذكيرات للمسؤولين خلال ساعات العمل.",
  "admin.settings.field.billing.proofRetentionDays": "مدة الاحتفاظ بصور إثبات الدفع",
  "admin.settings.help.billing.proofRetentionDays":
    "تُحذف صور إثبات التحويل تلقائيًا بعد هذه المدة. تبقى بيانات الدفعة وقرار المراجعة.",
  "admin.settings.field.billing.adminPlanChangeFreshAuthMinor":
    "تغيير باقة مستخدم يحتاج تأكيد كلمة المرور من",
  "admin.settings.help.billing.adminPlanChangeFreshAuthMinor":
    "إذا غيّر مسؤول باقة مستخدم بنفسه وكان سعرها بهذا المبلغ أو أكثر، يُطلب منه تأكيد كلمة المرور.",
  "admin.settings.field.billing.failureSpike.enabled": "تفعيل التنبيه",
  "admin.settings.field.billing.failureSpike.windowMinutes": "الفترة التي تُحسب فيها الأخطاء",
  "admin.settings.help.billing.failureSpike.windowMinutes":
    "يُنظر إلى المدفوعات خلال آخر هذه الدقائق فقط.",
  "admin.settings.field.billing.failureSpike.minFailures": "أقل عدد مدفوعات فاشلة",
  "admin.settings.help.billing.failureSpike.minFailures":
    "لا يُرسل التنبيه قبل هذا العدد من المدفوعات الفاشلة، حتى لا تُنبهك فشلتان عابرتان.",
  "admin.settings.field.billing.failureSpike.rateBps": "نسبة الفشل التي تُطلق التنبيه",
  "admin.settings.help.billing.failureSpike.rateBps":
    "يُرسل التنبيه إذا بلغت نسبة المدفوعات الفاشلة هذه النسبة أو أكثر خلال الفترة.",
  "admin.settings.field.billing.failureSpike.cooldownMinutes": "أقل وقت بين تنبيهين",
  "admin.settings.help.billing.failureSpike.cooldownMinutes":
    "بعد إرسال التنبيه لا يُرسل غيره قبل مرور هذه المدة.",
  "admin.settings.field.billing.company.legalName": "الاسم القانوني للشركة",
  "admin.settings.field.billing.company.address": "العنوان",
  "admin.settings.field.billing.company.taxId": "رقم التسجيل الضريبي",
  "admin.settings.field.billing.fx.usdToEgp": "سعر الدولار",
  "admin.settings.help.billing.fx.usdToEgp": "كم جنيهًا يساوي دولار واحد في حسابات الهامش.",

  // Rewards.
  "admin.settings.section.rewards.status": "تشغيل البرنامج",
  "admin.settings.section.rewards.status.description":
    "مفاتيح التشغيل الرئيسية لبرنامج الإحالات والنقاط.",
  "admin.settings.section.rewards.value": "قيمة النقاط وتحويلها",
  "admin.settings.section.rewards.value.description":
    "كم تساوي النقطة بالمال، وكيف تتحول النقاط إلى رصيد تحليلات، ومتى تنتهي.",
  "admin.settings.section.rewards.earning": "شروط استحقاق المكافآت",
  "admin.settings.section.rewards.earning.description":
    "متى تصبح المكافأة متاحة لصاحبها، والسقف الأسبوعي، وكوبون الشخص المدعو.",
  "admin.settings.section.rewards.withdrawals": "السحب النقدي",
  "admin.settings.section.rewards.withdrawals.description":
    "حدود وشروط سحب النقاط نقدًا. لا يعمل شيء منها قبل تفعيل «السحب النقدي» بالأعلى.",
  "admin.settings.section.rewards.fraud": "الحماية من الاحتيال",
  "admin.settings.section.rewards.fraud.description":
    "حالات تُعلَّق فيها المكافأة تلقائيًا حتى يراجعها مسؤول من صفحة «الاحتيال والتعليق».",
  "admin.settings.field.rewards.enabled": "تفعيل برنامج الإحالات والمكافآت",
  "admin.settings.help.rewards.enabled":
    "يُظهر للمستخدمين رابط الدعوة وصفحة المكافآت ويبدأ احتساب النقاط.",
  "admin.settings.field.rewards.killSwitch": "إيقاف طارئ",
  "admin.settings.help.rewards.killSwitch":
    "يوقف فورًا منح أي مكافأة جديدة وأي طلب سحب، دون حذف النقاط الحالية. استخدمه عند الاشتباه في احتيال.",
  "admin.settings.field.rewards.cashOutEnabled": "السماح بالسحب النقدي",
  "admin.settings.help.rewards.cashOutEnabled":
    "يسمح بتحويل النقاط إلى مال على فودافون كاش أو إنستاباي. اتركه معطّلًا حتى تحسم المعالجة القانونية مع المحاسب. تحويل النقاط إلى رصيد يعمل دائمًا.",
  "admin.settings.field.rewards.tiersEnabled": "تفعيل مستويات المُحيلين",
  "admin.settings.help.rewards.tiersEnabled":
    "يمنح من يُحيل عددًا أكبر من العملاء المدفوعين نسبة مكافأة أعلى حسب المستويات المعرّفة.",
  "admin.settings.field.rewards.pointValueMinor": "قيمة النقطة الواحدة",
  "admin.settings.help.rewards.pointValueMinor":
    "مثلًا 0.10 ج.م تعني أن 1000 نقطة تساوي 100 جنيه عند السحب.",
  "admin.settings.field.rewards.currency": "عملة السحب",
  "admin.settings.help.rewards.currency":
    "العملة التي تُحسب بها قيمة النقاط وتُدفع بها السحوبات، مثل EGP.",
  "admin.settings.field.rewards.pointsPerCredit": "نقاط مقابل كريدت واحد",
  "admin.settings.help.rewards.pointsPerCredit":
    "عدد النقاط التي تتحول إلى كريدت تحليل واحد عندما يحوّل المستخدم نقاطه إلى رصيد.",
  "admin.settings.field.rewards.creditConversionBonusBps": "مكافأة التحويل إلى رصيد",
  "admin.settings.help.rewards.creditConversionBonusBps":
    "رصيد إضافي بهذه النسبة لمن يحوّل نقاطه إلى رصيد بدل سحبها نقدًا.",
  "admin.settings.field.rewards.expireAfterMonths": "انتهاء النقاط غير المستخدمة بعد",
  "admin.settings.help.rewards.expireAfterMonths": "اتركه فارغًا لتبقى النقاط بلا انتهاء.",
  "admin.settings.field.rewards.holdDaysDefault": "مدة تعليق المكافأة قبل إتاحتها",
  "admin.settings.help.rewards.holdDaysDefault":
    "تبقى المكافأة «معلّقة» هذه المدة ثم تصبح متاحة، لتغطية فترة الاسترداد. قواعد المكافآت يمكن أن تحدد مدة مختلفة.",
  "admin.settings.field.rewards.requireFirstUsage": "اشتراط أول استخدام من المدعو",
  "admin.settings.help.rewards.requireFirstUsage":
    "لا يحصل المُحيل على مكافأة التسجيل حتى يحلل الشخص المدعو أول روشتة، فلا تُكافأ الحسابات الوهمية.",
  "admin.settings.field.rewards.weeklyBudgetPoints": "سقف النقاط الأسبوعي للمنصة",
  "admin.settings.help.rewards.weeklyBudgetPoints":
    "إذا تجاوز مجموع المكافآت هذا السقف في أسبوع، تُعلَّق المكافآت الجديدة للمراجعة.",
  "admin.settings.field.rewards.refereeFirstPaymentDiscountBps": "خصم أول دفعة للمدعو",
  "admin.settings.help.rewards.refereeFirstPaymentDiscountBps":
    "كوبون خاص يحصل عليه الشخص المدعو على أول دفعة. صفر يوقف الكوبون.",
  "admin.settings.field.rewards.refereeCouponValidDays": "صلاحية كوبون المدعو",
  "admin.settings.field.rewards.minWithdrawalPoints": "أقل عدد نقاط للسحب",
  "admin.settings.field.rewards.maxWithdrawalPointsPerMonth": "أقصى نقاط تُسحب في الشهر",
  "admin.settings.help.rewards.maxWithdrawalPointsPerMonth": "لكل مستخدم.",
  "admin.settings.field.rewards.minAccountAgeDays": "عمر الحساب المطلوب للسحب",
  "admin.settings.help.rewards.minAccountAgeDays": "الحسابات الأحدث من ذلك لا يمكنها السحب.",
  "admin.settings.field.rewards.destinationCooldownHours": "انتظار وسيلة السحب الجديدة",
  "admin.settings.help.rewards.destinationCooldownHours":
    "رقم المحفظة أو حساب إنستاباي الجديد لا يُستخدم للسحب قبل مرور هذه المدة، فلو سُرق الحساب يكون لصاحبه وقت للتصرف.",
  "admin.settings.field.rewards.fourEyesThresholdPoints": "سحب يحتاج موافقة مسؤولَين",
  "admin.settings.help.rewards.fourEyesThresholdPoints":
    "طلبات السحب بهذا العدد من النقاط أو أكثر تحتاج موافقة مسؤول ثانٍ.",
  "admin.settings.field.rewards.payoutSlaHours": "المهلة المستهدفة لتنفيذ السحب",
  "admin.settings.help.rewards.payoutSlaHours": "بعدها يظهر الطلب متأخرًا في صفحة طلبات السحب.",
  "admin.settings.field.rewards.fraud": "الحماية من الاحتيال",
  "admin.settings.field.rewards.fraud.holdSamePhone": "تعليق المكافأة عند تطابق رقم الهاتف",
  "admin.settings.help.rewards.fraud.holdSamePhone": "إذا كان للمُحيل والمدعو نفس رقم الهاتف.",
  "admin.settings.field.rewards.fraud.holdSamePayer": "تعليق المكافأة عند تطابق من دفع",
  "admin.settings.help.rewards.fraud.holdSamePayer":
    "إذا دفع المُحيل بنفسه عن الشخص المدعو (نفس البطاقة أو المحفظة).",
  "admin.settings.field.rewards.fraud.holdSameDevice": "تعليق المكافأة عند تطابق الجهاز",
  "admin.settings.help.rewards.fraud.holdSameDevice": "إذا سجّل المدعو من نفس جهاز وشبكة المُحيل.",
  "admin.settings.field.rewards.fraud.velocityPerHour": "أقصى تسجيلات بدعوة شخص واحد",
  "admin.settings.help.rewards.fraud.velocityPerHour":
    "إذا سجّل بدعوة شخص واحد أكثر من هذا العدد في ساعة، تُعلَّق كل مكافآته ويصلك تنبيه.",

  // Growth.
  "admin.settings.section.growth.master": "الإيقاف العام",
  "admin.settings.section.growth.master.description": "مفتاح واحد يوقف كل أدوات النمو أدناه معًا.",
  "admin.settings.section.growth.prompts": "رسائل الترقية داخل التطبيق",
  "admin.settings.section.growth.prompts.description":
    "اقتراحات الترقية التي تظهر للمستخدم أثناء الاستخدام، مثل عند نفاد الرصيد.",
  "admin.settings.section.growth.taste": "تجربة ميزة مدفوعة مجانًا",
  "admin.settings.section.growth.taste.description":
    "يحصل مستخدم الباقة المجانية على استخدام واحد مجاني لميزة مدفوعة ليجربها، ضمن سقف للتكلفة.",
  "admin.settings.section.growth.offers": "العروض الشخصية",
  "admin.settings.section.growth.offers.description":
    "عرض ترحيب للمستخدم الجديد، وعرض استرجاع لمن انتهى اشتراكه. تفاصيل الخصم تُضبط في صفحة «العروض».",
  "admin.settings.section.growth.mail": "رسائل البريد التسويقية",
  "admin.settings.section.growth.mail.description":
    "رسائل التعريف والتذكير. تُرسل فقط لمن وافق على الرسائل التسويقية.",
  "admin.settings.section.growth.proof": "الدليل الاجتماعي وقيمة الخدمة",
  "admin.settings.section.growth.proof.description":
    "الأرقام التي تُعرض للمستخدمين لإقناعهم، ومتى تكون كافية لعرضها.",
  "admin.settings.section.growth.experiments": "تجارب النصوص (A/B)",
  "admin.settings.section.growth.experiments.description":
    "متى تُعتبر نتيجة التجربة موثوقة، ومتى تُعلَّم النسخة التي تضر بالأداء.",
  "admin.settings.field.growth.killSwitch": "إيقاف كل أدوات النمو",
  "admin.settings.help.growth.killSwitch":
    "يوقف فورًا رسائل الترقية والتجارب المجانية والعروض الشخصية ورسائل البريد التسويقية.",
  "admin.settings.field.growth.prompts.enabled": "عرض رسائل الترقية",
  "admin.settings.field.growth.prompts.cooldownDays": "الانتظار بعد إغلاق الرسالة",
  "admin.settings.help.growth.prompts.cooldownDays":
    "إذا أغلق المستخدم رسالة لا تظهر له مرة أخرى قبل هذه المدة. تتضاعف المدة كلما أغلقها.",
  "admin.settings.field.growth.prompts.maxCooldownDays": "أقصى مدة انتظار",
  "admin.settings.help.growth.prompts.maxCooldownDays": "حد أعلى لمدة الانتظار بعد تضاعفها.",
  "admin.settings.field.growth.prompts.maxPerSession": "أقصى رسائل في الزيارة الواحدة",
  "admin.settings.field.growth.taste.enabled": "تفعيل التجربة المجانية للميزات",
  "admin.settings.field.growth.taste.weeklyCap": "عدد التجارب للمنصة كلها",
  "admin.settings.help.growth.taste.weeklyCap":
    "يتحكم في التكلفة: بعد هذا العدد تتوقف التجارب حتى الأسبوع التالي.",
  "admin.settings.field.growth.taste.perUserPerWeek": "تجارب لكل مستخدم",
  "admin.settings.field.growth.taste.weeklyBudgetCredits": "ميزانية التجارب الأسبوعية",
  "admin.settings.help.growth.taste.weeklyBudgetCredits":
    "أقصى رصيد تستهلكه التجارب المجانية في الأسبوع، للمنصة كلها.",
  "admin.settings.field.growth.welcomeOffer": "عرض الترحيب",
  "admin.settings.field.growth.welcomeOffer.enabled": "تفعيل عرض الترحيب",
  "admin.settings.help.growth.welcomeOffer.enabled": "عرض خاص يظهر للمستخدم الجديد بعد التسجيل.",
  "admin.settings.field.growth.welcomeOffer.validityHours": "مدة صلاحية عرض الترحيب",
  "admin.settings.field.growth.winback": "عرض الاسترجاع",
  "admin.settings.field.growth.winback.enabled": "تفعيل عرض الاسترجاع",
  "admin.settings.help.growth.winback.enabled": "عرض لمن انتهى اشتراكه ولم يجدده.",
  "admin.settings.field.growth.winback.validityDays": "مدة صلاحية عرض الاسترجاع",
  "admin.settings.field.growth.lifecycle": "رسائل رحلة المستخدم",
  "admin.settings.field.growth.lifecycle.enabled": "تفعيل رسائل رحلة المستخدم",
  "admin.settings.help.growth.lifecycle.enabled":
    "رسائل بريد تلقائية حسب نشاط المستخدم، مثل التعريف بالميزات والتذكير بعد الغياب.",
  "admin.settings.field.growth.marketingMail": "حدود الرسائل التسويقية",
  "admin.settings.field.growth.marketingMail.maxPerWeek": "أقصى رسائل للمستخدم",
  "admin.settings.help.growth.marketingMail.maxPerWeek": "صفر يوقف الرسائل التسويقية.",
  "admin.settings.field.growth.marketingMail.quietHoursAfterSignup": "لا رسائل بعد التسجيل لمدة",
  "admin.settings.help.growth.marketingMail.quietHoursAfterSignup":
    "لا تصل للمستخدم الجديد أي رسالة تسويقية خلال هذه المدة.",
  "admin.settings.field.growth.proof": "عدد المستخدمين",
  "admin.settings.field.growth.proof.minCount": "أقل عدد لعرض «يستخدمه أكثر من …»",
  "admin.settings.help.growth.proof.minCount":
    "لا تظهر عبارة عدد المستخدمين قبل بلوغ هذا العدد، فالرقم الصغير لا يُقنع.",
  "admin.settings.field.growth.mostChosen": "شارة «الأكثر اختيارًا»",
  "admin.settings.field.growth.mostChosen.minSample": "أقل عدد اشتراكات لإظهار الشارة",
  "admin.settings.help.growth.mostChosen.minSample":
    "تظهر شارة «الأكثر اختيارًا» على باقة في صفحة الأسعار بعد هذا العدد من الاشتراكات فقط.",
  "admin.settings.field.growth.value": "الوقت الموفَّر",
  "admin.settings.field.growth.value.minutesSavedPerAnalysis": "الوقت الموفَّر في كل تحليل",
  "admin.settings.help.growth.value.minutesSavedPerAnalysis":
    "تقدير يُعرض للمستخدم في لوحته («وفّرت حوالي … ساعة»). يُوصف دائمًا بأنه تقدير.",
  "admin.settings.field.growth.experiments.guardrailBps": "حد التراجع المقبول",
  "admin.settings.help.growth.experiments.guardrailBps":
    "إذا أضرت نسخة بمقياس مهم (مثل الدفع) أكثر من هذه النسبة، تُعلَّم باللون الأحمر لتوقفها.",
  "admin.settings.field.growth.experiments.minSampleSize": "أقل عدد مشاهدات لكل نسخة",
  "admin.settings.help.growth.experiments.minSampleSize":
    "لا تُعرض النتيجة على أنها موثوقة قبل أن ترى كل نسخة هذا العدد من المستخدمين.",

  // Alerts.
  "admin.settings.alerts.description":
    "تنبيهات الإدارة على واتساب، وساعات العمل التي تُرسل فيها التذكيرات غير العاجلة.",
  "admin.settings.section.alerts.whatsapp": "تنبيهات واتساب للمسؤولين",
  "admin.settings.section.alerts.whatsapp.description":
    "ثلاثة شروط حتى تصل التنبيهات على واتساب: تفعيل هذا الخيار، وربط رقم المنصة من صفحة «ربط واتساب»، وأن يرسل كل مسؤول كلمة «تنبيهات» إلى رقم المنصة من رقمه المؤكَّد ثم يفعّل واتساب في تفضيلاته بصفحة «التنبيهات».",
  "admin.settings.section.alerts.businessHours": "ساعات العمل",
  "admin.settings.section.alerts.businessHours.description":
    "التذكيرات غير العاجلة (مثل الدفعات المنتظرة) تُرسل خلال هذه الساعات فقط. التنبيهات الحرجة تُرسل في أي وقت.",
  "admin.settings.field.alerts.whatsapp.enabled": "إرسال التنبيهات على واتساب",
  "admin.settings.field.alerts.whatsapp.dailyCap": "أقصى رسائل تنبيه",
  "admin.settings.help.alerts.whatsapp.dailyCap":
    "لكل المسؤولين معًا. يحمي رقم المنصة من الحظر بسبب كثرة الرسائل؛ بعده تصل التنبيهات بالقنوات الأخرى فقط.",
  "admin.settings.field.alerts.businessHours.timezone": "المنطقة الزمنية",
  "admin.settings.help.alerts.businessHours.timezone": "مثل Africa/Cairo.",
  "admin.settings.field.alerts.businessHours.startHour": "تبدأ من الساعة",
  "admin.settings.field.alerts.businessHours.endHour": "وتنتهي عند الساعة",
  "admin.settings.field.alerts.businessHours.days": "أيام العمل",
  "admin.settings.help.alerts.businessHours.days":
    "أرقام الأيام: 0 الأحد، 1 الإثنين، 2 الثلاثاء، 3 الأربعاء، 4 الخميس، 5 الجمعة، 6 السبت.",
  // Group legends (shown when a group sits beside other fields).
  "admin.settings.field.billing.failureSpike": "تنبيه ارتفاع فشل المدفوعات",
  "admin.settings.field.billing.company": "بيانات الشركة",
  "admin.settings.field.billing.fx": "سعر الصرف",
  "admin.settings.field.growth.prompts": "رسائل الترقية",
  "admin.settings.field.growth.taste": "التجربة المجانية للميزات",
  "admin.settings.field.growth.experiments": "تجارب النصوص",
  "admin.settings.field.alerts.whatsapp": "تنبيهات واتساب",
  "admin.settings.field.alerts.businessHours": "ساعات العمل",

  // The plans page (/admin/billing/plans).
  "admin.pricing.roster.title": "كل الباقات",
  "admin.pricing.roster.lead":
    "اختر باقة لتعديلها بالأسفل. ترتيب القائمة هو ترتيب الباقات في صفحة الأسعار. الحالة تُظهر ما يراه العملاء الآن.",
  "admin.pricing.roster.noPrice": "لم يُنشر سعر بعد",
  "admin.pricing.roster.perMonth": "{amount} شهريًا",
  "admin.pricing.roster.perMonths": "{amount} كل {months} أشهر",
  "admin.pricing.roster.subscribers": "{count} مشترك نشط",
  "admin.pricing.roster.credits": "{count} كريدت شهريًا",
  "admin.pricing.roster.recommended": "موصى بها",
  "admin.pricing.roster.moveUp": "نقل «{name}» لأعلى",
  "admin.pricing.roster.moveDown": "نقل «{name}» لأسفل",
  "admin.pricing.roster.moved": "تغيّر ترتيب «{name}».",
  "admin.pricing.roster.hide": "إخفاء",
  "admin.pricing.roster.show": "عرض للبيع",
  "admin.pricing.roster.hidden":
    "أُخفيت «{name}»: لم تعد تُباع، ويحتفظ مشتركوها الحاليون بها حتى نهاية مدتهم.",
  "admin.pricing.roster.shown": "أصبحت «{name}» معروضة للبيع.",
  "admin.pricing.roster.deleteBody":
    "لا يمكن التراجع. لا تُحذف باقة عليها مشتركون أو تعيينات أو طلبات سابقة؛ أخفِها بدلًا من ذلك لتتوقف عن البيع.",
  "admin.pricing.plan.section.texts": "الاسم والنصوص",
  "admin.pricing.plan.section.texts.description":
    "ما يراه العميل على بطاقة الباقة في صفحة الأسعار. النص الإنجليزي يظهر لمن يتصفح بالإنجليزية.",
  "admin.pricing.plan.taglineHint": "سطر قصير تحت اسم الباقة يشرح لمن هي.",
  "admin.pricing.plan.badgeHint": "شارة صغيرة على البطاقة، مثل «الأوفر». اتركها فارغة لإخفائها.",
  "admin.pricing.plan.section.audience": "لمن هذه الباقة",
  "admin.pricing.plan.section.audience.description":
    "هل يشتريها الأفراد أم المؤسسات، وهل لها تجربة مجانية، وهل تُبرز في صفحة الأسعار.",
  "admin.pricing.plan.audienceHint":
    "«الأفراد» يشتريها الشخص لنفسه، و«المؤسسات» تشتريها مؤسسة لأعضائها، و«الجميع» للطرفين.",
  "admin.pricing.plan.pinHint": "تُبرز البطاقة في صفحة الأسعار بعلامة «موصى بها». باقة واحدة تكفي.",
  "admin.pricing.plan.section.sale": "الظهور ومواعيد التوفر",
  "admin.pricing.plan.section.sale.description":
    "متى يستطيع العملاء رؤية الباقة وشراؤها. المشتركون الحاليون لا يتأثرون بأي تغيير هنا.",
  "admin.pricing.plan.visibilityHint":
    "«مخفية» توقف البيع فورًا وتخفي الباقة من صفحة الأسعار، ويبقى بإمكانك تعيينها يدويًا لمستخدم.",
  "admin.pricing.plan.availableFrom": "متاحة بدءًا من (اختياري)",
  "admin.pricing.plan.availableFromHint":
    "قبل هذا الموعد لا تظهر الباقة ولا تُباع. اتركه فارغًا لتكون متاحة الآن.",
  "admin.pricing.plan.availableUntil": "متاحة حتى (اختياري)",
  "admin.pricing.plan.availableUntilHint":
    "بعد هذا الموعد يتوقف البيع تلقائيًا. اتركه فارغًا لتبقى متاحة دائمًا.",
  "admin.pricing.plan.sale.now": "الحالة الآن للعملاء:",
  "admin.pricing.plan.sale.on_sale": "معروضة للبيع",
  "admin.pricing.plan.sale.scheduled": "مجدولة",
  "admin.pricing.plan.sale.ended": "انتهى عرضها",
  "admin.pricing.plan.sale.hidden": "مخفية",
  "admin.pricing.plan.sale.startsAt": "تبدأ في {date}",
  "admin.pricing.plan.sale.endsAt": "يتوقف بيعها في {date}",
  "admin.pricing.plan.sale.invalidWindow": "يجب أن يكون موعد النهاية بعد موعد البداية.",
  "admin.pricing.plan.sale.note":
    "المواعيد بتوقيت جهازك. قد تحتاج صفحة الأسعار حتى دقيقة لتعكس التغيير.",
  "admin.plans.assignOnlyNote":
    "هذه الصفحة لمنح باقة يدويًا دون دفع وإنهائها. إنشاء الباقات وتعديلها وتسعيرها وحذفها من صفحة «الباقات والأسعار».",
  "admin.plans.goToPlans": "الباقات والأسعار",
  "admin.reason.invalid_window": "موعد نهاية التوفر يجب أن يكون بعد موعد البداية.",

  // Notification health (/admin/notifications).
  "admin.notify.title": "هل تصل التنبيهات؟",
  "admin.notify.lead":
    "ما حدث لتنبيهات الإدارة في آخر 7 أيام على كل قناة، وسبب عدم وصول ما لم يصل وما عليك فعله.",
  "admin.notify.refresh": "تحديث",
  "admin.notify.channel.in_app": "داخل لوحة الإدارة",
  "admin.notify.channel.email": "البريد الإلكتروني",
  "admin.notify.channel.telegram": "تيليجرام",
  "admin.notify.channel.whatsapp": "واتساب",
  "admin.notify.verdict.working": "يعمل",
  "admin.notify.verdict.partial": "يعمل جزئيًا",
  "admin.notify.verdict.blocked": "لا يصل شيء",
  "admin.notify.verdict.idle": "لا نشاط",
  "admin.notify.count.sent": "وصلت",
  "admin.notify.count.pending": "بالانتظار",
  "admin.notify.count.skipped": "لم تُرسل",
  "admin.notify.count.failed": "فشلت",
  "admin.notify.lastSent": "آخر رسالة وصلت: {date}",
  "admin.notify.neverSent": "لم تصل أي رسالة على هذه القناة خلال الأيام السبعة الماضية.",
  "admin.notify.reasonCount": "{count} {status}",
  "admin.notify.check.done": "تم:",
  "admin.notify.check.todo": "مطلوب:",
  "admin.notify.setup.title": "ما المطلوب لتصلك التنبيهات",
  "admin.notify.setup.email": "التنبيهات بالبريد مفعّلة في تفضيلاتك",
  "admin.notify.setup.emailHint": "فعّل «البريد الإلكتروني» في تفضيلاتك بصفحة «التنبيهات».",
  "admin.notify.setup.telegram": "تيليجرام جاهز (بوت على الخادم ورقم محادثتك)",
  "admin.notify.setup.telegramHint":
    "افتح البوت على تيليجرام واضغط Start، ثم أدخل رقم محادثتك (Chat ID) وفعّل تيليجرام في تفضيلاتك بصفحة «التنبيهات».",
  "admin.notify.setup.waAlerts": "تنبيهات واتساب مفعّلة للمنصة",
  "admin.notify.setup.waAlertsHint":
    "فعّل «إرسال التنبيهات على واتساب» في الإعدادات بالأسفل، وتأكد أن رقم واتساب مربوط في صفحة «ربط واتساب»، وأن WA_ALERTS_ENABLED=true في ملف ⁦.env.prod⁩ على الخادم.",
  "admin.notify.setup.waMine": "واتساب مربوط بحسابك ومفعّل",
  "admin.notify.setup.waMineHint":
    "من رقم هاتفك المؤكَّد في حسابك، أرسل كلمة «تنبيهات» إلى رقم واتساب المنصة، ثم فعّل واتساب في تفضيلاتك. لإيقافها أرسل «إيقاف التنبيهات».",
  "admin.notify.setup.customers": "رسائل واتساب للعملاء مفعّلة",
  "admin.notify.setup.customersHint":
    "إشعارات العملاء (مثل اعتماد الدفعة) تصل بالبريد فقط حتى تفعّل رسائل العملاء من صفحة",
  "admin.notify.optedIn": "عدد المسؤولين الذين وافقوا على تنبيهات واتساب: {count}.",
  "admin.notify.myPrefs": "تفضيلات تنبيهاتي",
  "admin.notify.reason.not_configured":
    "بوت تيليجرام غير مضبوط على الخادم: أضف ALERT_TELEGRAM_BOT_TOKEN إلى ملف ⁦.env.prod⁩ ثم أعد تشغيل خدمة worker.",
  "admin.notify.reason.no_chat_id":
    "مسؤول فعّل تيليجرام دون أن يُدخل رقم محادثته (Chat ID) في تفضيلاته.",
  "admin.notify.reason.disabled": "تنبيهات واتساب معطّلة للمنصة. فعّلها من الإعدادات بالأسفل.",
  "admin.notify.reason.not_opted_in":
    "مسؤول فعّل واتساب دون أن يرسل كلمة «تنبيهات» إلى رقم المنصة من رقمه المؤكَّد.",
  "admin.notify.reason.cap_reached":
    "بلغت تنبيهات واتساب سقفها اليومي، فوصلت بالقنوات الأخرى فقط. يمكنك رفع السقف بالأسفل.",
  "admin.notify.reason.unsafe_text":
    "لم يُرسل التنبيه على واتساب لأن نصه يحتوي على رابط (حماية لرقم المنصة من الحظر).",
  "admin.notify.reason.user_inactive": "حساب المسؤول موقوف أو محذوف.",
  "admin.notify.reason.digest_pending": "جُمع مع تنبيهات متقاربة ليصل في رسالة ملخّصة واحدة.",
  "admin.notify.reason.send_failed":
    "فشل الإرسال بعد 3 محاولات. للبريد: تأكد من ضبط SMTP_HOST وSMTP_USER وSMTP_PASS على الخادم.",
  "admin.notify.reason.telegram_http":
    "رفض تيليجرام الرسالة: تحقق من رمز البوت ورقم المحادثة، وأن المسؤول ضغط Start في البوت.",
  "admin.notify.reason.mail_daily_cap":
    "بلغ البريد حد الإرسال اليومي (MAIL_DAILY_CAP)، وسيُرسل الباقي غدًا.",
} as const;
