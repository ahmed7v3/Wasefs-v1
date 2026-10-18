import { t } from "@wasfa/shared/i18n";
import { mySubscriptionResponseSchema } from "@wasfa/shared/schemas/subscriptions";
import { buttonStyles } from "@wasfa/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import { Notice } from "../../../../../components/notice";
import { requireOnboarded, serverApi } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("billing.renew.title") };

/**
 * The one-tap link in the renewal reminders (`/billing/renew?sub=<id>`). The id only has to match
 * the signed-in person's own subscription; the plan, the period and the price come from the
 * server's renew quote, never from this URL.
 */
export default async function RenewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sub } = await searchParams;
  const id = z.uuid().safeParse(Array.isArray(sub) ? sub[0] : sub);
  await requireOnboarded(id.success ? `/billing/renew?sub=${id.data}` : "/billing");

  if (id.success) {
    const mine = await serverApi("/me/subscription", { schema: mySubscriptionResponseSchema });
    if (mine.subscription?.id === id.data) redirect("/checkout?renew=1");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold text-primary">{t("billing.renew.title")}</h1>
      <Notice tone="info">{t("billing.renew.notFound")}</Notice>
      <Link href="/billing" className={buttonStyles({ className: "self-start" })}>
        {t("billing.order.toBilling")}
      </Link>
    </div>
  );
}
