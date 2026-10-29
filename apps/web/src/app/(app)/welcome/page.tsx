import { t } from "@wasfa/shared/i18n";
import { onboardingStateSchema } from "@wasfa/shared/schemas/onboarding";
import { redirect } from "next/navigation";

import { WelcomeCard } from "../../../components/onboarding/welcome-card";
import { getNonce } from "../../../lib/nonce";
import { requireMe, serverApi } from "../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("welcome.pageTitle") };

/** The whole onboarding on one screen; the step-by-step wizard stays at `/onboarding?classic=1`. */
export default async function WelcomePage() {
  const me = await requireMe("/welcome");
  if (me.onboarding.done) redirect("/dashboard");

  const [state, nonce] = await Promise.all([
    serverApi("/onboarding", { schema: onboardingStateSchema }),
    getNonce(),
  ]);
  if (state.done) redirect("/dashboard");

  return <WelcomeCard initial={state} nonce={nonce} />;
}
