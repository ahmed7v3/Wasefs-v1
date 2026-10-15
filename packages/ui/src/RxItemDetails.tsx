import { t } from "@wasfa/shared/i18n";
import { Info } from "lucide-react";

import { cn } from "./cn";

import type { RxItemDetails as RxItemDetailsData } from "@wasfa/shared/schemas/rx";

export interface RxItemDetailsProps {
  details: RxItemDetailsData;
  className?: string | undefined;
}

/**
 * The general information about one medicine (what it is generally used for, common side effects,
 * general precautions) that opens under its row. It is reference text written by the model from the
 * medicine's name alone, so the panel says so and sends the person to the pharmacist.
 */
export function RxItemDetails({ details, className }: RxItemDetailsProps) {
  const hasAnything =
    (details.purpose ?? "").trim() !== "" ||
    details.sideEffects.length > 0 ||
    details.precautions.length > 0;
  return (
    <div
      data-testid="rx-item-details"
      className={cn("flex flex-col gap-3 text-base text-text", className)}
    >
      {hasAnything ? (
        <>
          {details.purpose ? (
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-text-muted">{t("rx.details.purpose")}</h3>
              <p>{details.purpose}</p>
            </section>
          ) : null}
          {details.sideEffects.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-text-muted">
                {t("rx.details.sideEffects")}
              </h3>
              <ul className="list-disc ps-5">
                {details.sideEffects.map((effect, index) => (
                  <li key={index}>{effect}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {details.precautions.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-text-muted">
                {t("rx.details.precautions")}
              </h3>
              <ul className="list-disc ps-5">
                {details.precautions.map((precaution, index) => (
                  <li key={index}>{precaution}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <p className="text-text-muted">{t("rx.details.none")}</p>
      )}
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{t("rx.details.note")}</span>
      </p>
    </div>
  );
}
