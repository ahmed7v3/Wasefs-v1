import { t } from "@wasfa/shared/i18n";
import { medicationDetailResponseSchema } from "@wasfa/shared/schemas/medications";
import { notFound } from "next/navigation";
import { z } from "zod";

import { MedicationDetailView } from "../../../../../components/medications/medication-detail";
import { ApiRequestError } from "../../../../../lib/api-error";
import { requireOnboarded, serverApi } from "../../../../../lib/session";

import type { Metadata } from "next";

export const metadata: Metadata = { title: t("medications.title") };

const idSchema = z.uuid();

export default async function MedicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) notFound();
  await requireOnboarded(`/medications/${parsed.data}`);

  const detail = await serverApi(`/medications/${parsed.data}`, {
    schema: medicationDetailResponseSchema,
  }).catch((error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return <MedicationDetailView detail={detail} />;
}
