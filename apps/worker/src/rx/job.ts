import { skillVersion } from "@wasfa/ai";
import { refund, release, requestSignupCheck, settle, type WalletOwner } from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { isAppError } from "@wasfa/shared/errors";
import { newErrorRef } from "@wasfa/shared/ids";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";

import { createRxPdf } from "../documents/rx-pdf.js";
import { readSetting } from "../settings.js";

import { analyzeImages } from "./analyze.js";
import { createRxPublisher, type RxPublisher } from "./events.js";
import { failureReason, refundedReason } from "./failure.js";
import { RxStepError } from "./model-call.js";
import { isReadable } from "./pipeline.js";
import { RX_SKILL } from "./prompts.js";
import {
  claimForProcessing,
  effectivePlanId,
  findAnalysis,
  finishAnalysis,
  hasOutboxRoute,
  isTerminal,
  loadPages,
  markFailed,
  markVerifying,
  reservationWallet,
  reservedAmount,
  setUsageCredits,
} from "./repo.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type RxContext = Pick<
  JobContext,
  "db" | "redis" | "logger" | "storage" | "ai" | "documents" | "env"
>;

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
  { analysisId, planOrgId, routePlanId }: JobPayload<"rx", "rx.analyze">,
  { db, redis, logger, storage, ai, documents, env }: RxContext,
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

  // The PDF of the result goes to the WhatsApp agent only (see `createRxPublisher`).
  const events = createRxPublisher(
    redis,
    analysisId,
    logger,
    documents === undefined
      ? undefined
      : createRxPdf(analysisId, {
          documents,
          storage,
          logger,
          language: async () =>
            (await readSetting(db, "waAgent")).language === "en" ? "en" : "ar",
          link: (id) => (env === undefined ? null : `${env.WEB_ORIGIN}/analyze/${id}`),
        }),
    () => hasOutboxRoute(db, analysisId),
  );
  const wallet = walletOf(row);
  const actingUserId = row.createdBy ?? row.ownerUserId;
  const budget = AbortSignal.timeout(RX_BUDGET_MS);
  const skill = skillVersion(RX_SKILL);
  let failedStep = "read";

  try {
    const rx = await readSetting(db, "rx");
    const medications = await readSetting(db, "medications");
    const pages = await loadPages(db, analysisId);
    const images: Buffer[] = [];
    for (const page of pages) {
      const bytes =
        page.status === "processed" ? await storage.get(page.r2Key, UPLOAD_MAX_BYTES) : null;
      if (bytes === null) throw new RxStepError("image_missing");
      images.push(bytes);
    }

    // In an organization context the API priced and quota-checked the organization's plan: route by it too.
    // A taste is routed by the paid plan whose Deep reading it lets the user try once.
    const planId =
      routePlanId ??
      (await effectivePlanId(
        db,
        planOrgId === undefined ? row : { ownerUserId: null, ownerOrgId: planOrgId },
        new Date(),
      ));
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
      medications,
      details: rx.details,
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
    const { charged, returned } = await settleCredits({
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
    if (finished) {
      await events.done(
        status,
        result,
        status === "refunded"
          ? { reason: refundedReason(result), creditsReturned: returned }
          : undefined,
      );
    }
    // A first finished analysis can complete a referred person's sign-up conditions (Task 3.11).
    if (finished && status === "done" && row.ownerUserId !== null) {
      await requestSignupCheck(db, row.ownerUserId, "usage").catch(() => {
        logger.warn({ analysisId }, "rewards sign-up check could not be queued");
      });
    }
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

/**
 * Credits for a finished analysis: what the user ends up paying, and `returned` = a refund really went
 * through the ledger (false when nothing was ever charged, so no text may claim a refund).
 */
async function settleCredits(args: SettleArgs): Promise<{ charged: number; returned: boolean }> {
  const { db, wallet, analysisId, reservationId, refundAll, usageId } = args;
  if (reservationId === null) return { charged: 0, returned: false };
  const amount = await reservedAmount(db, reservationId);
  if (amount === null) return { charged: 0, returned: false };

  const settled = await settle(
    db,
    reservationId,
    amount,
    usageId === null ? {} : { aiUsageId: usageId },
  );
  if (refundAll) {
    // "No result, no charge": the ledger shows the charge and the refund that cancels it.
    if (settled.charged > 0) {
      // The charge may sit on an organization wallet: the refund goes to the wallet that paid.
      await refund(db, (await reservationWallet(db, reservationId)) ?? wallet, settled.charged, {
        reason: "no_result",
        idempotencyKey: `rx:${analysisId}:refund`,
        reservationId,
      });
      return { charged: 0, returned: true };
    }
    return { charged: 0, returned: false };
  }
  if (usageId !== null) await setUsageCredits(db, usageId, settled.charged);
  return { charged: settled.charged, returned: false };
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

  let creditsReturned = false;
  if (reservationId !== null) {
    try {
      // Returned only when the ledger says the hold is released (a settled one stays charged).
      creditsReturned =
        (await release(db, reservationId, "rx_failed")).reservation.status === "released";
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
    await events.failed(errorRef, { reason: failureReason(error), creditsReturned });
    await releaseBusy(redis, actingUserId);
  }
}
