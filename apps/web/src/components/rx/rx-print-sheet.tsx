import { t } from "@wasfa/shared/i18n";
import { drugTitle } from "@wasfa/ui";

import type { RxResult } from "@wasfa/shared/schemas/rx";

const COLUMNS = [
  ["strength", "rx.col.strength"],
  ["form", "rx.col.form"],
  ["dose", "rx.col.dose"],
  ["frequency", "rx.col.frequency"],
  ["duration", "rx.col.duration"],
  ["route", "rx.col.route"],
] as const;

/**
 * What the printer gets: a plain A4, right-to-left sheet with the lines, the disclaimer and the
 * unreadable-regions note. No image, no names, no controls. It is hidden on screen
 * (`hidden print:block`); the print rules in `globals.css` hide the app chrome whenever it is on
 * the page (`[data-rx-print]`), so Ctrl+P prints the same sheet as the Print button.
 */
export function RxPrintSheet({ result }: { result: RxResult }) {
  const unreadable = result.unreadableRegions.length;
  return (
    <section data-rx-print className="hidden text-black print:block">
      <h2 className="mb-1 text-2xl font-bold">{t("rx.print.title")}</h2>
      {result.date ? (
        <p className="mb-4 text-base">
          {t("rx.print.date")}: <bdi>{result.date}</bdi>
        </p>
      ) : null}
      <table className="w-full border-collapse text-start text-sm tabular-nums">
        <thead>
          <tr>
            <th scope="col" className="border border-black px-2 py-1 text-start">
              {t("rx.col.drug")}
            </th>
            {COLUMNS.map(([key, label]) => (
              <th key={key} scope="col" className="border border-black px-2 py-1 text-start">
                {t(label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.items.map((item, index) => (
            <tr key={index} className="break-inside-avoid">
              <th scope="row" className="border border-black px-2 py-1 text-start font-semibold">
                <bdi>{drugTitle(item)}</bdi>
                {item.matchedDrugId === null ? ` (${t("rx.unmatched")})` : ""}
                {item.matchedDrugId !== null && item.activeIngredients.length > 0 ? (
                  <span className="block font-normal">
                    <bdi>{item.activeIngredients.join(" + ")}</bdi>
                  </span>
                ) : null}
              </th>
              {COLUMNS.map(([key]) => (
                <td key={key} className="border border-black px-2 py-1">
                  <bdi>{item[key] ?? ""}</bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {unreadable > 0 ? (
        <p className="mt-3 text-sm">{t("rx.unreadable.note", { count: unreadable })}</p>
      ) : null}
      <p className="mt-4 border border-black p-2 text-sm">{t("rx.disclaimer")}</p>
    </section>
  );
}
