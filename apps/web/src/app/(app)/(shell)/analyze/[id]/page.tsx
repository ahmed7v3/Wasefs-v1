import { t } from "@wasfa/shared/i18n";
import { meCreditsResponseSchema } from "@wasfa/shared/schemas/credits";
import { rxViewSchema } from "@wasfa/shared/schemas/rx";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { RxResultView } from "../../../../../components/rx/rx-result-view";
import { ApiRequestError } from "../../../../../lib/api-error";
import { getPublicSettings } from "../../../../../lib/public-settings";
import { requireOnboarded, serverApi } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("rx.page.title") };

const idSchema = z.uuid();

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  const me = await requireOnboarded(`/analyze/${parsed.data}`);
  // Unverified accounts see the verification banner on /analyze instead.
  if (!me.canUseTools) redirect("/analyze");

  const [view, settings, balance] = await Promise.all([
    serverApi(`/rx/${parsed.data}`, { schema: rxViewSchema }).catch((error: unknown) => {
      if (error instanceof ApiRequestError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    getPublicSettings(),
    serverApi("/me/credits", { schema: meCreditsResponseSchema }).then(
      (credits) => credits.wallet.balance,
      () => null,
    ),
  ]);

  return (
    <RxResultView
      key={view.id}
      initial={view}
      creditsPerPage={settings.rx.creditsPerPage}
      balance={balance}
    />
  );
}
