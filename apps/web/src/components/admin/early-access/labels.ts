import { fromMinor } from "@wasfa/shared/money";
import { arabCountry } from "@wasfa/shared/schemas/early-access";

import type {
  EarlyDevice,
  EarlyEventType,
  EarlyFeature,
  EarlyProbeAnswer,
  EarlyRole,
  EarlySignupStatus,
} from "@wasfa/shared/schemas/early-access";

/*
 * Every Arabic label of the early-access dashboard in one map (the page is admin-only and Arabic-only,
 * so the wording lives next to the dashboard instead of the shared dictionary).
 */

export const ROLE_LABEL: Record<EarlyRole, string> = {
  patient: "مريض",
  caregiver: "مرافق لمريض",
  doctor: "طبيب",
  pharmacist: "صيدلي",
  pharmacy_owner: "صاحب صيدلية",
  clinic_owner: "صاحب عيادة",
  medical_student: "طالب طب",
  other: "أخرى",
};

export const FEATURE_LABEL: Record<EarlyFeature, string> = {
  handwriting: "قراءة خط اليد",
  whatsapp_bot: "بوت واتساب",
  pdf_reports_reminders: "تقارير PDF وتذكيرات",
  no_download: "بدون تحميل تطبيق",
  mobile_apps: "تطبيقات الموبايل",
  ai_assistant: "مساعد ذكي",
  rx_details: "تفاصيل الأدوية",
};

export const STATUS_LABEL: Record<EarlySignupStatus, string> = {
  new: "جديد",
  contacted: "تم التواصل",
  invited: "تمت الدعوة",
  converted: "تحوّل لمستخدم",
};

export const ANSWER_LABEL: Record<EarlyProbeAnswer, string> = {
  yes: "نعم",
  maybe: "ربما",
  no: "لا",
};

export const DEVICE_LABEL: Record<EarlyDevice, string> = {
  mobile: "موبايل",
  tablet: "تابلت",
  desktop: "كمبيوتر",
};

export const EVENT_LABEL: Record<EarlyEventType, string> = {
  view: "زيارة الصفحة",
  phone_focus: "بدأ كتابة الرقم",
  phone_submit: "سجّل رقمه",
  details_view: "فتح الخطوة الثانية",
  details_submit: "أكمل بياناته",
  share: "شارك الرابط",
};

export const VARIANT_LABEL: Record<string, string> = {
  a: "العنوان A",
  b: "العنوان B",
  c: "العنوان C",
};

export const RANGE_LABEL = {
  today: "اليوم",
  "7d": "٧ أيام",
  "30d": "٣٠ يوم",
  custom: "مخصص",
} as const;

export const SOURCE_PRESETS = [
  { id: "meta", label: "Meta", utm: { source: "facebook", medium: "paid_social" } },
  { id: "google", label: "Google", utm: { source: "google", medium: "cpc" } },
  { id: "tiktok", label: "TikTok", utm: { source: "tiktok", medium: "paid_social" } },
  { id: "whatsapp", label: "WhatsApp", utm: { source: "whatsapp", medium: "social" } },
  { id: "qr", label: "QR", utm: { source: "qr", medium: "offline" } },
] as const;

export function countryName(iso: string | null | undefined): string {
  if (!iso) return "—";
  return arabCountry(iso)?.nameAr ?? iso;
}

/** A label from a record; unknown values (added later) show raw instead of a hole. */
export function labelOf<K extends string>(
  map: Record<K, string>,
  key: string | null | undefined,
): string {
  if (!key) return "—";
  return Object.hasOwn(map, key) ? map[key as K] : key;
}

export const T = {
  title: "قائمة الانتظار المبكرة",
  open: "فتح صفحة الإطلاق",
  loading: "جارٍ التحميل",
  empty: "لا توجد بيانات في هذه الفترة.",
  retry: "إعادة المحاولة",
  tabs: { overview: "نظرة عامة", campaigns: "الحملات", signups: "المسجلون", settings: "الإعدادات" },
  filters: {
    campaign: "الحملة",
    allCampaigns: "كل الحملات",
    country: "الدولة",
    allCountries: "كل الدول",
    city: "المدينة",
    role: "الصفة",
    allRoles: "كل الصفات",
    device: "الجهاز",
    allDevices: "كل الأجهزة",
    source: "المصدر",
    from: "من",
    to: "إلى",
    clear: "مسح الفلاتر",
  },
  kpi: {
    views: "الزيارات",
    uniqueVisitors: "الزوار الفريدون",
    phoneSubmits: "أرقام مسجلة",
    completed: "أكملوا البيانات",
    conversionRate: "معدل التحويل",
    today: "اليوم",
    invitedJoins: "انضموا بدعوة",
  },
  chart: {
    daily: "الزيارات والتسجيلات يوميًا",
    views: "زيارات",
    signups: "تسجيلات",
    funnel: "مسار التحويل",
    drop: "فقد",
    countries: "الدول",
    cities: "مدن",
    clearCountry: "إلغاء فلتر الدولة",
    roles: "الصفات",
    devices: "الأجهزة",
    sources: "المصادر",
    features: "أكثر الميزات طلبًا",
    priceCurve: "منحنى الطلب على السعر",
    priceCurveHint: "نسبة من وافقوا على السعر المعروض عليهم (n = عدد الإجابات).",
    yes: "نعم",
    yesMaybe: "نعم + ربما",
    fairPrice: "السعر العادل المقترح",
    freeOnly: "مجاني فقط",
    variants: "نسخ العنوان",
    variantCol: "النسخة",
    viewsCol: "زيارات",
    signupsCol: "تسجيلات",
    crCol: "التحويل",
    noData: "لا بيانات",
    perMonth: "شهريًا",
  },
  campaigns: {
    name: "الاسم",
    slug: "المعرف",
    views: "زيارات",
    signups: "تسجيلات",
    completed: "أكملوا",
    cr: "التحويل",
    active: "الحالة",
    on: "مفعّل",
    off: "متوقف",
    activate: "تفعيل",
    deactivate: "إيقاف",
    new: "رابط جديد",
    direct: "بدون حملة",
    create: "إنشاء الرابط",
    cancel: "إلغاء",
    nameField: "اسم الحملة",
    slugField: "المعرف في الرابط",
    preset: "قالب المصدر",
    utmSource: "utm_source",
    utmMedium: "utm_medium",
    utmCampaign: "utm_campaign",
    utmContent: "utm_content",
    utmTerm: "utm_term",
    created: "تم إنشاء الرابط",
    finalUrl: "الرابط النهائي",
    copy: "نسخ الرابط",
    copied: "تم النسخ",
    qr: "تنزيل QR",
    failed: "تعذّر تنفيذ العملية",
    links: "الروابط",
  },
  signups: {
    date: "التاريخ",
    name: "الاسم",
    phone: "الهاتف",
    place: "الدولة والمدينة",
    role: "الصفة",
    probe: "السعر المعروض",
    fair: "السعر العادل",
    features: "الميزات",
    source: "الحملة / المصدر",
    invited: "دعا",
    status: "الحالة",
    search: "بحث بالاسم أو الهاتف",
    allStatuses: "كل الحالات",
    statusFilter: "الحالة",
    completedFilter: "اكتمال البيانات",
    completedAll: "الكل",
    completedYes: "أكملوا",
    completedNo: "لم يكملوا",
    reveal: "إظهار الرقم",
    hide: "إخفاء الرقم",
    total: "الإجمالي",
    page: "صفحة",
    of: "من",
    prev: "السابق",
    next: "التالي",
    drawerTitle: "بيانات المسجّل",
    note: "ملاحظة الإدارة",
    save: "حفظ",
    saved: "تم الحفظ",
    map: "فتح الخريطة",
    free: "مجاني فقط",
    empty: "لا يوجد مسجلون بهذه المعايير.",
    open: "تفاصيل",
  },
  fields: {
    phone: "الهاتف",
    phoneCountry: "دولة الرقم",
    name: "الاسم",
    role: "الصفة",
    probe: "السعر المعروض",
    probeAnswer: "الإجابة",
    fair: "السعر العادل",
    features: "الميزات",
    refCode: "كود الدعوة",
    invited: "عدد المدعوين",
    referredBy: "دُعي بواسطة",
    country: "الدولة",
    region: "المنطقة",
    city: "المدينة",
    timezone: "المنطقة الزمنية",
    coords: "الإحداثيات التقريبية",
    device: "الجهاز",
    browser: "المتصفح",
    os: "النظام",
    lang: "اللغة",
    referrer: "المصدر المُحيل",
    utm: "UTM",
    campaign: "الحملة",
    variant: "نسخة العنوان",
    timeToSubmit: "الوقت حتى التسجيل",
    steps: "الخطوات المكتملة",
    createdAt: "تاريخ التسجيل",
    updatedAt: "آخر تحديث",
    seconds: "ثانية",
  },
  export: { signups: "تصدير المسجلين CSV", events: "تصدير الأحداث CSV", failed: "تعذّر التصدير" },
  settings: {
    title: "إعدادات صفحة الإطلاق",
    lead: "تتحكم هذه الإعدادات في صفحة early.wasfa.online مباشرة.",
    ladders: "قوائم الأسعار الشهرية",
    laddersHint: "أسعار تُعرض كاختبار سعر وكخيارات للسعر العادل، من ٢ إلى ٨ أسعار لكل عملة.",
    addPrice: "إضافة سعر",
    removePrice: "حذف السعر",
    abHeadlines: "اختبار نسخ العنوان (A/B)",
    abHeadlinesHint: "عند الإيقاف يرى الجميع النسخة A.",
    allowFreeOption: "إظهار خيار «المجاني فقط» في سؤال السعر",
    allowFreeOptionHint: "عند إيقافه يختار الزائر سعرًا من السلّم فقط.",
    counterMin: "حد ظهور عدّاد المنضمّين",
    counterMinHint: "لا يظهر العدّاد للزوار إلا بعد أن يبلغ العدد الحقيقي هذا الحد.",
    save: "حفظ الإعدادات",
    saved: "تم حفظ الإعدادات",
    invalid: "تحقق من الأسعار: أرقام موجبة وبحد أقصى خانتين عشريتين، من ٢ إلى ٨ أسعار.",
    failed: "تعذّر حفظ الإعدادات",
  },
} as const;

/** "49" / "49.50" plus the currency code; trailing ".00" is dropped. */
export function formatPrice(priceMinor: number, currency: string): string {
  return `${fromMinor(priceMinor, currency).replace(/\.0+$/, "")} ${currency}`;
}
