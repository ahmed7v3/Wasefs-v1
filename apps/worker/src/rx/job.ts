import { skillVersion } from "@wasfa/ai";
import { LedgerError, refund, release, settle, type WalletOwner } from "@wasfa/db";
import { busyLockKey } from "@wasfa/shared/busy";
import { isAppError } from "@wasfa/shared/errors";
import { newErrorRef } from "@wasfa/shared/ids";
import { UPLOAD_MAX_BYTES } from "@wasfa/shared/schemas/files";
import {
  rxExtractionJsonSchema,
  rxExtractionSchema,
  rxVerifyAnswerSchema,
  rxVerifyJsonSchema,
  type RxExtraction,
  type RxResult,
  type RxVerifyAnswer,
} from "@wasfa/shared/schemas/rx";

import { readSetting } from "../settings.js";

import { cropRegion } from "./crop.js";
import { createRxPublisher, type RxPublisher } from "./events.js";
import { RxStepError, callJson, type ModelCall } from "./model-call.js";
import {
  applyVerification,
  buildResult,
  isReadable,
  markSkipped,
  matchItems,
  pickForVerification,
  type WorkItem,
} from "./pipeline.js";
import {
  RX_SKILL,
  readMessages,
  systemPrompt,
  verifyMessages,
  type VerifyItem,
} from "./prompts.js";
import {
  claimForProcessing,
  effectivePlanId,
  findAnalysis,
  finishAnalysis,
  ingredientsOf,
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

/** The whole analysis, pages to settled credits (phase2.md Task 2.8: a 60 second total budget). */
export const RX_BUDGET_MS = 60_000;
/** One provider attempt; the rest of the budget is left for the fallback route. */
const ATTEMPT_TIMEOUT_MS = 40_000;
const READ_MAX_OUTPUT_TOKENS = 8_192;
const VERIFY_MAX_OUTPUT_TOKENS = 2_048;
/** Gemini bills an image at a fixed token count; used only for the spend estimate. */
const IMAGE_TOKENS = 1_120;

const walletOf = (row: { ownerUserId: string | null; ownerOrgId: string | null }): WalletOwner => {
  if (row.ownerUserId !== null) return { type: "user", id: row.ownerUserId };
  if (row.ownerOrgId !== null) return { type: "org", id: row.ownerOrgId };
  throw new Error("An analysis always has an owner (rx_analyses_owner_check)");
};

/**
 * Runs `step`, and once more if it throws. The router already falls back across the route's models
 * inside one attempt, so a second attempt covers a transient failure of everything; refusals
 * (switched off, no route) and an exhausted budget are final.
 */
async function withRetry<T>(step: () => Promise<T>, signal: AbortSignal): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (isAppError(error) || signal.aborted || error instanceof LedgerError) throw error;
    if (error instanceof RxStepError && error.code === "image_missing") throw error;
    return step();
  }
}

interface Reading {
  extraction: RxExtraction;
  calls: ModelCall<RxExtraction>;
}

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
    const system = systemPrompt();

    // 1. read: all pages in one call.
    await events.step("read");
    const reading: Reading = await withRetry(async () => {
      const calls = await callJson({
        router: ai.router,
        input: {
          ...base,
          task: "rx_extract",
          estimateInputTokens: images.length * IMAGE_TOKENS + Math.ceil(system.length / 4),
        },
        request: {
          system,
          messages: readMessages(images.map((jpeg) => ({ jpeg }))),
          jsonSchema: rxExtractionJsonSchema as unknown as Record<string, unknown>,
          maxOutputTokens: READ_MAX_OUTPUT_TOKENS,
        },
        schema: rxExtractionSchema,
        signal: budget,
        attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
      });
      return { extraction: calls.value, calls };
    }, budget);
    let cost = reading.calls.costUsdMicros;
    const { routeVersion, usageId } = reading.calls;

    // 2. match: deterministic, from the drug database.
    failedStep = "match";
    await events.step("match");
    const items: WorkItem[] = await withRetry(() => matchItems(db, reading.extraction), budget);

    // 3. verify: only the flagged lines, highest risk first.
    failedStep = "verify";
    const chosenForVerify = pickForVerification(items, rx.verifyMaxItems).filter((index) => {
      const item = items[index];
      return item !== undefined && item.extracted.page < images.length;
    });
    if (chosenForVerify.length > 0) {
      await events.step("verify");
      await markVerifying(db, analysisId);
      const offered = new Map(
        chosenForVerify.map((index) => [index, items[index]?.candidates ?? []] as const),
      );
      const verification = await withRetry(async () => {
        const verifyItems: VerifyItem[] = [];
        for (const index of chosenForVerify) {
          const item = items[index];
          const page = item === undefined ? undefined : images[item.extracted.page];
          if (item === undefined || page === undefined) continue;
          verifyItems.push({
            index,
            crop: await cropRegion(page, item.extracted.box_2d),
            candidates: item.candidates,
          });
        }
        return callJson({
          router: ai.router,
          input: {
            ...base,
            task: "rx_verify",
            estimateInputTokens: verifyItems.length * IMAGE_TOKENS + 1_000,
          },
          request: {
            system,
            messages: verifyMessages(verifyItems),
            jsonSchema: rxVerifyJsonSchema as unknown as Record<string, unknown>,
            maxOutputTokens: VERIFY_MAX_OUTPUT_TOKENS,
          },
          schema: rxVerifyAnswerSchema,
          signal: budget,
          attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
        });
      }, budget);
      cost += verification.costUsdMicros;
      await applyVerification(db, items, offered, verification.value as RxVerifyAnswer);
    }
    markSkipped(items, new Set(chosenForVerify));

    // 4. finalize: merge, duplicate-ingredient check, confidence, badge, validation.
    failedStep = "finalize";
    await events.step("finalize");
    const drugIds = items.flatMap((item) => (item.chosen === null ? [] : [item.chosen.drugId]));
    const result: RxResult = await withRetry(async () => {
      const ingredients = await ingredientsOf(db, [...new Set(drugIds)]);
      return buildResult(reading.extraction, items, ingredients);
    }, budget);

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
