import {
  activeIngredients,
  aiUsage,
  creditReservations,
  creditWallets,
  drugIngredients,
  files,
  planAssignments,
  plans,
  rxAnalyses,
  rxPages,
  type Database,
  type RxAnalysis,
  type WalletOwner,
} from "@wasfa/db";
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import type { RxResult } from "@wasfa/shared/schemas/rx";

/*
 * Queries of the prescription job. The worker has no per-user scope: a job runs for the analysis it
 * was queued for, and every write is conditioned on the status the job expects, so a retried or
 * duplicate job cannot move an analysis backwards or finish it twice.
 */

const IN_FLIGHT = ["queued", "processing", "verifying"] as const;

export const isTerminal = (status: RxAnalysis["status"]): boolean =>
  !(IN_FLIGHT as readonly string[]).includes(status);

export async function findAnalysis(db: Database, id: string): Promise<RxAnalysis | null> {
  const [row] = await db.select().from(rxAnalyses).where(eq(rxAnalyses.id, id)).limit(1);
  return row ?? null;
}

/** `queued` (or a crashed run's `processing`/`verifying`) to `processing`. False when the analysis is already finished. */
export async function claimForProcessing(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .update(rxAnalyses)
    .set({ status: "processing", startedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rxAnalyses.id, id), inArray(rxAnalyses.status, [...IN_FLIGHT])))
    .returning({ id: rxAnalyses.id });
  return rows.length > 0;
}

export async function markVerifying(db: Database, id: string): Promise<void> {
  await db
    .update(rxAnalyses)
    .set({ status: "verifying", updatedAt: new Date() })
    .where(and(eq(rxAnalyses.id, id), inArray(rxAnalyses.status, [...IN_FLIGHT])));
}

export interface PageFile {
  pageNo: number;
  fileId: string;
  r2Key: string;
  status: string;
}

/** The pages in the order the user gave them. */
export async function loadPages(db: Database, analysisId: string): Promise<PageFile[]> {
  return db
    .select({
      pageNo: rxPages.pageNo,
      fileId: rxPages.fileId,
      r2Key: files.r2Key,
      status: files.status,
    })
    .from(rxPages)
    .innerJoin(files, eq(files.id, rxPages.fileId))
    .where(eq(rxPages.analysisId, analysisId))
    .orderBy(asc(rxPages.pageNo));
}

/** The plan whose routes apply to the owner: the newest open assignment, else the default plan. */
export async function effectivePlanId(
  db: Database,
  owner: { ownerUserId: string | null; ownerOrgId: string | null },
  now: Date,
): Promise<string | null> {
  const ownerCondition =
    owner.ownerUserId !== null
      ? eq(planAssignments.ownerUserId, owner.ownerUserId)
      : owner.ownerOrgId !== null
        ? eq(planAssignments.ownerOrgId, owner.ownerOrgId)
        : undefined;
  if (ownerCondition !== undefined) {
    const [assigned] = await db
      .select({ planId: planAssignments.planId })
      .from(planAssignments)
      .where(
        and(
          ownerCondition,
          lte(planAssignments.startsAt, now),
          or(isNull(planAssignments.endsAt), gt(planAssignments.endsAt, now)),
        ),
      )
      .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id))
      .limit(1);
    if (assigned) return assigned.planId;
  }
  const [fallback] = await db.select({ id: plans.id }).from(plans).where(eq(plans.isDefault, true));
  return fallback?.id ?? null;
}

/** Active ingredient names of each drug (English names), for the duplicate-ingredient check. */
export async function ingredientsOf(
  db: Database,
  drugIds: readonly string[],
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (drugIds.length === 0) return found;
  const rows = await db
    .select({ drugId: drugIngredients.drugId, name: activeIngredients.nameEn })
    .from(drugIngredients)
    .innerJoin(activeIngredients, eq(activeIngredients.id, drugIngredients.ingredientId))
    .where(inArray(drugIngredients.drugId, [...drugIds]))
    .orderBy(asc(activeIngredients.nameEn));
  for (const row of rows) found.set(row.drugId, [...(found.get(row.drugId) ?? []), row.name]);
  return found;
}

/** The credits held for the analysis (the fixed price per page); `null` when nothing was reserved. */
export async function reservedAmount(db: Database, reservationId: string): Promise<number | null> {
  const [row] = await db
    .select({ amount: creditReservations.amount })
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId));
  return row?.amount ?? null;
}

/** The wallet that holds the reservation: where a refund must go (an organization wallet or the personal one). */
export async function reservationWallet(
  db: Database,
  reservationId: string,
): Promise<WalletOwner | null> {
  const [row] = await db
    .select({ userId: creditWallets.ownerUserId, orgId: creditWallets.ownerOrgId })
    .from(creditReservations)
    .innerJoin(creditWallets, eq(creditWallets.id, creditReservations.walletId))
    .where(eq(creditReservations.id, reservationId));
  if (!row) return null;
  if (row.orgId !== null) return { type: "org", id: row.orgId };
  return row.userId !== null ? { type: "user", id: row.userId } : null;
}

export interface Finish {
  status: "done" | "refunded";
  result: RxResult;
  creditsCharged: number;
  routeVersion: number | null;
  skillVersion: string;
}

/** Stores the result and the end state; false when the analysis was already finished (a duplicate job). */
export async function finishAnalysis(db: Database, id: string, finish: Finish): Promise<boolean> {
  const rows = await db
    .update(rxAnalyses)
    .set({
      status: finish.status,
      result: finish.result,
      creditsCharged: finish.creditsCharged,
      routeVersion: finish.routeVersion,
      skillVersion: finish.skillVersion,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(rxAnalyses.id, id), inArray(rxAnalyses.status, [...IN_FLIGHT])))
    .returning({ id: rxAnalyses.id });
  return rows.length > 0;
}

export async function markFailed(db: Database, id: string, errorRef: string): Promise<boolean> {
  const rows = await db
    .update(rxAnalyses)
    .set({ status: "failed", errorRef, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rxAnalyses.id, id), inArray(rxAnalyses.status, [...IN_FLIGHT])))
    .returning({ id: rxAnalyses.id });
  return rows.length > 0;
}

/** Stamps the credits an analysis cost on its main usage row. */
export async function setUsageCredits(
  db: Database,
  usageId: string,
  credits: number,
): Promise<void> {
  await db.update(aiUsage).set({ creditsCharged: credits }).where(eq(aiUsage.id, usageId));
}
