import { t } from "@wasfa/shared/i18n";
import { formLabel } from "@wasfa/shared/rx-sanitize";
import { drugTitle } from "@wasfa/ui";

import type { RxResult, RxResultItem } from "@wasfa/shared/schemas/rx";

/*
 * The result as text, for "copy", the WhatsApp share and the system share sheet. Only the structured
 * fields of a line and the general information are used (never `notes`, initials or file names), so
 * what leaves the app carries no names and no image. The text is built from the result held in the
 * browser; nothing is sent to our servers for it. It ends with the link to the site.
 */

export type RxTextItem = Pick<
  RxResultItem,
  | "rawText"
  | "name"
  | "matchedDrugId"
  | "match"
  | "verified"
  | "badge"
  | "activeIngredients"
  | "strength"
  | "form"
  | "dose"
  | "frequency"
  | "duration"
  | "route"
  | "details"
>;

export interface RxReport {
  items: readonly RxTextItem[];
  overview?: RxResult["overview"] | undefined;
  /** The date written on the prescription, when the model read one. */
  date?: string | null | undefined;
  /** `model`: the lines were not matched against a database, so none is "unconfirmed". */
  matching?: RxResult["matching"] | undefined;
}

export interface RxTextOptions {
  /** The site address shown as the last line, e.g. `https://wasfa.online`. */
  siteUrl: string;
  /** The date of the report (today); formatted by the caller. */
  reportDate?: string | undefined;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

const SEPARATOR = "؛ ";

/** A short sentence the lists are folded into for sharing: `a؛ b؛ c`. */
const joined = (values: readonly string[]): string =>
  values.map(clean).filter(Boolean).join(SEPARATOR);

/** Pieces of the "how to take it" line, in the order a pharmacist reads them. */
function usageParts(item: RxTextItem): string[] {
  return [formLabel(item.form, "ar"), item.dose, item.frequency, item.duration, item.route]
    .map(clean)
    .filter((part) => part !== "");
}

/** Does the line need a pharmacist's eye (shown in every shape of the report)? */
function needsLook(item: RxTextItem, modelOnly: boolean): boolean {
  return (!modelOnly && item.matchedDrugId === null) || item.badge !== "high";
}

/**
 * One numbered line: `1. Augmentin — 1 g — tablet — 1 tablet — 3 times a day`. Kept for the plain
 * list (used by the tests and by anything that wants only the lines).
 */
export function itemLine(item: RxTextItem, position: number, modelOnly = false): string {
  const unmatched = !modelOnly && item.matchedDrugId === null;
  const title = drugTitle(item, modelOnly);
  const details = [
    clean(item.strength) !== "" ? t("rx.share.strength", { value: clean(item.strength) }) : "",
    clean(formLabel(item.form, "ar")),
    clean(item.dose),
    clean(item.frequency),
    clean(item.duration),
    clean(item.route),
  ].filter((part) => part !== "");
  const likely = item.match === "likely" ? ` (${t("rx.match.likely")})` : "";
  const head = `${String(position)}. ${title}${unmatched ? ` (${t("rx.share.unconfirmed")})` : likely}`;
  return [head, ...details].join(" — ");
}

interface Style {
  /** `*bold*` for WhatsApp, plain for the clipboard. */
  bold: (text: string) => string;
  /** Include side effects and precautions (the clipboard copy), or only the purpose (the share). */
  full: boolean;
}

function block(report: RxReport, style: Style): string[] {
  const modelOnly = report.matching === "model";
  const out: string[] = [];
  report.items.forEach((item, index) => {
    const title = drugTitle(item, modelOnly);
    const generic = clean(item.activeIngredients[0]);
    const head = `${String(index + 1)}. ${title}`;
    out.push(`💊 ${style.bold(head)}${generic !== "" ? ` (${generic})` : ""}`);
    const strength = clean(item.strength);
    if (strength !== "") out.push(`   • ${t("rx.share.strengthLine", { value: strength })}`);
    const usage = usageParts(item);
    if (usage.length > 0) out.push(`   • ${usage.join(" · ")}`);
    const details = item.details;
    if (details) {
      if (clean(details.purpose) !== "") {
        out.push(`   • ${t("rx.share.purpose", { value: clean(details.purpose) })}`);
      }
      if (style.full && details.sideEffects.length > 0) {
        out.push(`   • ${t("rx.share.sideEffects", { value: joined(details.sideEffects) })}`);
      }
      if (style.full && details.precautions.length > 0) {
        out.push(`   • ${t("rx.share.precautions", { value: joined(details.precautions) })}`);
      }
    }
    if (needsLook(item, modelOnly)) out.push(`   ⚠️ ${t("rx.share.review")}`);
    out.push("");
  });
  return out;
}

function overviewBlock(report: RxReport, style: Style): string[] {
  const overview = report.overview;
  if (!overview) return [];
  const out = [`📋 ${style.bold(t("rx.share.overview"))}`, overview.summary];
  if (overview.likelyConditions.length > 0) {
    out.push(t("rx.share.overviewConditions", { value: joined(overview.likelyConditions) }));
  }
  out.push("");
  return out;
}

function report(
  reportData: RxReport,
  options: RxTextOptions,
  style: Style,
  footer: string,
): string {
  const head = [`🩺 ${style.bold(t("rx.share.title"))}`];
  if (options.reportDate) head.push(`📅 ${t("rx.share.reportDate", { date: options.reportDate })}`);
  if (clean(reportData.date) !== "") {
    head.push(`🗓️ ${t("rx.share.rxDate", { date: clean(reportData.date) })}`);
  }
  return [
    ...head,
    "",
    ...block(reportData, style),
    ...overviewBlock(reportData, style),
    `⚠️ ${footer}`,
    `🔗 ${t("rx.share.cta", { url: options.siteUrl })}`,
  ].join("\n");
}

/** The text copied to the clipboard: everything, with the full medical disclaimer. */
export function buildCopyText(reportData: RxReport, options: RxTextOptions): string {
  return report(reportData, options, { bold: (text) => text, full: true }, t("rx.disclaimer"));
}

/** The text shared (WhatsApp, system share sheet): WhatsApp bold, purposes only, a one-sentence footer. */
export function buildShareText(reportData: RxReport, options: RxTextOptions): string {
  return report(
    reportData,
    options,
    { bold: (text) => `*${text}*`, full: false },
    t("rx.share.footer"),
  );
}

/** `https://wa.me/?text=...`: opens WhatsApp's chooser with the text; no number, no image. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
