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
  "email.greeting": "مرحبًا {name}،",
  "email.greetingAnonymous": "مرحبًا،",
  "email.linkFallback": "إن لم يعمل الزر، انسخ الرابط التالي والصقه في المتصفح:",
  "email.ignoreIfNotYou": "إن لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغير شيء في حسابك.",
  "email.footer": "رسالة آلية من وصفة AI، لا يمكن الرد عليها.",
  "email.disclaimer": "وصفة AI أداة مساعدة ولا تغني عن استشارة الطبيب أو الصيدلي.",
  "email.verify.subject": "فعّل بريدك الإلكتروني في وصفة AI",
  "email.verify.intro": "شكرًا لتسجيلك في وصفة AI. اضغط الزر التالي لتأكيد بريدك الإلكتروني وتفعيل حسابك.",
  "email.verify.button": "تأكيد البريد الإلكتروني",
  "email.verify.expires": "ينتهي هذا الرابط خلال ساعة واحدة.",
  "email.reset.subject": "إعادة تعيين كلمة المرور في وصفة AI",
  "email.reset.intro": "وصلنا طلب لإعادة تعيين كلمة مرور حسابك. اضغط الزر التالي لاختيار كلمة مرور جديدة.",
  "email.reset.button": "اختيار كلمة مرور جديدة",
  "email.reset.expires": "ينتهي هذا الرابط خلال ساعة واحدة، ويُستخدم مرة واحدة فقط.",
  "email.invite.subject": "دعوة للانضمام إلى {org} على وصفة AI",
  "email.invite.introWithInviter": "{inviter} يدعوك للانضمام إلى «{org}» على وصفة AI.",
  "email.invite.intro": "تمت دعوتك للانضمام إلى «{org}» على وصفة AI.",
  "email.invite.button": "قبول الدعوة",
  "email.invite.expires": "تنتهي هذه الدعوة خلال 7 أيام، وتُستخدم مرة واحدة فقط.",
  "email.suspended.subject": "تم إيقاف حسابك في وصفة AI",
  "email.suspended.intro": "تم إيقاف حسابك في وصفة AI مؤقتًا، ولن تتمكن من تسجيل الدخول حتى تتم مراجعته.",
  "email.suspended.contact": "إن كنت ترى أن هذا حدث بالخطأ فتواصل مع فريق الدعم وسنراجع حسابك.",
  ...errorMessages,
} as const;

export type MessageKey = keyof typeof ar;
