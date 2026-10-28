/*
 * Strings of the medication search for people (docs/MEDICATIONS.md section 6): the search page, the
 * detail page and the notices around prices. Prices are information, never an offer to buy.
 */
export const arMedications = {
  "medications.title": "البحث عن دواء",
  "medications.lead":
    "ابحث باسم الدواء أو مادته الفعالة أو الباركود، وشوف السعر التقريبي والبدائل.",
  "medications.search.label": "ابحث عن دواء",
  "medications.search.placeholder": "اسم الدواء أو المادة الفعالة أو الباركود",
  "medications.hint.title": "اكتب اسم الدواء لنبدأ",
  "medications.hint.body":
    "اكتب حرفين على الأقل. جرّب مثلاً: «بانادول» أو Augmentin أو paracetamol، أو رقم الباركود.",
  "medications.hint.barcode": "نبحث بالباركود",
  "medications.loading": "جاري البحث…",
  "medications.noResults.title": "لم نجد دواءً بهذا الاسم",
  "medications.noResults.body":
    "راجع الإملاء، أو ابحث بالمادة الفعالة (مثل paracetamol) بدل الاسم التجاري.",
  "medications.featureOff.title": "البحث عن الأدوية غير متاح الآن",
  "medications.featureOff.body":
    "نعمل على إعادته قريباً. يمكنك تحليل روشتة أو سؤال المساعد في هذه الأثناء.",
  "medications.rateLimited": "بحثت كثيراً في وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.",
  "medications.loadMore": "عرض المزيد",
  "medications.resultsLabel": "نتائج البحث عن الأدوية",
  "medications.open": "تفاصيل {name}",
  "medications.price.approx": "≈ {price}",
  "medications.price.updated": "آخر تحديث {date}",
  "medications.field.ingredients": "المادة الفعالة",
  "medications.field.strength": "التركيز",
  "medications.field.form": "الشكل",
  "medications.field.pack": "العبوة",
  "medications.field.units": "عدد الوحدات",
  "medications.field.manufacturer": "الشركة المصنّعة",
  "medications.field.category": "الفئة",
  "medications.field.barcode": "الباركود",
  "medications.field.price": "السعر",
  "medications.detail.back": "رجوع للبحث",
  "medications.detail.priceNote": "سعر تقريبي، آخر تحديث {date}",
  "medications.detail.oldPrice": "السعر السابق: {price}",
  "medications.detail.alternatives.title": "بدائل بنفس المادة الفعالة",
  "medications.detail.alternatives.lead": "من الأرخص إلى الأغلى. اسأل الصيدلي قبل تغيير أي دواء.",
  "medications.detail.alternatives.empty": "لا توجد بدائل مسجّلة لهذا الدواء.",
  "medications.detail.analyze": "حلّل روشتة",
  "medications.detail.ask": "اسأل المساعد",
  "medications.detail.disclaimer":
    "هذه المعلومات للاطلاع فقط ولا تغني عن الطبيب أو الصيدلي. اتبع دائماً تعليمات طبيبك.",
} as const;
