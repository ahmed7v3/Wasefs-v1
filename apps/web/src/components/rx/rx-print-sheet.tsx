"use client";

import { t } from "@wasfa/shared/i18n";
import { formLabel } from "@wasfa/shared/rx-sanitize";
import { drugTitle, needsReview } from "@wasfa/ui";
import { Pill } from "lucide-react";

import { useQrCode } from "../../lib/use-qr-code";
import { brandLogoSrc, type Branding } from "../brand-mark";

import type { RxResult } from "@wasfa/shared/schemas/rx";

const COLUMNS = [
  ["strength", "rx.col.strength"],
  ["form", "rx.col.form"],
  ["dose", "rx.col.dose"],
  ["frequency", "rx.col.frequency"],
  ["duration", "rx.col.duration"],
  ["route", "rx.col.route"],
] as const;

export interface RxPrintSheetProps {
  result: RxResult;
  /** The `branding` public setting: its logo is printed when one is uploaded. */
  branding?: Pick<Branding, "nameAr" | "logoUrl" | "logoWidth" | "logoHeight"> | undefined;
  /** The site address printed with its QR code, e.g. `https://wasfa.online`. */
  siteUrl: string;
  /** Today's date, formatted by the caller. */
  reportDate: string;
}

/** The address without the scheme, for people to read and type: `wasfa.online`. */
const readable = (url: string): string => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * What the printer gets (Ctrl+P and the Print button give the same page): an A4, right-to-left
 * report with the logo and address of the tool, the lines, the overview and the general details of
 * each medicine, the notices and the disclaimer, and a QR code to the site. No image of the
 * prescription, no names, no controls. It is hidden on screen (`hidden print:block`); the print
 * rules in `globals.css` hide the app chrome whenever it is on the page (`[data-rx-print]`).
 */
export function RxPrintSheet({ result, branding, siteUrl, reportDate }: RxPrintSheetProps) {
  const qr = useQrCode(siteUrl, 140);
  const logo = brandLogoSrc(branding?.logoUrl ?? null);
  const name = branding?.nameAr ?? t("brand.name");
  const modelOnly = result.matching === "model";
  const unreadable = result.unreadableRegions.length;
  const withDetails = result.items.flatMap((item, index) =>
    item.details ? [{ item, index }] : [],
  );
  const lineTitles = (indexes: readonly number[]): string =>
    indexes
      .flatMap((index) => {
        const item = result.items[index];
        return item ? [drugTitle(item, modelOnly)] : [];
      })
      .join("، ");

  return (
    <section data-rx-print className="hidden text-black print:block">
      <header className="mb-4 flex items-center justify-between gap-4 border-b-4 border-[#1e3a8a] pb-3">
        <div className="flex items-center gap-3">
          {logo === null ? (
            <span className="grid size-12 place-items-center rounded-lg bg-[#1e3a8a] text-white">
              <Pill aria-hidden className="size-7" />
            </span>
          ) : (
            <img src={logo} alt="" className="h-12 w-auto max-w-48 object-contain" />
          )}
          <span className="text-2xl font-bold text-[#1e3a8a]">{name}</span>
        </div>
        <p dir="ltr" className="text-base font-semibold text-[#1e3a8a]">
          {readable(siteUrl)}
        </p>
      </header>

      <h2 className="mb-1 text-2xl font-bold">{t("rx.print.heading")}</h2>
      <p className="mb-4 text-sm">
        {t("rx.print.reportDate")}: <bdi>{reportDate}</bdi>
        {result.date ? (
          <>
            {" · "}
            {t("rx.print.date")}: <bdi>{result.date}</bdi>
          </>
        ) : null}
        {" · "}
        {t("rx.result.count", { count: result.items.length })}
      </p>

      {result.overview ? (
        <section className="mb-4 break-inside-avoid rounded border border-[#1e3a8a] p-3">
          <h3 className="mb-1 text-lg font-bold text-[#1e3a8a]">{t("rx.overview.title")}</h3>
          <p className="text-sm">{result.overview.summary}</p>
          {result.overview.likelyConditions.length > 0 ? (
            <p className="mt-1 text-sm">
              <strong>{t("rx.overview.conditions")}: </strong>
              {result.overview.likelyConditions.join("، ")}
            </p>
          ) : null}
          <p className="mt-2 text-xs">{t("rx.overview.note")}</p>
        </section>
      ) : null}

      <table className="w-full border-collapse text-start text-sm tabular-nums">
        <thead>
          <tr className="bg-[#e8edf8]">
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
                <bdi>{drugTitle(item, modelOnly)}</bdi>
                {!modelOnly && item.matchedDrugId === null ? ` (${t("rx.unmatched")})` : ""}
                {item.activeIngredients.length > 0 ? (
                  <span className="block font-normal">
                    <bdi>{item.activeIngredients.join(" + ")}</bdi>
                  </span>
                ) : null}
                {item.source === "ai" ? (
                  <span className="block text-xs font-normal">{t("rx.source.ai")}</span>
                ) : null}
                {needsReview(item, modelOnly) ? (
                  <span className="block text-xs font-normal">⚠ {t("rx.print.review")}</span>
                ) : null}
              </th>
              {COLUMNS.map(([key]) => (
                <td key={key} className="border border-black px-2 py-1">
                  <bdi>{(key === "form" ? formLabel(item.form, "ar") : item[key]) ?? ""}</bdi>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {result.findings.length > 0 ? (
        <section className="mt-3 break-inside-avoid text-sm">
          <h3 className="font-bold">{t("rx.finding.title")}</h3>
          <ul className="list-disc ps-5">
            {result.findings.map((finding, index) => (
              <li key={index}>
                {t(`rx.finding.${finding.kind}`)}
                {finding.ingredient ? <bdi> ({finding.ingredient})</bdi> : null}
                {finding.itemIndexes.length > 0
                  ? ` — ${t("rx.finding.lines", { items: lineTitles(finding.itemIndexes) })}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {withDetails.length > 0 ? (
        <section className="mt-5">
          <h3 className="mb-2 border-b border-black pb-1 text-lg font-bold text-[#1e3a8a]">
            {t("rx.print.detailsTitle")}
          </h3>
          <div className="flex flex-col gap-3">
            {withDetails.map(({ item, index }) =>
              item.details ? (
                <article key={index} className="break-inside-avoid text-sm">
                  <h4 className="text-base font-bold">
                    {index + 1}. <bdi>{drugTitle(item, modelOnly)}</bdi>
                  </h4>
                  {item.details.purpose ? (
                    <p>
                      <strong>{t("rx.details.purpose")}: </strong>
                      {item.details.purpose}
                    </p>
                  ) : null}
                  {item.details.sideEffects.length > 0 ? (
                    <p>
                      <strong>{t("rx.details.sideEffects")}: </strong>
                      {item.details.sideEffects.join("، ")}
                    </p>
                  ) : null}
                  {item.details.precautions.length > 0 ? (
                    <p>
                      <strong>{t("rx.details.precautions")}: </strong>
                      {item.details.precautions.join("، ")}
                    </p>
                  ) : null}
                </article>
              ) : null,
            )}
          </div>
          <p className="mt-2 text-xs">{t("rx.details.note")}</p>
        </section>
      ) : null}

      {unreadable > 0 ? (
        <p className="mt-3 text-sm">{t("rx.unreadable.note", { count: unreadable })}</p>
      ) : null}
      <p className="mt-4 break-inside-avoid border border-black p-2 text-sm">
        {t("rx.disclaimer")}
      </p>

      <footer className="mt-4 flex break-inside-avoid items-center justify-between gap-4 border-t-2 border-[#1e3a8a] pt-3">
        <div className="text-sm">
          <p className="font-bold text-[#1e3a8a]">{t("rx.print.footer")}</p>
          <p dir="ltr" className="mt-1 text-start font-semibold">
            {t("rx.print.cta", { url: readable(siteUrl) })}
          </p>
        </div>
        {qr ? (
          <img src={qr} alt={t("rx.print.qrAlt")} width={96} height={96} className="size-24" />
        ) : null}
      </footer>
    </section>
  );
}
