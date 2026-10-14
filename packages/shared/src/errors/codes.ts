export const ErrorCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_CODES = Object.values(ErrorCode);

export type ErrorLocale = "ar" | "en";

export interface ErrorCodeInfo {
  httpStatus: number;
  message: Record<ErrorLocale, string>;
}

// User-facing text only: never mention providers, SQL, or stack details here.
export const ERROR_INFO: Record<ErrorCode, ErrorCodeInfo> = {
  AUTH_REQUIRED: {
    httpStatus: 401,
    message: { ar: "يجب تسجيل الدخول للمتابعة.", en: "Please sign in to continue." },
  },
  FORBIDDEN: {
    httpStatus: 403,
    message: {
      ar: "ليست لديك صلاحية للقيام بهذا الإجراء.",
      en: "You do not have permission to do this.",
    },
  },
  NOT_FOUND: {
    httpStatus: 404,
    message: { ar: "لم نعثر على ما تبحث عنه.", en: "We could not find what you are looking for." },
  },
  CONFLICT: {
    httpStatus: 409,
    message: {
      ar: "لا يمكن تنفيذ هذا الطلب في الحالة الحالية.",
      en: "This request cannot be completed in the current state.",
    },
  },
  VALIDATION_FAILED: {
    httpStatus: 400,
    message: {
      ar: "بعض البيانات المدخلة غير صحيحة. راجعها وحاول مرة أخرى.",
      en: "Some of the data you entered is invalid. Please review it and try again.",
    },
  },
  RATE_LIMITED: {
    httpStatus: 429,
    message: {
      ar: "عدد الطلبات كبير. انتظر قليلاً ثم حاول مرة أخرى.",
      en: "Too many requests. Please wait a moment and try again.",
    },
  },
  QUOTA_EXCEEDED: {
    httpStatus: 403,
    message: {
      ar: "لقد استهلكت الحد المتاح في باقتك. قم بالترقية للمتابعة.",
      en: "You have used the limit of your plan. Upgrade to continue.",
    },
  },
  PAYMENT_REQUIRED: {
    httpStatus: 402,
    message: {
      ar: "هذه الميزة تتطلب اشتراكاً مدفوعاً.",
      en: "This feature requires a paid subscription.",
    },
  },
  UPSTREAM_UNAVAILABLE: {
    httpStatus: 503,
    message: {
      ar: "الخدمة غير متاحة مؤقتاً. حاول مرة أخرى بعد قليل.",
      en: "The service is temporarily unavailable. Please try again shortly.",
    },
  },
  INTERNAL: {
    httpStatus: 500,
    message: {
      ar: "حدث خطأ غير متوقع. تواصل مع الدعم وزوّدهم برمز الخطأ.",
      en: "An unexpected error occurred. Contact support and share the error reference.",
    },
  },
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as string[]).includes(value);
}
