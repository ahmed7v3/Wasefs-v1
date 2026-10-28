import { normalizeDrugName } from "@wasfa/shared/normalize";
import { and, eq, sql } from "drizzle-orm";

import { drugAliases, drugLearned, drugUnmatchedNames } from "./schema/index.js";

import type { Database } from "./client.js";

/*
 * Turning what people teach the engine into names it knows (docs/MEDICATIONS.md section 4 step 7 and
 * section 7). Shared by the worker (auto-approval after enough votes) and the admin review queues, so
 * a learned name always becomes the same kind of alias.
 */

const ARABIC_LETTER = /[؀-ۿݐ-ݿ]/;

export type LearnedAliasSource = "learned" | "admin";

/**
 * Makes `normalized` an alias of `drugId` (idempotent), marks the learned pair approved, and closes an
 * open unmatched entry for that reading. `decidedBy` is null for an automatic approval.
 */
export async function promoteLearnedAlias(
  db: Database,
  input: {
    normalized: string;
    drugId: string;
    decidedBy: string | null;
    source: LearnedAliasSource;
  },
): Promise<void> {
  const normalized = normalizeDrugName(input.normalized).name;
  if (normalized === "") return;
  await db.transaction(async (tx) => {
    await tx
      .insert(drugAliases)
      .values({
        drugId: input.drugId,
        alias: normalized,
        normalized,
        lang: ARABIC_LETTER.test(normalized) ? "ar" : "en",
        source: input.source,
      })
      .onConflictDoNothing({ target: [drugAliases.drugId, drugAliases.normalized] });
    await tx
      .insert(drugLearned)
      .values({
        normalized,
        drugId: input.drugId,
        status: "approved",
        decidedBy: input.decidedBy,
        decidedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [drugLearned.normalized, drugLearned.drugId],
        set: { status: "approved", decidedBy: input.decidedBy, decidedAt: sql`now()` },
      });
    await tx
      .update(drugUnmatchedNames)
      .set({ status: "mapped", mappedDrugId: input.drugId })
      .where(
        and(eq(drugUnmatchedNames.normalized, normalized), eq(drugUnmatchedNames.status, "open")),
      );
  });
}
