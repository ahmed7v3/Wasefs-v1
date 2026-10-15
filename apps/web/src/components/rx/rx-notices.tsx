import { t } from "@wasfa/shared/i18n";
import { drugTitle } from "@wasfa/ui";
import { Info, ScanSearch, Stethoscope } from "lucide-react";

import type { RxResult } from "@wasfa/shared/schemas/rx";

/** The medical disclaimer (AGENT §5.11): visible in every state of the screen, never collapsed. */
export function RxDisclaimer() {
  return (
    <p
      data-testid="rx-disclaimer"
      className="flex items-start gap-3 rounded-md border border-border bg-neutral-100 p-4 text-base text-text"
    >
      <Stethoscope aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
      <span>{t("rx.disclaimer")}</span>
    </p>
  );
}

export interface RxNoticesProps {
  result: RxResult;
}

/**
 * What the reading could not do: unreadable regions, an illegible prescriber, and the deterministic
 * findings. Findings are general notices ("ask the pharmacist"), written neutrally: no alarm colour,
 * no instruction to change or stop a medicine.
 */
export function RxNotices({ result }: RxNoticesProps) {
  const unreadable = result.unreadableRegions.length;
  const lineTitles = (indexes: readonly number[]): string =>
    indexes
      .flatMap((index) => {
        const item = result.items[index];
        return item ? [drugTitle(item, result.matching === "model")] : [];
      })
      .join("، ");

  return (
    <div className="flex flex-col gap-3">
      {unreadable > 0 ? (
        <p
          data-testid="rx-unreadable-note"
          className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-soft p-4 text-base text-text"
        >
          <ScanSearch aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <span>{t("rx.unreadable.note", { count: unreadable })}</span>
        </p>
      ) : null}
      {!result.prescriberLegible ? (
        <p className="flex items-start gap-3 rounded-md border border-border bg-neutral-100 p-4 text-base text-text">
          <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
          <span>{t("rx.prescriberIllegible")}</span>
        </p>
      ) : null}
      {result.findings.length > 0 ? (
        <section
          data-testid="rx-findings"
          aria-labelledby="rx-findings-title"
          className="flex flex-col gap-2 rounded-md border border-border bg-neutral-100 p-4"
        >
          <h2
            id="rx-findings-title"
            className="flex items-center gap-2 text-base font-semibold text-text"
          >
            <Info aria-hidden className="size-5 shrink-0 text-primary" />
            {t("rx.finding.title")}
          </h2>
          <ul className="flex flex-col gap-2 ps-7 text-base text-text">
            {result.findings.map((finding, index) => (
              <li key={index}>
                <p>{t(`rx.finding.${finding.kind}`)}</p>
                {finding.ingredient ? (
                  <p className="text-sm text-text-muted">
                    <bdi>{finding.ingredient}</bdi>
                  </p>
                ) : null}
                {finding.itemIndexes.length > 0 ? (
                  <p className="text-sm text-text-muted">
                    {t("rx.finding.lines", { items: lineTitles(finding.itemIndexes) })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
