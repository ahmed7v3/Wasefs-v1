import { skillVersion } from "@wasfa/ai";
import { refund, release, settle, type WalletOwner } from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { isAppError } from "@wasfa/shared/errors";
import { newErrorRef } from "@wasfa/shared/ids";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";

import { readSetting } from "../settings.js";

import { analyzeImages } from "./analyze.js";
import { createRxPublisher, type RxPublisher } from "./events.js";
import { RxStepError } from "./model-call.js";
import { isReadable } from "./pipeline.js";
import { RX_SKILL } from "./prompts.js";
import {
  claimForProcessing,
  effectivePlanId,
  findAnalysis,
  finishAnalysis,
  isTerminal,
  loadPages,
  markFailed,
  markVerifying,
  reservedAmount,
  setUsageCredits,
} from "./repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type RxContext = Pick<JobContext, "db" | "redis" | "logger" | "storage" | "ai">;

/** The whole analysis, pages to settled credits. Task 2.8 planned 60 s; reasoning models on hard handwriting need more, and a longer wait is fine because the person can leave the page. */
export const RX_BUDGET_MS = 90_000;

const walletOf = (row: { ownerUserId: string | null; ownerOrgId: string | null }): WalletOwner => {
  if (row.ownerUserId !== null) return { type: "user", id: row.ownerUserId };
  if (row.ownerOrgId !== null) return { type: "org", id: row.ownerOrgId };
  throw new Error("An analysis always has an owner (rx_analyses_owner_check)");
};

/**
 * `rx.analyze`: reads, matches, verifies, finalizes and settles one prescription analysis.
 *
 * Safe to run twice: a finished analysis exits at once, credits move only through idempotent
 * ledger operations (`reserve` by the api, `settle` per reservation, `refund` by key), and every
 * database write is conditioned on the analysis still being in flight. The busy lock is freed only
 * by the run that ends the analysis. Logs carry ids, counts and codes, never prescription content.
 */
export async function rxAnalyzeJob(
  { analysisId }: JobPayload<"rx", "rx.analyze">,
  { db, redis, logger, storage, ai }: RxContext,
): Promise<void> {
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  if (ai === undefined) throw new Error("The AI runtime is not configured");

  const row = await findAnalysis(db, analysisId);
  if (row === null) {
    logger.warn({ analysisId }, "rx job skipped: analysis not found");
    return;
  }
  if (isTerminal(row.status)) {
    logger.info({ analysisId, status: row.status }, "rx job skipped: already finished");
    return;
  }
  if (!(await claimForProcessing(db, analysisId))) return;

  const events = createRxPublisher(redis, analysisId, logger);
  const wallet = walletOf(row);
  const actingUserId = row.createdBy ?? row.ownerUserId;
  const budget = AbortSignal.timeout(RX_BUDGET_MS);
  const skill = skillVersion(RX_SKILL);
  let failedStep = "read";

  try {
    const rx = await readSetting(db, "rx");
    const pages = await loadPages(db, analysisId);
    const images: Buffer[] = [];
    for (const page of pages) {
      const bytes =
        page.status === "processed" ? await storage.get(page.r2Key, UPLOAD_MAX_BYTES) : null;
      if (bytes === null) throw new RxStepError("image_missing");
      images.push(bytes);
    }

    const planId = await effectivePlanId(db, row, new Date());
    const base = {
      mode: row.mode,
      planId,
      ownerUserId: row.ownerUserId,
      ownerOrgId: row.ownerOrgId,
      userId: row.createdBy,
      requestId: analysisId,
    };
    const {
      result,
      costUsdMicros: cost,
      routeVersion,
      usageId,
    } = await analyzeImages({
      db,
      router: ai.router,
      images,
      base,
      verifyMaxItems: rx.verifyMaxItems,
      signal: budget,
      onStep: async (step, { verifying }) => {
        failedStep = step;
        await events.step(step);
        if (verifying) await markVerifying(db, analysisId);
      },
    });

    // 5. settle: the fixed price, or a full refund when nothing could be read.
    failedStep = "settle";
    const status = result.items.some(isReadable) ? "done" : "refunded";
    const charged = await settleCredits({
      db,
      wallet,
      analysisId,
      reservationId: row.reservationId,
      refundAll: status === "refunded",
      usageId,
    });
    const finished = await finishAnalysis(db, analysisId, {
      status,
      result,
      creditsCharged: charged,
      routeVersion,
      skillVersion: skill,
    });
    if (finished) await events.done(status);
    logger.info(
      {
        analysisId,
        status,
        items: result.items.length,
        pages: images.length,
        routeVersion,
        skillVersion: skill,
        costUsdMicros: cost,
        creditsCharged: charged,
      },
      "rx analysis finished",
    );
    // Only the run that ended the analysis frees the lock: a duplicate job must not free a newer one.
    if (finished) await releaseBusy(redis, actingUserId);
  } catch (error) {
    await fail({
      db,
      redis,
      logger,
      events,
      analysisId,
      reservationId: row.reservationId,
      actingUserId,
      step: failedStep,
      error,
    });
  }
}

interface SettleArgs {
  db: RxContext["db"];
  wallet: WalletOwner;
  analysisId: string;
  reservationId: string | null;
  refundAll: boolean;
  usageId: string | null;
}

/** Credits for a finished analysis; returns what the user ends up paying. */
async function settleCredits(args: SettleArgs): Promise<number> {
  const { db, wallet, analysisId, reservationId, refundAll, usageId } = args;
  if (reservationId === null) return 0;
  const amount = await reservedAmount(db, reservationId);
  if (amount === null) return 0;

  const settled = await settle(
    db,
    reservationId,
    amount,
    usageId === null ? {} : { aiUsageId: usageId },
  );
  if (refundAll) {
    // "No result, no charge": the ledger shows the charge and the refund that cancels it.
    if (settled.charged > 0) {
      await refund(db, wallet, settled.charged, {
        reason: "no_result",
        idempotencyKey: `rx:${analysisId}:refund`,
        reservationId,
      });
    }
    return 0;
  }
  if (usageId !== null) await setUsageCredits(db, usageId, settled.charged);
  return settled.charged;
}

async function releaseBusy(redis: RxContext["redis"], userId: string | null): Promise<void> {
  if (userId !== null) await redis.del(busyLockKey(userId, "rx"));
}

/** The failure path: status `failed` with a support reference, credits back, one `failed` event, lock freed. */
async function fail(args: {
  db: RxContext["db"];
  redis: RxContext["redis"];
  logger: RxContext["logger"];
  events: RxPublisher;
  analysisId: string;
  reservationId: string | null;
  actingUserId: string | null;
  step: string;
  error: unknown;
}): Promise<void> {
  const { db, redis, logger, events, analysisId, reservationId, actingUserId, step, error } = args;
  const errorRef = newErrorRef();
  // Codes only: provider and database messages can quote what was sent.
  const code =
    error instanceof RxStepError
      ? error.code
      : isAppError(error)
        ? error.code
        : error instanceof Error
          ? error.name
          : "unknown";
  logger.error({ analysisId, errorRef, step, code }, "rx analysis failed");

  if (reservationId !== null) {
    try {
      await release(db, reservationId, "rx_failed");
    } catch (releaseError) {
      // The expiry sweeper returns the hold later; the analysis must still end as failed.
      logger.error(
        {
          analysisId,
          errorRef,
          code: releaseError instanceof Error ? releaseError.name : "unknown",
        },
        "rx credits release failed",
      );
    }
  }
  if (await markFailed(db, analysisId, errorRef)) {
    await events.failed(errorRef);
    await releaseBusy(redis, actingUserId);
  }
}
