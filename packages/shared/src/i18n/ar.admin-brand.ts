/* Admin: brand symbol and icon set, homepage settings (`landing`), apps waitlist (BRAND-AND-HOMEPAGE §1.4, §3.6). */
export const arAdminBrand = {
  // Settings > homepage (the `landing` key)
  "admin.settings.group.homepage": "الصفحة الرئيسية",
  "admin.settings.group.homepage.description":
    "الأرقام التي تظهر في قسم الدقة، وروابط تطبيقات الجوال، وقائمة الانتظار.",
  "admin.settings.landing.title": "الصفحة الرئيسية",
  "admin.settings.landing.description":
    "أرقام القياس وروابط التطبيقات وقائمة الانتظار. هذه القيم ظاهرة للعامة.",
  "admin.settings.section.landing.proof": "أرقام القياس",
  "admin.settings.section.landing.proof.description":
    "تظهر في قسم الدقة فقط عندما تُملأ. اتركها فارغة حتى تقيسها فعلًا.",
  "admin.settings.section.landing.apps": "تطبيقات أندرويد و iOS",
  "admin.settings.section.landing.apps.description":
    "عند إضافة رابط متجر يتحول زر «قريبًا» إلى زر تنزيل تلقائيًا.",
  "admin.settings.field.landing.proof": "أرقام القياس",
  "admin.settings.field.landing.proof.avgAnalysisSeconds": "متوسط زمن التحليل (بالثواني)",
  "admin.settings.help.landing.proof.avgAnalysisSeconds":
    "اعرض الرقم فقط عندما يكون مقيسًا. اتركه فارغًا لإخفائه.",
  "admin.settings.field.landing.proof.accuracyPercent": "دقة قراءة الحقول (٪)",
  "admin.settings.help.landing.proof.accuracyPercent":
    "اعرض الرقم فقط عندما يكون مقيسًا، من نتيجة تقييم فعلية. اتركه فارغًا لإخفائه.",
  "admin.settings.field.landing.apps": "التطبيقات",
  "admin.settings.field.landing.apps.androidUrl": "رابط التطبيق على أندرويد (https)",
  "admin.settings.help.landing.apps.androidUrl": "اتركه فارغًا حتى يُنشر التطبيق.",
  "admin.settings.field.landing.apps.iosUrl": "رابط التطبيق على iOS (https)",
  "admin.settings.help.landing.apps.iosUrl": "اتركه فارغًا حتى يُنشر التطبيق.",
  "admin.settings.field.landing.apps.waitlistEnabled": "تفعيل نموذج «أبلغني عند الإطلاق»",
  "admin.settings.help.landing.apps.waitlistEnabled":
    "عند التعطيل يختفي النموذج ويرفض الخادم الطلبات.",

  // Branding settings form: theme colour and manifest names
  "admin.settings.field.branding.themeColor": "لون الهوية (#rrggbb)",
  "admin.settings.help.branding.themeColor":
    "يُستخدم لشريط المتصفح على الجوال ولخلفية أيقونة iOS والأيقونة القابلة للقص.",
  "admin.settings.field.branding.manifestName": "اسم التطبيق في المانيفست",
  "admin.settings.field.branding.manifestShortName": "الاسم القصير في المانيفست",

  // Symbol and icon set
  "admin.branding.symbol.title": "رمز الموقع والأيقونات",
  "admin.branding.symbol.description":
    "ارفع رمزًا مربعًا واحدًا فتُنشأ منه كل الأيقونات: أيقونة المتصفح بثلاثة أحجام، وأيقونات الجوال والمانيفست، وأيقونة آبل، والأيقونة القابلة للقص.",
  "admin.branding.symbol.hint":
    "SVG بحجم حتى 10 كيلوبايت بعد التنقية، أو PNG/WebP مربع لا يقل عن 512 بكسل.",
  "admin.branding.symbol.current": "الرمز الحالي",
  "admin.branding.symbol.none": "لم يُرفع رمز بعد، فتظهر الأيقونات الافتراضية.",
  "admin.branding.symbol.currentAlt": "الرمز الحالي",
  "admin.branding.symbol.choose": "اختيار الرمز",
  "admin.branding.symbol.chooseLabel": "اختيار ملف الرمز",
  "admin.branding.symbol.upload": "رفع الرمز وإنشاء الأيقونات",
  "admin.branding.symbol.revert": "استرجاع الرمز السابق",
  "admin.branding.symbol.uploaded": "تم رفع الرمز. جارٍ إنشاء الأيقونات.",
  "admin.branding.symbol.generating": "جارٍ إنشاء الأيقونات…",
  "admin.branding.symbol.generated": "اكتمل إنشاء الأيقونات.",
  "admin.branding.symbol.timeout":
    "لم تظهر الأيقونات الجديدة بعد. قد تكون أيقونة رُفعت يدويًا بعد الرمز فتبقى كما هي، أو أن المعالجة لا تزال جارية.",
  "admin.branding.warning.low_contrast":
    "تنبيه: لون الرمز فاتح على الخلفية البيضاء (التباين أقل من 3:1). قد لا يظهر بوضوح في تبويب المتصفح.",
  "admin.branding.icons.title": "الأيقونات المنشأة",
  "admin.branding.icons.description":
    "كل أيقونة يمكن استبدالها يدويًا. ما رُفع يدويًا بعد آخر رمز لا يُستبدل عند رفع رمز جديد.",
  "admin.branding.icon.favicon_ico": "favicon.ico (16، 32، 48)",
  "admin.branding.icon.icon_48": "icon-48.png",
  "admin.branding.icon.icon_96": "icon-96.png",
  "admin.branding.icon.icon_192": "icon-192.png",
  "admin.branding.icon.icon_512": "icon-512.png",
  "admin.branding.icon.icon_maskable_512": "icon-maskable-512.png",
  "admin.branding.icon.apple_touch_icon": "apple-touch-icon.png (180)",
  "admin.branding.icon.og_default": "صورة المشاركة الافتراضية (1200×630)",
  "admin.branding.icon.logo_en": "الشعار الإنجليزي",
  "admin.branding.icon.logo_mono": "الشعار أحادي اللون",
  "admin.branding.icon.email_logo": "شعار البريد الإلكتروني (PNG)",
  "admin.branding.icon.missing": "غير موجودة بعد: يظهر الشكل الافتراضي.",
  "admin.branding.icon.alt": "معاينة {name}",
  "admin.branding.icon.meta": "{width}×{height} بكسل · {size} كيلوبايت",
  "admin.branding.icon.override": "استبدال",
  "admin.branding.icon.overrideLabel": "استبدال {name}",
  "admin.branding.icon.revert": "استرجاع السابقة",
  "admin.branding.icon.revertLabel": "استرجاع النسخة السابقة من {name}",
  "admin.branding.icon.replaced": "تم تحديث {name}.",
  "admin.branding.icon.reverted": "تم استرجاع النسخة السابقة من {name}.",
  "admin.branding.extras.title": "صور إضافية",
  "admin.branding.extras.description":
    "صورة المشاركة الافتراضية والشعارات البديلة وشعار البريد. كلها اختيارية.",
  "admin.branding.reason.not_square": "يجب أن تكون الصورة مربعة.",
  "admin.branding.reason.too_small": "الصورة أصغر من 512 بكسل.",
  "admin.branding.reason.wrong_size": "مقاس الصورة لا يطابق المطلوب لهذه الأيقونة.",

  // Preview panel
  "admin.branding.preview.title": "معاينة",
  "admin.branding.preview.description": "كيف تظهر الأيقونات في الأماكن التي يراها الزوار.",
  "admin.branding.preview.tabLight": "تبويب المتصفح (فاتح)",
  "admin.branding.preview.tabDark": "تبويب المتصفح (داكن)",
  "admin.branding.preview.google": "نتيجة البحث في جوجل",
  "admin.branding.preview.ios": "الشاشة الرئيسية في iOS",
  "admin.branding.preview.androidCircle": "أندرويد (قناع دائري)",
  "admin.branding.preview.androidSquircle": "أندرويد (قناع مربع مستدير)",
  "admin.branding.preview.card": "بطاقة المشاركة في واتساب وفيسبوك",
  "admin.branding.preview.email": "ترويسة البريد الإلكتروني",
  "admin.branding.preview.siteTitle": "وصفة AI",
  "admin.branding.preview.siteUrl": "wasfa.online",
  "admin.branding.preview.resultTitle": "تحليل الروشتة بالذكاء الاصطناعي",
  "admin.branding.preview.resultSnippet": "ارفع صورة الروشتة واحصل على قراءة منظمة للأدوية.",
  "admin.branding.preview.cardTitle": "وصفة AI",
  "admin.branding.preview.cardText": "اقرأ الروشتة بوضوح.",
  "admin.branding.preview.noImage": "لا توجد صورة",

  // Waitlist page
  "admin.nav.waitlist": "قائمة انتظار التطبيقات",
  "admin.nav.waitlist.description": "من طلب إشعارًا عند إطلاق تطبيق أندرويد و iOS.",
  "admin.waitlist.lead": "العناوين مأخوذة بموافقة صريحة على رسالة الإطلاق. لا تُستخدم لغير ذلك.",
  "admin.waitlist.total": "إجمالي المسجلين: {count}",
  "admin.waitlist.export": "تنزيل CSV",
  "admin.waitlist.empty": "لا أحد في القائمة بعد.",
  "admin.waitlist.col.email": "البريد الإلكتروني",
  "admin.waitlist.col.platform": "المنصة",
  "admin.waitlist.col.locale": "اللغة",
  "admin.waitlist.col.joined": "تاريخ التسجيل",
  "admin.waitlist.col.notified": "أُبلغ",
  "admin.waitlist.platform.android": "أندرويد",
  "admin.waitlist.platform.ios": "iOS",
  "admin.waitlist.platform.both": "كلاهما",
  "admin.waitlist.notified.no": "لا",
} as const;
