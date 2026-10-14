/*
 * Strings of the capture experience (Phase 2, Task 2.6): picking, dropping and pasting prescription
 * photos, the page tray, quality hints, the editor, the phone handoff and the analyze bar.
 * Keys follow `capture.<area>.<thing>`; the dynamic ones (quality issues, reject reasons) are
 * written out in full so the type checker knows every one exists.
 */
export const arCapture = {
  // Empty state and the three ways in
  "capture.empty.title": "ابدأ بتصوير الروشتة",
  "capture.empty.hint": "اختر صورة واضحة أو التقطها الآن. يمكنك إضافة حتى {max} صفحات.",
  "capture.pick": "اختر صورة",
  "capture.addMore": "إضافة صفحة",
  "capture.camera": "التقط صورة",
  "capture.phone": "استخدم هاتفك",
  "capture.pasteHint": "أو الصق صورة (Ctrl+V)",
  "capture.dropZone": "أو اسحب الصورة وأفلتها هنا",
  "capture.tooLarge": "الملف كبير جدًا",

  // Dragging over the window
  "capture.drop.title": "أفلت الصورة هنا",
  "capture.drop.hint": "ستُضاف إلى صفحات الروشتة.",
  "capture.drop.refused": "لا يمكن إضافة هذا الملف",
  "capture.drop.refusedHint": "الأنواع المدعومة: الصور وملفات PDF.",

  // Limits
  "capture.limit.full": "وصلت إلى الحد الأقصى ({max} صفحات)",
  "capture.limit.fullHint": "احذف صفحة لإضافة أخرى.",
  "capture.limit.pdfTrimmed": "أُخذت أول {count} صفحات فقط من ملف PDF",

  // Page tray
  "capture.tray.label": "صفحات الروشتة",
  "capture.tray.count": "{count} من {max}",
  "capture.tray.reorderHint": "للترتيب: ركّز على الصفحة واستخدم مفتاحي السهم يمينًا ويسارًا.",
  "capture.page.label": "الصفحة {n} من {total}",
  "capture.page.alt": "معاينة الصفحة {n}",
  "capture.page.status.processing": "جارٍ التجهيز…",
  "capture.page.status.uploading": "جارٍ الرفع {percent}%",
  "capture.page.status.uploaded": "جاهزة",
  "capture.page.status.error": "تعذّر الرفع",
  "capture.page.status.warning": "تحتاج مراجعة",
  "capture.page.remove": "حذف الصفحة {n}",
  "capture.page.edit": "تعديل الصفحة {n}",
  "capture.page.earlier": "نقل الصفحة {n} إلى الأمام",
  "capture.page.later": "نقل الصفحة {n} إلى الخلف",
  "capture.page.retry": "إعادة المحاولة",
  "capture.page.retryLabel": "إعادة رفع الصفحة {n}",

  // Spoken updates (polite live region)
  "capture.live.added": "أُضيفت الصفحة {n}.",
  "capture.live.addedFromPhone": "وصلت صفحة من هاتفك: الصفحة {n}.",
  "capture.live.removed": "حُذفت الصفحة {n}. المتبقي {total}.",
  "capture.live.moved": "نُقلت الصفحة إلى الموضع {position} من {total}.",
  "capture.live.uploaded": "اكتمل رفع الصفحة {n}.",
  "capture.live.failed": "تعذّر رفع الصفحة {n}.",
  "capture.live.warning": "الصفحة {n} تحتاج مراجعة: {issues}.",
  "capture.live.replaced": "حُدِّثت الصفحة {n} بعد التعديل.",
  "capture.live.offline": "لا يوجد اتصال بالإنترنت. سيستمر الرفع عند عودته.",
  "capture.live.online": "عاد الاتصال بالإنترنت.",
  "capture.live.dragging": "أفلت الملف لإضافته.",

  // Quality hints (no network; a bad photo costs nothing)
  "capture.quality.title.blurry": "الصورة غير واضحة — جرّب الإضاءة أو قرّب الكاميرا",
  "capture.quality.title.dark": "الصورة معتمة — جرّب مكانًا أكثر إضاءة",
  "capture.quality.title.bright": "الصورة شديدة السطوع — تجنّب الوميض والانعكاس",
  "capture.quality.title.low_res": "دقة الصورة منخفضة — قرّب الكاميرا من الورقة",
  "capture.quality.issue.blurry": "الصورة غير حادّة",
  "capture.quality.issue.dark": "الإضاءة ضعيفة",
  "capture.quality.issue.bright": "الإضاءة شديدة",
  "capture.quality.issue.low_res": "الدقة منخفضة",
  "capture.quality.free": "لا يُخصم أي رصيد قبل أن تضغط «تحليل».",
  "capture.quality.retake": "إعادة الالتقاط",
  "capture.quality.continue": "المتابعة على أي حال",
  "capture.quality.preview": "معاينة الصفحة {n}",

  // Upload and processing errors
  "capture.error.title": "تعذّر رفع الصفحة {n}",
  "capture.error.ref": "الرمز المرجعي: {ref}",
  "capture.error.generic": "حدث خطأ أثناء رفع الصورة. حاول مرة أخرى.",
  "capture.error.decode": "تعذّر قراءة هذه الصورة. جرّب صورة أخرى.",
  "capture.error.heic": "تعذّر تحويل صورة HEIC. جرّب التقاطها بصيغة JPEG.",
  "capture.error.pdf": "تعذّر قراءة ملف PDF. جرّب صورة من الروشتة بدلًا منه.",
  "capture.error.reason.unsupported_type": "نوع الملف غير مدعوم.",
  "capture.error.reason.heic_unsupported": "صيغة HEIC غير مدعومة. جرّب التقاط الصورة بصيغة JPEG.",
  "capture.error.reason.corrupt_image": "الصورة تالفة أو غير مقروءة.",
  "capture.error.reason.too_many_pixels": "أبعاد الصورة كبيرة جدًا.",
  "capture.error.reason.pdf_unreadable": "تعذّر قراءة ملف PDF.",
  "capture.error.reason.pdf_multi_page_unsupported": "أضف صفحات PDF واحدة تلو الأخرى.",
  "capture.error.reason.type_mismatch": "نوع الملف لا يطابق ما أُرسل.",
  "capture.error.reason.size_mismatch": "حجم الملف لا يطابق ما أُرسل.",
  "capture.error.reason.upload_missing": "لم يصل الملف. حاول مرة أخرى.",

  // Offline
  "capture.offline.title": "لا يوجد اتصال بالإنترنت",
  "capture.offline.body": "صورك محفوظة هنا، وسيستمر الرفع تلقائيًا عند عودة الاتصال.",

  // Analyze bar
  "capture.analyze.button": "تحليل — {price} رصيد",
  "capture.analyze.free": "تحليل",
  "capture.analyze.balance": "رصيدك: {balance} رصيد",
  "capture.analyze.insufficient": "رصيدك غير كافٍ",
  "capture.analyze.insufficientBody": "التحليل يحتاج {price} رصيد ولديك {balance}.",
  "capture.analyze.support": "تواصل مع الدعم لشحن رصيدك",
  "capture.analyze.working": "جارٍ البدء…",
  "capture.analyze.waitUploads": "انتظر اكتمال رفع الصفحات.",
  "capture.analyze.fixWarnings": "راجع تنبيهات جودة الصور أولًا.",
  "capture.analyze.fixErrors": "أعد رفع الصفحات التي تعذّر رفعها أو احذفها.",
  "capture.analyze.empty": "أضف صفحة واحدة على الأقل.",

  // Editor
  "capture.editor.title": "تعديل الصورة",
  "capture.editor.rotate": "تدوير 90°",
  "capture.editor.reset": "إعادة الضبط",
  "capture.editor.apply": "تطبيق",
  "capture.editor.cancel": "إلغاء",
  "capture.editor.hint": "اسحب حواف القص أو ركّز عليها واستخدم مفاتيح الأسهم (مع Shift لخطوة أكبر).",
  "capture.editor.crop.top": "حافة القص العلوية",
  "capture.editor.crop.bottom": "حافة القص السفلية",
  "capture.editor.crop.left": "حافة القص اليسرى",
  "capture.editor.crop.right": "حافة القص اليمنى",
  "capture.editor.loading": "جارٍ تحميل المحرّر…",
  "capture.editor.failed": "تعذّر تطبيق التعديل.",

  // Desktop to phone
  "capture.handoff.title": "استخدم هاتفك",
  "capture.handoff.body": "امسح الرمز بكاميرا هاتفك والتقط صور الروشتة، وستظهر هنا مباشرةً.",
  "capture.handoff.note": "لن تُحلَّل الصور حتى تضغط «تحليل» هنا.",
  "capture.handoff.qrAlt": "رمز QR يفتح صفحة الالتقاط على هاتفك",
  "capture.handoff.link": "أو افتح هذا الرابط على هاتفك",
  "capture.handoff.copy": "نسخ الرابط",
  "capture.handoff.copied": "تم نسخ الرابط",
  "capture.handoff.starting": "جارٍ إنشاء الرمز…",
  "capture.handoff.waiting": "في انتظار الهاتف…",
  "capture.handoff.connected": "وصلت {count} من {max} صور من هاتفك",
  "capture.handoff.full": "وصلت كل الصور ({max}). يمكنك إغلاق هذه النافذة.",
  "capture.handoff.expiresIn": "ينتهي الرمز خلال {time}",
  "capture.handoff.expired.title": "انتهت صلاحية الرمز",
  "capture.handoff.expired.body": "الرمز يعمل خمس دقائق فقط. اطلب رمزًا جديدًا للمتابعة.",
  "capture.handoff.renew": "رمز جديد",
  "capture.handoff.failed": "تعذّر إنشاء الرمز. حاول مرة أخرى.",
  "capture.handoff.close": "إغلاق",
  "capture.handoff.liveExpired": "انتهت صلاحية الرمز.",

  // The phone page (/capture/<token>)
  "capture.phonePage.title": "التقط صور الروشتة",
  "capture.phonePage.lead": "ستظهر الصور على جهازك الآخر. لن يُحلَّل شيء حتى تضغط «تحليل» هناك.",
  "capture.phonePage.remaining": "يمكنك إضافة {count} صور أخرى",
  "capture.phonePage.sent": "أُرسلت {count} من {max} صور",
  "capture.phonePage.done": "تم! أُرسلت كل الصور. يمكنك العودة إلى جهازك الآخر.",
  "capture.phonePage.sending": "جارٍ إرسال الصورة…",
  "capture.phonePage.failed": "تعذّر إرسال الصورة. حاول مرة أخرى.",
  "capture.phonePage.expired": "انتهت صلاحية الرمز أثناء الإرسال.",
  "capture.phonePage.invalid.title": "هذا الرابط غير صالح أو انتهت صلاحيته",
  "capture.phonePage.invalid.body": "ارجع إلى جهازك الآخر واطلب رمزًا جديدًا، ثم امسحه من جديد.",
  "capture.phonePage.home": "الصفحة الرئيسية",

  // The /analyze page
  "analyze.title": "تحليل الروشتة",
  "analyze.lead": "صوّر الروشتة أو ارفعها، وسنقرأ الأدوية والجرعات في ثوانٍ.",
  "analyze.failed": "تعذّر بدء التحليل.",
} as const;
