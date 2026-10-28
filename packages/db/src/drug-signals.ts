import { normalizeDrugName } from "@wasfa/shared/normalize";
import { and, eq, sql } from "drizzle-orm";

import { promoteLearnedAlias } from "./drug-learning.js";
import { drugLearned, drugLearningVotes, drugUnmatchedNames, drugs } from "./schema/index.js";

import type { Database } from "./client.js";

/*
 * What recognition learns from use (docs/MEDICATIONS.md section 4, steps 5 and 7): readings nobody
 * could match, counted for the admin queue, and the votes users cast by correcting a line to a database
 * drug. Neither table ever holds a user id next to prescription text: the unmatched queue has no user at
 * all, and a vote links a user only to a (reading, drug) pair.
 */

const MIN_UNMATCHED_LENGTH = 3;
const SAMPLE_MAX = 80;

/** `value.slice` on code points, so a clip never splits a surrogate pair. */
const clip = (value: string, max: number): string =>
  Array.from(value.trim()).slice(0, max).join("");

export interface UnmatchedName {
  /** `normalizeDrugName(reading).name`. */
  normalized: string;
  /** The reading as the model wrote it; clipped to 80 characters here. */
  sample: string;
}

/**
 * Counts readings that matched no drug. A new reading is inserted `open`; a known one gets `hits + 1`
 * and a fresh `last_seen` (its status, set by an admin, is never touched). Too short or empty names are
 * skipped, and a name repeated in one batch counts once.
 */
export async function recordUnmatchedNames(
  db: Database,
  names: readonly UnmatchedName[],
): Promise<void> {
  const rows = new Map<string, { normalized: string; sample: string }>();
  for (const { normalized, sample } of names) {
    const key = normalized.trim();
    if (Array.from(key).length < MIN_UNMATCHED_LENGTH || rows.has(key)) continue;
    rows.set(key, { normalized: key, sample: clip(sample, SAMPLE_MAX) || key });
  }
  if (rows.size === 0) return;
  await db
    .insert(drugUnmatchedNames)
    .values([...rows.values()])
    .onConflictDoUpdate({
      target: drugUnmatchedNames.normalized,
      set: { hits: sql`${drugUnmatchedNames.hits} + 1`, lastSeen: sql`now()` },
    });
}

export interface LearningVote {
  /** The original reading of the line (before the correction); normalized here. */
  normalized: string;
  drugId: string;
  userId: string;
  /** Distinct users that promote the pair to an alias; 0 = an admin decides. */
  autoApproveAt: number;
}

export interface LearningVoteOutcome {
  /** False when there was nothing to learn (empty reading, unknown drug, the drug's own name). */
  recorded: boolean;
  /** Distinct users that voted for the pair. */
  votes: number;
  /** The pair became an approved alias because of this vote. */
  promoted: boolean;
}

/**
 * "This reading means this drug": one vote per user and pair. The pair's `votes` is the number of
 * distinct users; its status is left alone (an admin's `approved` / `rejected` stands). A `pending` pair
 * that reaches `autoApproveAt` becomes an alias through `promoteLearnedAlias`; a rejected pair never does.
 */
export async function recordLearningVote(
  db: Database,
  input: LearningVote,
): Promise<LearningVoteOutcome> {
  const normalized = normalizeDrugName(input.normalized).name;
  const none: LearningVoteOutcome = { recorded: false, votes: 0, promoted: false };
  if (normalized === "") return none;

  const { votes, status } = await db.transaction(async (tx) => {
    const [drug] = await tx
      .select({ normalizedEn: drugs.normalizedEn, brandKey: drugs.brandKey })
      .from(drugs)
      .where(eq(drugs.id, input.drugId))
      .limit(1);
    // Nothing to learn when the reading already is the drug's own name.
    if (drug === undefined || drug.normalizedEn === normalized || drug.brandKey === normalized) {
      return { votes: 0, status: null };
    }
    await tx
      .insert(drugLearningVotes)
      .values({ normalized, drugId: input.drugId, userId: input.userId })
      .onConflictDoNothing();
    const [counted] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(drugLearningVotes)
      .where(
        and(
          eq(drugLearningVotes.normalized, normalized),
          eq(drugLearningVotes.drugId, input.drugId),
        ),
      );
    const count = counted?.count ?? 1;
    const [pair] = await tx
      .insert(drugLearned)
      .values({ normalized, drugId: input.drugId, votes: count })
      .onConflictDoUpdate({
        target: [drugLearned.normalized, drugLearned.drugId],
        set: { votes: count },
      })
      .returning({ status: drugLearned.status });
    return { votes: count, status: pair?.status ?? null };
  });
  if (status === null) return none;

  const promote = status === "pending" && input.autoApproveAt > 0 && votes >= input.autoApproveAt;
  if (promote) {
    await promoteLearnedAlias(db, {
      normalized,
      drugId: input.drugId,
      decidedBy: null,
      source: "learned",
    });
  }
  return { recorded: true, votes, promoted: promote };
}
