import { t } from "@wasfa/shared/i18n";
import { notFound } from "next/navigation";
import { z } from "zod";

import { TasteCompare } from "../../../../../components/growth/taste-compare";
import { requireOnboarded } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("growth.taste.title") };

const idSchema = z.uuid();

/** The free Deep try next to the first reading (GROWTH §5); only the grant's owner can open it. */
export default async function TastePage({ params }: { params: Promise<{ grantId: string }> }) {
  const { grantId } = await params;
  const parsed = idSchema.safeParse(grantId);
  if (!parsed.success) notFound();
  await requireOnboarded(`/taste/${parsed.data}`);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold text-primary sm:text-4xl">
        {t("growth.taste.title")}
      </h1>
      <TasteCompare grantId={parsed.data} />
    </div>
  );
}
