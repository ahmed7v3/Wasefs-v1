import { t } from "@wasfa/shared/i18n";
import { Info, Lightbulb } from "lucide-react";

import type { RxResult } from "@wasfa/shared/schemas/rx";

export interface RxOverviewProps {
  result: Pick<RxResult, "overview" | "detailsStatus">;
}

/**
 * The hedged overview of what the medicines are commonly used for together. It is general
 * information built from the medicine names, never a diagnosis, and the card says so every time.
 * When the details step did not run or failed, a quiet line says the reading itself is complete.
 */
export function RxOverview({ result }: RxOverviewProps) {
  const { overview, detailsStatus } = result;
  if (!overview) {
    return detailsStatus === "unavailable" ? (
      <p
        data-testid="rx-overview-unavailable"
        className="flex items-start gap-3 rounded-md border border-border bg-neutral-100 p-4 text-sm text-text-muted"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{t("rx.overview.unavailable")}</span>
      </p>
    ) : null;
  }
  return (
    <section
      data-testid="rx-overview"
      aria-labelledby="rx-overview-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-primary-soft p-4"
    >
      <h2
        id="rx-overview-title"
        className="flex items-center gap-2 font-heading text-lg font-semibold text-primary"
      >
        <Lightbulb aria-hidden className="size-5 shrink-0" />
        {t("rx.overview.title")}
      </h2>
      <p className="text-base text-text">{overview.summary}</p>
      {overview.likelyConditions.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-text-muted">{t("rx.overview.conditions")}</p>
          <ul className="flex flex-wrap gap-2">
            {overview.likelyConditions.map((condition, index) => (
              <li
                key={index}
                className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-text"
              >
                {condition}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="flex items-start gap-2 text-sm text-text-muted">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{t("rx.overview.note")}</span>
      </p>
    </section>
  );
}
