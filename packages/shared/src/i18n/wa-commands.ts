/*
 * WhatsApp command registry data (docs/WA-AGENT-RUNTIME.md §7.2). Aliases are data: admins can add aliases
 * to a command (settings) but never a new command. Aliases are stored as a person would write them; the
 * matcher normalises both sides, so spelling variants (ة/ه, أ/ا, tashkeel) need no extra entries.
 */

export const WA_COMMANDS = [
  "new",
  "analyze",
  "help",
  "balance",
  "report",
  "schedule",
  "meds",
  "remind",
  "voice",
  "lang",
  "human",
  "privacy",
] as const;
export type WaCommand = (typeof WA_COMMANDS)[number];

export const WA_COMMAND_ALIASES: Record<WaCommand, readonly string[]> = {
  new: [
    "جديد",
    "ابدأ من جديد",
    "ابدا من جديد",
    "محادثة جديدة",
    "محادثه جديده",
    "new",
    "reset",
    "/new",
    "start over",
  ],
  analyze: [
    "حلل",
    "حللي",
    "حلل الروشتة",
    "حلل الروشته",
    "حلل الوصفة",
    "تحليل",
    "اقرا الروشتة",
    "اقرأ الروشتة",
    "analyze",
    "analyse",
    "/analyze",
  ],
  help: ["مساعدة", "مساعده", "القائمة", "المساعدة", "help", "menu", "/help", "؟"],
  balance: ["رصيدي", "باقتي", "balance", "/balance"],
  report: ["التقرير", "pdf", "الملف", "/report"],
  schedule: ["مواعيدي", "الجدول", "/schedule"],
  meds: ["أدويتي", "خزانتي", "/meds"],
  remind: ["فعل التذكير", "وقف التذكير", "/remind"],
  voice: ["صوت", "بدون صوت", "/voice"],
  lang: ["english", "عربي", "/lang"],
  human: ["كلم موظف", "خدمة العملاء", "كلمني موظف", "human", "/human"],
  privacy: ["امسح بياناتي", "delete my data", "/privacy"],
};

/** Replies that confirm the `privacy` deletion (normalised by the caller the same way as aliases). */
export const WA_PRIVACY_CONFIRM: readonly string[] = ["تأكيد", "تاكيد", "confirm"];

/**
 * Aliases that carry an argument, keyed by command then by the alias as written above:
 * `voice` on/off, `remind` on/off, `lang` en/ar.
 */
export const WA_ALIAS_ARGS: Partial<Record<WaCommand, Readonly<Record<string, string>>>> = {
  remind: { "فعل التذكير": "on", "وقف التذكير": "off" },
  voice: { صوت: "on", "بدون صوت": "off" },
  lang: { english: "en", عربي: "ar" },
};

/**
 * Ordinary words that sit one typo away from a long alias (تحاليل = lab tests, الملح = salt). They are
 * real messages, so the fuzzy step must not turn them into a command. Compared after normalisation.
 */
export const WA_FUZZY_BLOCKLIST: readonly string[] = [
  "تحاليل",
  "تحليله",
  "الملح",
  "الملك",
  "مواعيد",
  "باقتك",
  "رصيد",
  "الجداول",
  "الجدوى",
  "تحليلي",
  "مساعدي",
  "مساعد",
  "المساعد",
  "القائم",
  "رصيدك",
  "التقارير",
  "التقريب",
  "مواعيدك",
  "ادويتك",
  "خزانتك",
  "امسح بياناتك",
];
