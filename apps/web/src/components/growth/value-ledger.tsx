"use client";

import { t } from "@wasfa/shared/i18n";
import { valueLedgerResponseSchema } from "@wasfa/shared/schemas/growth";

import { formatNumber } from "../../lib/admin-format";
import { useResource } from "../../lib/use-admin-data";

/**
 * «حلّلت 23 روشتة · راجعت 61 دواءً · وفّرت ≈ 5 ساعات (تقدير)» (GROWTH §7.4): the person's own
 * numbers, with the time saved always labelled as an estimate. Nothing renders before the first
 * analysis or when the call fails.
 */
export function ValueLedger() {
  const value = useResource("/me/value", valueLedgerResponseSchema);
  if (value.status !== "ready" || value.data.analyses === 0) return null;
  const { analyses, drugsChecked, minutesSavedEstimate } = value.data;
  const hours = Math.max(1, Math.round(minutesSavedEstimate / 60));
  return (
    <section aria-label={t("growth.value.title")} className="flex flex-col gap-1" data-testid="value-ledger">
      <p className="text-base text-text">
        {[
          t("growth.value.analyses", { count: formatNumber(analyses) }),
          t("growth.value.drugs", { count: formatNumber(drugsChecked) }),
          t("growth.value.minutes", { hours: formatNumber(hours) }),
        ].join(" · ")}
      </p>
      <p className="text-sm text-text-muted">{t("growth.value.estimateNote")}</p>
    </section>
  );
}
