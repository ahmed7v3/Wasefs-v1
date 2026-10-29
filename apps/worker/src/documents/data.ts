import { t, type Locale } from "@wasfa/shared/i18n";
import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";

import type { RenderRequest } from "./renderer.js";
import type { RxResult } from "@wasfa/shared/schemas/rx";
import type { WaRenderDocumentPayload } from "@wasfa/shared/schemas/wa-document";

/*
 * The `data.json` of each template: the brand, the date, the labels in the document's language and
 * the content. Built here from the validated payload, so the words around the content are i18n and
 * only the content itself comes from the model.
 */

export const SITE = "wasfa.online";

/** Today as the customers live it (Cairo), `YYYY-MM-DD`. */
export function cairoDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(now);
}

function frame(language: Locale, now: Date) {
  return {
    lang: language,
    brand: t("brand.name", {}, language),
    site: SITE,
    generatedOn: t("document.generatedOn", { date: cairoDay(now) }, language),
    pageLabel: t("document.page", {}, language),
    sep: language === "ar" ? "، " : ", ",
  };
}

const disclaimer = (language: Locale, key: "chat.disclaimer" | "rx.disclaimer") => ({
  title: t("document.disclaimerTitle", {}, language),
  text: t(key, {}, language),
});

/** The render request for a document the agent was asked to make. Medical templates add the notice. */
export function documentRequest(payload: WaRenderDocumentPayload, now: Date): RenderRequest {
  const base = frame(payload.language, now);
  const language = payload.language;
  switch (payload.template) {
    case "report":
    case "table":
    case "card":
      return {
        template: payload.template,
        format: payload.template === "card" ? "png" : "pdf",
        data: { ...base, labels: {}, doc: payload.content },
      };
    case "schedule":
      return {
        template: "schedule",
        format: "pdf",
        data: {
          ...base,
          labels: {
            medicine: t("document.schedule.medicine", {}, language),
            dose: t("document.schedule.dose", {}, language),
            times: t("document.schedule.times", {}, language),
            notes: t("document.schedule.notes", {}, language),
          },
          doc: payload.content,
          disclaimer: disclaimer(language, "chat.disclaimer"),
        },
      };
  }
}

const present = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

/** One medicine the way the chat message lists it: name with strength and form, how it is taken, a flag when doubtful. */
export function rxRow(
  item: RxResult["items"][number],
  language: Locale,
): [name: string, how: string] {
  const name = displayName(present(item.name) ? item.name : item.rawText.trim());
  const head = [name, item.strength, formLabel(item.form, language)].filter(present).join(" ");
  const flag =
    item.badge === "low" || item.verified === "unreadable"
      ? ` ${t("whatsapp.agent.event.rxDone.lowConfidence", {}, language)}`
      : "";
  const how = [item.dose, item.frequency, item.duration]
    .filter(present)
    .join(language === "ar" ? "، " : ", ");
  return [`${head}${flag}`.trim(), how];
}

/** The prescription result as a PDF: the medicines, the unreadable-areas note, the notice and the link. */
export function rxResultRequest(
  result: RxResult,
  link: string | null,
  language: Locale,
  now: Date,
): RenderRequest {
  const rows = result.items.map((item) => rxRow(item, language)).filter(([name]) => name !== "");
  return {
    template: "rx_result",
    format: "pdf",
    data: {
      ...frame(language, now),
      labels: {
        title: t("document.rx.title", {}, language),
        count: t("document.rx.count", { count: rows.length }, language),
        name: t("document.rx.name", {}, language),
        how: t("document.rx.how", {}, language),
        link: t("document.rx.link", {}, language),
      },
      doc: {
        date: present(result.date) ? result.date : null,
        rows,
        unreadable:
          result.unreadableRegions.length > 0
            ? t("whatsapp.agent.event.rxDone.unreadable", {}, language)
            : null,
        link,
      },
      disclaimer: disclaimer(language, "rx.disclaimer"),
    },
  };
}
