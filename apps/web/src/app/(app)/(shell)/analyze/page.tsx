import { t } from "@wasfa/shared/i18n";
import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";

import { AnalyzeCapture } from "../../../../components/capture/analyze-capture";
import { VerificationBanner } from "../../../../components/dashboard/verification-banner";
import { getNonce } from "../../../../lib/nonce";
import { getPublicSettings } from "../../../../lib/public-settings";
import { requireOnboarded, serverApi } from "../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("analyze.title") };

export default async function AnalyzePage() {
  const me = await requireOnboarded("/analyze");
  const [settings, credits] = await Promise.all([
    getPublicSettings(),
    me.canUseTools
      ? serverApi("/me/credits", { schema: meCreditsResponseSchema })
      : Promise.resolve(null),
  ]);
  const nonce = me.canUseTools ? undefined : await getNonce();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold text-primary sm:text-4xl">
          {t("analyze.title")}
        </h1>
        <p className="text-lg text-text-muted">{t("analyze.lead")}</p>
      </header>
      {credits === null ? (
        <VerificationBanner me={me} nonce={nonce} />
      ) : (
        <AnalyzeCapture
          maxPages={settings.rx.maxPages}
          creditsPerPage={settings.rx.creditsPerPage}
          balance={credits.wallet.balance}
        />
      )}
      <p className="text-sm text-text-muted">{t("home.disclaimer")}</p>
    </div>
  );
}
