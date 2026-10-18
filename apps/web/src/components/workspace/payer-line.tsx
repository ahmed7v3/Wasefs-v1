import { t } from "@wasfa/shared/i18n";

import { formatNumber } from "../../lib/admin-format";

import type { PayerView } from "../../lib/wallet-view";

/**
 * Who pays for the next analysis: «يدفع: صيدلية النور» or «يدفع: رصيدك الشخصي», what happens when the
 * organization wallet runs out, and the person's monthly cap. Always shown, so nobody is surprised.
 */
export function PayerLine({ payer }: { payer: PayerView }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid="payer">
      <p className="text-base font-semibold text-text">
        {payer.kind === "org"
          ? t("workspace.payer.org", { name: payer.orgName ?? t("workspace.payer.thisOrg") })
          : t("workspace.payer.personal")}
        {payer.fallback ? (
          <span className="font-normal text-text-muted">
            {" "}
            · {t("workspace.payer.thenPersonal")}
          </span>
        ) : null}
      </p>
      {payer.memberCap ? (
        <p className="text-sm text-text-muted tabular-nums">
          {t("workspace.cap", {
            used: formatNumber(payer.memberCap.used),
            cap: formatNumber(payer.memberCap.cap),
          })}
        </p>
      ) : null}
    </div>
  );
}
