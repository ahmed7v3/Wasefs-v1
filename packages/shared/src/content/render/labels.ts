import type { ContentLocale } from "../constants.js";

/*
 * The only user-visible strings the renderer writes into stored HTML. They are baked in at save time
 * (the public page injects `body_html` as is), so they live here in one file and are chosen by the
 * content's locale, never the viewer's.
 */

export type CalloutKind = "note" | "warning" | "tip";

export const CALLOUT_LABELS: Record<ContentLocale, Record<CalloutKind, string>> = {
  ar: { note: "ملاحظة", warning: "تنبيه طبي", tip: "نصيحة" },
  en: { note: "Note", warning: "Medical caution", tip: "Tip" },
};

export const CTA_LABELS: Record<ContentLocale, { text: string; action: string }> = {
  ar: { text: "هل لديك روشتة تحتاج إلى فهمها؟", action: "جر\u0651ب تحليل روشتتك مجان\u064Bا" },
  en: {
    text: "Have a prescription you want to understand?",
    action: "Try the prescription reader free",
  },
};

export const FOOTNOTES_LABEL: Record<ContentLocale, string> = {
  ar: "المراجع والهوامش",
  en: "References and footnotes",
};

export const FOOTNOTE_BACK_LABEL: Record<ContentLocale, (index: number) => string> = {
  ar: (index) => `العودة إلى المرجع ${String(index + 1)}`,
  en: (index) => `Back to reference ${String(index + 1)}`,
};

/** Path of the sign-up page the CTA block points at. */
export const CTA_HREF = "/register";
