import { t, type Locale } from "@wasfa/shared/i18n";

/** The first line of a result delivered after its session ended: when the customer sent the prescription (Cairo time). */
export function earlierLabel(at: Date, locale: Locale): string {
  const time = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
  return t("whatsapp.agent.rx.fromEarlier", { time }, locale);
}
