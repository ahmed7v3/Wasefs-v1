import { ERROR_CODES, ERROR_INFO, type ErrorCode } from "../errors/codes.js";

type ErrorMessageKey = `error.${ErrorCode}`;

const errorMessages = Object.fromEntries(
  ERROR_CODES.map((code) => [`error.${code}`, ERROR_INFO[code].message.ar]),
) as Record<ErrorMessageKey, string>;

// Default locale. Keys are the source of truth; `en.ts` is typed against them.
export const ar = {
  "brand.name": "وصفة AI",
  "brand.tagline": "مساعدك الطبي الذكي لتحليل الروشتات بدقة وسرعة",
  "common.errorRef": "رمز الخطأ: {ref}",
  "common.contactSupport": "تواصل مع الدعم",
  "common.retry": "حاول مرة أخرى",
  "common.backHome": "العودة للرئيسية",
  "common.skipToContent": "تخطَّ إلى المحتوى الرئيسي",
  "meta.title": "وصفة AI | مساعدك الطبي الذكي لتحليل الروشتات",
  "meta.description":
    "وصفة AI مساعد طبي ذكي بالعربية: ارفع صورة الروشتة المكتوبة بخط اليد أو المطبوعة واحصل على تحليل واضح لأسماء الأدوية والجرعات والتحذيرات.",
  "notFound.title": "الصفحة غير موجودة",
  "notFound.body": "لم نعثر على الصفحة التي تبحث عنها.",
  "errorPage.title": "حدث خطأ غير متوقع",
  "errorPage.body": "نعتذر عن ذلك، وقد سجّلنا المشكلة. حاول مرة أخرى، وإن استمرت تواصل مع الدعم.",
  "home.badge": "قريبًا",
  "home.headline": "افهم روشتتك في ثوانٍ",
  "home.valueProp":
    "ارفع صورة الروشتة واحصل على تحليل دقيق بالعربية: اسم الدواء، الجرعة، عدد المرات، المدة والتحذيرات.",
  "home.pill.accuracy": "دقة تراجع نفسها",
  "home.pill.privacy": "خصوصية وأمان",
  "home.pill.arabic": "عربي أولًا",
  "home.disclaimer": "وصفة AI أداة مساعدة ولا تغني عن استشارة الطبيب أو الصيدلي.",
  ...errorMessages,
} as const;

export type MessageKey = keyof typeof ar;
