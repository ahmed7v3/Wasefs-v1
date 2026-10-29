import { t } from "@wasfa/shared/i18n";
import { onboardingStateSchema } from "@wasfa/shared/schemas/onboarding";
import { redirect } from "next/navigation";

import { OnboardingWizard } from "../../../components/onboarding/onboarding-wizard";
import { getCatalog, requestedCurrency } from "../../../lib/billing-server";
import { getNonce } from "../../../lib/nonce";
import { getPublicSettings } from "../../../lib/public-settings";
import { requireMe, serverApi } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("onboarding.title") };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requireMe("/onboarding");
  if (me.onboarding.done) redirect("/dashboard");
  // The one-screen welcome is the default; the step-by-step wizard stays reachable with ?classic=1.
  if ((await searchParams)["classic"] !== "1") redirect("/welcome");

  const [state, settings, nonce, catalog] = await Promise.all([
    serverApi("/onboarding", { schema: onboardingStateSchema }),
    getPublicSettings(),
    getNonce(),
    requestedCurrency({}).then(getCatalog),
  ]);
  if (state.done) redirect("/dashboard");

  return (
    <OnboardingWizard
      initial={state}
      nonce={nonce}
      freeMonthlyAnalyses={settings.free_tier.monthlyAnalyses}
      facebookUrl={settings.socials.facebook}
      catalog={catalog}
    />
  );
}
