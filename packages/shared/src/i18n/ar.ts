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
  "notFound.title": "الصفحة غير موجودة",
  "notFound.body": "لم نعثر على الصفحة التي تبحث عنها.",
  ...errorMessages,
} as const;

export type MessageKey = keyof typeof ar;
