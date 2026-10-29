import { t, type Locale, type MessageKey } from "@wasfa/shared/i18n";
import { normalizeArabic } from "@wasfa/shared/normalize";
import { dayOrder, formatClock, scheduleOf, type DoseSlotKey } from "@wasfa/shared/rx-schedule";
import { displayName, formLabel } from "@wasfa/shared/rx-sanitize";
import { z } from "zod";

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

const MAX_PDF_PRECAUTIONS = 3;

/** What the `rx_result` template reads from `data.doc` (checked before it is sent to Typst). */
export const rxPdfDocSchema = z.object({
  date: z.string().nullable(),
  items: z.array(
    z.object({
      title: z.string().min(1),
      /** Strength and form. */
      sub: z.string(),
      /** Low-confidence note, or null. */
      flag: z.string().nullable(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })),
      precautionsLabel: z.string(),
      precautions: z.array(z.string()).max(MAX_PDF_PRECAUTIONS),
    }),
  ),
  overview: z.object({ title: z.string(), text: z.string() }).nullable(),
  /** Null when there is no medicine to schedule. */
  schedule: z
    .object({
      title: z.string(),
      note: z.string(),
      medicineLabel: z.string(),
      notesLabel: z.string(),
      /** One column per suggested clock time (all medicines together), in day order. */
      columns: z.array(z.object({ time: z.string(), slot: z.string() })),
      rows: z.array(
        z.object({
          name: z.string().min(1),
          /** One cell per column: due at that time. */
          cells: z.array(z.boolean()),
          /** Shown instead of ticks when the prescription gives no times ("as needed", "as your doctor directs"). */
          note: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
  unreadable: z.string().nullable(),
  link: z.string().nullable(),
});
export type RxPdfDoc = z.infer<typeof rxPdfDocSchema>;

// Never the Arabic directions as a name (rx-sanitize), even when only the raw line was read.
const itemName = (item: RxResult["items"][number]): string =>
  displayName(present(item.name) ? item.name.trim() : item.rawText.trim());

/** One medicine's card: title, strength and form, the facts the prescription gives, the first precautions. */
function rxCard(item: RxResult["items"][number], language: Locale): RxPdfDoc["items"][number] {
  const label = (key: MessageKey) => t(key, {}, language);
  const schedule = scheduleOf(item);
  const frequency = present(item.frequency)
    ? [
        item.frequency.trim(),
        ...(schedule.meal === null
          ? []
          : [label(`document.rx.schedule.meal.${schedule.meal}` as const)]),
      ]
        // The meal words are added only when the frequency text does not already say them.
        .filter(
          (part, index) =>
            index === 0 ||
            !normalizeArabic(item.frequency ?? "")
              .toLowerCase()
              .includes(normalizeArabic(part).toLowerCase()),
        )
        .join(" ")
    : null;
  const facts: [MessageKey, string | null | undefined][] = [
    ["document.rx.dose", item.dose],
    ["document.rx.frequency", frequency],
    ["document.rx.duration", item.duration],
    ["document.rx.route", item.route],
    ["document.rx.notes", item.notes],
    ["document.rx.purpose", item.details?.purpose],
  ];
  const doubtful = item.badge === "low" || item.verified === "unreadable";
  return {
    title: itemName(item),
    sub: [item.strength, formLabel(item.form, language)].filter(present).join(" "),
    flag: doubtful ? label("whatsapp.agent.event.rxDone.lowConfidence") : null,
    facts: facts.flatMap(([key, value]) =>
      present(value) ? [{ label: label(key), value: value.trim() }] : [],
    ),
    precautionsLabel: label("document.rx.precautions"),
    precautions: (item.details?.precautions ?? []).filter(present).slice(0, MAX_PDF_PRECAUTIONS),
  };
}

/**
 * The dosing timetable: rows are the medicines (a long name needs room, and a long list only adds
 * rows), columns are the suggested clock times of all medicines together, in day order. A medicine
 * with no readable frequency gets a note instead of ticks, so nothing is ever scheduled by guess.
 */
function rxTimetable(items: RxResult["items"], language: Locale): RxPdfDoc["schedule"] {
  const named = items.filter((item) => itemName(item) !== "");
  if (named.length === 0) return null;
  const label = (key: MessageKey) => t(key, {}, language);
  const suffix = { am: label("document.rx.schedule.am"), pm: label("document.rx.schedule.pm") };
  const schedules = named.map((item) => scheduleOf(item));

  const byTime = new Map<string, DoseSlotKey>();
  for (const { slots } of schedules) {
    for (const slot of slots) {
      const known = byTime.get(slot.time);
      if (known === undefined || slot.key === "bedtime") byTime.set(slot.time, slot.key);
    }
  }
  const times = [...byTime.keys()].sort((a, b) => dayOrder(a) - dayOrder(b));
  return {
    title: label("document.rx.schedule.title"),
    note: label("document.rx.schedule.note"),
    medicineLabel: label("document.schedule.medicine"),
    notesLabel: label("document.schedule.notes"),
    columns: times.map((time) => ({
      time: formatClock(time, suffix),
      slot: label(`document.rx.slot.${byTime.get(time) ?? "morning"}` as const),
    })),
    rows: named.map((item, index) => {
      const slots = schedules[index]?.slots ?? [];
      return {
        name: itemName(item),
        cells: times.map((time) => slots.some((slot) => slot.time === time)),
        note:
          slots.length > 0
            ? null
            : label(
                schedules[index]?.asNeeded === true
                  ? "document.rx.schedule.asNeeded"
                  : "document.rx.schedule.doctor",
              ),
      };
    }),
  };
}

/**
 * The prescription result as a PDF: one card per medicine (dose, how often, duration, route, the
 * doctor's instructions, what it is for, precautions), a suggested dosing timetable, the overview, the
 * unreadable-areas note, the notice and the link.
 */
export function rxResultRequest(
  result: RxResult,
  link: string | null,
  language: Locale,
  now: Date,
): RenderRequest {
  const named = result.items.filter((item) => itemName(item) !== "");
  const summary = result.overview?.summary;
  const doc = rxPdfDocSchema.parse({
    date: present(result.date) ? result.date : null,
    items: named.map((item) => rxCard(item, language)),
    overview: present(summary)
      ? { title: t("document.rx.overview", {}, language), text: summary.trim() }
      : null,
    schedule: rxTimetable(result.items, language),
    unreadable:
      result.unreadableRegions.length > 0
        ? t("whatsapp.agent.event.rxDone.unreadable", {}, language)
        : null,
    link,
  } satisfies RxPdfDoc);
  return {
    template: "rx_result",
    format: "pdf",
    data: {
      ...frame(language, now),
      labels: {
        title: t("document.rx.title", {}, language),
        count: t("document.rx.count", { count: named.length }, language),
        link: t("document.rx.link", {}, language),
      },
      doc,
      disclaimer: disclaimer(language, "rx.disclaimer"),
    },
  };
}
