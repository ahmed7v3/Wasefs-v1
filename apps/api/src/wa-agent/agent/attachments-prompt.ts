import { t, type Locale } from "@wasfa/shared/i18n";

import type { Attachment, AttachmentStatus } from "../conversation/attachments.service.js";

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const digits = (n: number, locale: Locale): string =>
  locale === "ar"
    ? String(n).replace(/\d/g, (digit) => ARABIC_DIGITS[Number(digit)] ?? digit)
    : String(n);

function age(seconds: number, locale: Locale): string {
  if (seconds < 60) return t("whatsapp.agent.attachments.age.now", undefined, locale);
  if (seconds < 3_600) {
    const n = digits(Math.floor(seconds / 60), locale);
    return t("whatsapp.agent.attachments.age.minutes", { n }, locale);
  }
  if (seconds < 86_400) {
    const n = digits(Math.floor(seconds / 3_600), locale);
    return t("whatsapp.agent.attachments.age.hours", { n }, locale);
  }
  const n = digits(Math.floor(seconds / 86_400), locale);
  return t("whatsapp.agent.attachments.age.days", { n }, locale);
}

function status(value: AttachmentStatus, locale: Locale): string {
  switch (value.kind) {
    case "ready":
    case "expired":
      return t(`whatsapp.agent.attachments.status.${value.kind}`, undefined, locale);
    case "failed":
      return t("whatsapp.agent.attachments.status.failed", { reason: value.reason }, locale);
    case "analysed":
    case "in_progress":
      return t(`whatsapp.agent.attachments.status.${value.kind}`, { ref: value.rxRef }, locale);
  }
}

/**
 * The attachments block of the v2 system context (docs/WA-AGENT-RUNTIME.md §8.1): one line per file,
 * e.g. «#3 صورة · من ٢ دقيقة · جاهزة · مجموعة A». Null while the session has no media. Pure.
 */
export function renderAttachments(list: readonly Attachment[], locale: Locale): string | null {
  if (list.length === 0) return null;
  const lines = list.map((item) => {
    const parts = [
      t(`whatsapp.agent.attachments.kind.${item.kind}`, undefined, locale),
      age(item.ageSeconds, locale),
      status(item.status, locale),
      ...(item.set === null
        ? []
        : [t("whatsapp.agent.attachments.set", { label: item.set }, locale)]),
    ];
    return `#${item.handle} ${parts.join(" · ")}`;
  });
  return [
    t("whatsapp.agent.attachments.header", undefined, locale),
    ...lines,
    t("whatsapp.agent.attachments.hint", undefined, locale),
  ].join("\n");
}
