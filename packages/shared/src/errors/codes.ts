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
  // Price engine refusals (BILLING §4): the request was understood but cannot be priced.
  PRICE_NOT_AVAILABLE: "PRICE_NOT_AVAILABLE",
  BELOW_MINIMUM: "BELOW_MINIMUM",
  FREE_ORDER_NOT_ALLOWED: "FREE_ORDER_NOT_ALLOWED",
  METHOD_NOT_AVAILABLE: "METHOD_NOT_AVAILABLE",
  // Checkout (BILLING §5): the quote must be re-requested, or a limited coupon ran out meanwhile.
  QUOTE_EXPIRED: "QUOTE_EXPIRED",
  COUPON_UNAVAILABLE: "COUPON_UNAVAILABLE",
  DUPLICATE_TXN: "DUPLICATE_TXN",
  PROOF_LIMIT: "PROOF_LIMIT",
  PROOF_PROCESSING: "PROOF_PROCESSING",
  PROOF_NOT_ALLOWED: "PROOF_NOT_ALLOWED",
  // Trials (BILLING §7.2): once per owner and per verified phone.
  TRIAL_UNAVAILABLE: "TRIAL_UNAVAILABLE",
  TRIAL_USED: "TRIAL_USED",
  PHONE_VERIFICATION_REQUIRED: "PHONE_VERIFICATION_REQUIRED",
  // A webhook whose signature does not verify (recorded, never processed).
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
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
  PRICE_NOT_AVAILABLE: {
    httpStatus: 422,
    message: {
      ar: "هذه الباقة غير متاحة بالعملة أو المدة المختارة.",
      en: "This plan is not available for the selected currency or period.",
    },
  },
  BELOW_MINIMUM: {
    httpStatus: 422,
    message: {
      ar: "المبلغ أقل من الحد الأدنى للدفع.",
      en: "The amount is below the minimum charge.",
    },
  },
  FREE_ORDER_NOT_ALLOWED: {
    httpStatus: 422,
    message: {
      ar: "الطلبات المجانية غير متاحة حالياً.",
      en: "Free orders are not available right now.",
    },
  },
  METHOD_NOT_AVAILABLE: {
    httpStatus: 422,
    message: {
      ar: "طريقة الدفع هذه غير متاحة لهذا الطلب.",
      en: "This payment method is not available for this order.",
    },
  },
  QUOTE_EXPIRED: {
    httpStatus: 409,
    message: {
      ar: "انتهت صلاحية ملخص السعر أو تغيّر. راجع الملخص من جديد ثم ادفع.",
      en: "The price summary expired or changed. Review it again, then pay.",
    },
  },
  COUPON_UNAVAILABLE: {
    httpStatus: 409,
    message: {
      ar: "لم يعد هذا الكود متاحاً. راجع الملخص من جديد.",
      en: "This code is no longer available. Review the summary again.",
    },
  },
  DUPLICATE_TXN: {
    httpStatus: 409,
    message: {
      ar: "رقم المعاملة مستخدم بالفعل.",
      en: "This transaction ID has already been submitted.",
    },
  },
  PROOF_LIMIT: {
    httpStatus: 409,
    message: {
      ar: "وصلت إلى الحد الأقصى لإرسال الإثباتات.",
      en: "The proof submission limit has been reached.",
    },
  },
  PROOF_PROCESSING: {
    httpStatus: 409,
    message: {
      ar: "ما زالت الصورة قيد المعالجة. حاول بعد قليل.",
      en: "The proof image is still processing. Try again shortly.",
    },
  },
  PROOF_NOT_ALLOWED: {
    httpStatus: 409,
    message: {
      ar: "لا يمكن إرسال إثبات لهذا الدفع في حالته الحالية.",
      en: "A proof cannot be submitted for this payment in its current state.",
    },
  },
  TRIAL_UNAVAILABLE: {
    httpStatus: 409,
    message: {
      ar: "التجربة المجانية غير متاحة لهذه الباقة الآن.",
      en: "A free trial is not available for this plan right now.",
    },
  },
  TRIAL_USED: {
    httpStatus: 409,
    message: {
      ar: "استُخدمت التجربة المجانية من قبل على هذا الحساب أو رقم الهاتف.",
      en: "The free trial was already used on this account or phone number.",
    },
  },
  PHONE_VERIFICATION_REQUIRED: {
    httpStatus: 403,
    message: {
      ar: "أكّد رقم هاتفك أولاً لتبدأ التجربة المجانية.",
      en: "Verify your phone number first to start the free trial.",
    },
  },
  INVALID_SIGNATURE: {
    httpStatus: 401,
    message: { ar: "توقيع غير صالح.", en: "Invalid signature." },
  },
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as string[]).includes(value);
}
