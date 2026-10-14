import { t } from "@wasfa/shared/i18n";
import { drugTitle } from "@wasfa/ui";

import type { RxResultItem } from "@wasfa/shared/schemas/rx";

/*
 * The result as plain text, for "copy" and for the WhatsApp share. Only the structured fields of a
 * line are used (never `notes`, the prescription date, initials or file names), so what leaves the
 * app carries no names and no image. The text is built from the result held in the browser; nothing
 * is sent to our servers for it.
 */

export type RxTextItem = Pick<
  RxResultItem,
  | "rawText"
  | "name"
  | "matchedDrugId"
  | "verified"
  | "strength"
  | "form"
  | "dose"
  | "frequency"
  | "duration"
  | "route"
>;

const clean = (value: string | null): string => (value ?? "").trim();

/** One numbered line: `1. Augmentin — 1 g — tablet — 1 tablet — 3 times a day`. */
export function itemLine(item: RxTextItem, position: number): string {
  const unmatched = item.matchedDrugId === null;
  const title = drugTitle(item);
  const details = [
    clean(item.strength) !== "" ? t("rx.share.strength", { value: clean(item.strength) }) : "",
    clean(item.form),
    clean(item.dose),
    clean(item.frequency),
    clean(item.duration),
    clean(item.route),
  ].filter((part) => part !== "");
  const head = `${String(position)}. ${title}${unmatched ? ` (${t("rx.share.unconfirmed")})` : ""}`;
  return [head, ...details].join(" — ");
}

function lines(items: readonly RxTextItem[]): string[] {
  return items.map((item, index) => itemLine(item, index + 1));
}

/** The text copied to the clipboard: the lines and the full medical disclaimer. */
export function buildCopyText(items: readonly RxTextItem[]): string {
  return [t("rx.share.header"), ...lines(items), "", t("rx.disclaimer")].join("\n");
}

/** The text shared to WhatsApp: the lines and a one-sentence footer. */
export function buildShareText(items: readonly RxTextItem[]): string {
  return [t("rx.share.header"), ...lines(items), "", t("rx.share.footer")].join("\n");
}

/** `https://wa.me/?text=...`: opens WhatsApp's chooser with the text; no number, no image. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
