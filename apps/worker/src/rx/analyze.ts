import { LedgerError, recordUnmatchedNames, type Database } from "@wasfa/db";
import { isAppError } from "@wasfa/shared/errors";
import { sanitizeExtraction } from "@wasfa/shared/rx-sanitize";
import {
  rxDetailsAnswerSchema,
  rxDetailsJsonSchema,
  rxExtractionJsonSchema,
  rxExtractionSchema,
  rxVerifyAnswerSchema,
  rxVerifyJsonSchema,
  type RX_STEPS,
  type RxExtraction,
  type RxResult,
  type RxVerifyAnswer,
} from "@wasfa/shared/schemas/rx";

import { cropRegion } from "./crop.js";
import { RxStepError, callJson, type ModelCall } from "./model-call.js";
import {
  applyVerification,
  buildResult,
  isReadable,
  markSkipped,
  matchItems,
  modelItems,
  pickForVerification,
  unmatchedReadings,
  withDetails,
  type WorkItem,
} from "./pipeline.js";
import {
  detailsMessages,
  readMessages,
  systemPrompt,
  verifyMessages,
  type VerifyItem,
} from "./prompts.js";
import { ingredientsOf } from "./repo.js";

import type { Router, RouterInput } from "@wasfa/ai";
import type { MedicationSettings } from "@wasfa/shared/settings";

export type RxStep = (typeof RX_STEPS)[number];

/** One provider attempt; the rest of the budget is left for the fallback route. */
const ATTEMPT_TIMEOUT_MS = 40_000;
const READ_MAX_OUTPUT_TOKENS = 8_192;
const VERIFY_MAX_OUTPUT_TOKENS = 2_048;
/** The details step is text in, text out: short, and never worth failing an analysis for. */
const DETAILS_TIMEOUT_MS = 35_000;
const DETAILS_MAX_OUTPUT_TOKENS = 4_096;
/** Gemini bills an image at a fixed token count; used only for the spend estimate. */
const IMAGE_TOKENS = 1_120;

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

/** What the router needs besides the request: who it is for, which plan's route and which mode. */
export type AnalyzeBase = Pick<
  RouterInput,
  "mode" | "planId" | "ownerUserId" | "ownerOrgId" | "userId" | "requestId"
>;

export interface AnalyzeArgs {
  db: Database;
  router: Router;
  /** The processed JPEG of each page, in order. */
  images: readonly Buffer[];
  base: AnalyzeBase;
  /** `rx.verifyMaxItems`: how many flagged lines the verification step may re-read. */
  verifyMaxItems: number;
  /**
   * The `medications` settings. Recognition uses the drug database iff `enabled && mode === "hybrid"`;
   * otherwise the model's reading stands alone.
   */
  medications: MedicationSettings;
  /** `rx.details`: add purpose, side effects, precautions and an overview from a text-only call. */
  details: boolean;
  /** The whole-analysis budget. */
  signal: AbortSignal;
  /** Called as each step starts (progress events, the step named in a failure log). */
  onStep?: (step: RxStep, state: { verifying: boolean }) => Promise<void>;
}

export interface AnalyzeOutput {
  result: RxResult;
  /** Provider cost of every call made (read, repair, verify), integer USD micros. */
  costUsdMicros: number;
  /** Route version and `ai_usage` row of the read call. */
  routeVersion: number;
  usageId: string | null;
}

interface Reading {
  extraction: RxExtraction;
  calls: ModelCall<RxExtraction>;
}

/**
 * The model-and-code part of a prescription analysis, with no credits and no user rows: read all
 * pages, match to the drug database, re-read the flagged lines, and finalize into a validated
 * `RxResult`. `rx.analyze` wraps it with the analysis row, events and credits; accuracy evaluation
 * (Task 2.10) wraps it with a scorer, so both measure the very same pipeline.
 */
export async function analyzeImages(args: AnalyzeArgs): Promise<AnalyzeOutput> {
  const { db, router, images, base, verifyMaxItems, signal: budget } = args;
  const { medications } = args;
  const matching = medications.enabled && medications.mode === "hybrid" ? "database" : "model";
  const step = args.onStep ?? (() => Promise.resolve());
  const system = systemPrompt();

  // 1. read: all pages in one call.
  await step("read", { verifying: false });
  const reading: Reading = await withRetry(async () => {
    const calls = await callJson({
      router,
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
    // Directions and bullets the model copied into a field go where they belong before anything matches.
    return { extraction: sanitizeExtraction(calls.value), calls };
  }, budget);
  let cost = reading.calls.costUsdMicros;
  const { routeVersion, usageId } = reading.calls;

  // 2. match and 3. verify: only with the drug database. Without it the model's reading stands.
  let items: WorkItem[];
  if (matching === "model") {
    items = modelItems(reading.extraction);
  } else {
    await step("match", { verifying: false });
    items = await withRetry(() => matchItems(db, reading.extraction, medications), budget);

    const chosenForVerify = pickForVerification(items, verifyMaxItems).filter((index) => {
      const item = items[index];
      return item !== undefined && item.extracted.page < images.length;
    });
    if (chosenForVerify.length > 0) {
      await step("verify", { verifying: true });
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
          router,
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
      await applyVerification(
        db,
        items,
        offered,
        verification.value as RxVerifyAnswer,
        medications,
      );
    }
    markSkipped(items, new Set(chosenForVerify));
  }

  // 4. finalize: merge, duplicate-ingredient check, confidence, badge, validation.
  await step("finalize", { verifying: false });
  const drugIds = items.flatMap((item) => (item.chosen === null ? [] : [item.chosen.drugId]));
  let result: RxResult = await withRetry(async () => {
    const ingredients =
      matching === "model" ? new Map() : await ingredientsOf(db, [...new Set(drugIds)]);
    return buildResult(reading.extraction, items, ingredients, matching);
  }, budget);

  // The unmatched-names queue: best effort, and only the reading itself (no user, image or other text).
  if (matching === "database" && medications.logUnmatched) {
    const readings = unmatchedReadings(items, result);
    if (readings.length > 0) await recordUnmatchedNames(db, readings).catch(() => undefined);
  }

  // The general information: best effort, never the reason an analysis fails.
  if (args.details) {
    const lines = result.items.flatMap((item, index) =>
      isReadable(item) && (item.name ?? "").trim() !== ""
        ? [
            {
              index,
              name: item.name ?? "",
              activeIngredient: item.activeIngredients[0] ?? null,
              strength: item.strength,
              form: item.form,
            },
          ]
        : [],
    );
    if (lines.length === 0) {
      result = { ...result, detailsStatus: "unavailable" };
    } else {
      try {
        const answer = await callJson({
          router,
          input: {
            ...base,
            task: "rx_extract",
            estimateInputTokens: Math.ceil(system.length / 4) + lines.length * 40,
          },
          request: {
            system,
            messages: detailsMessages(lines),
            jsonSchema: rxDetailsJsonSchema as unknown as Record<string, unknown>,
            maxOutputTokens: DETAILS_MAX_OUTPUT_TOKENS,
          },
          schema: rxDetailsAnswerSchema,
          signal: AbortSignal.any([budget, AbortSignal.timeout(DETAILS_TIMEOUT_MS)]),
          attemptTimeoutMs: DETAILS_TIMEOUT_MS,
        });
        cost += answer.costUsdMicros;
        result = withDetails(result, answer.value);
      } catch {
        result = { ...result, detailsStatus: "unavailable" };
      }
    }
  }

  return { result, costUsdMicros: cost, routeVersion, usageId };
}
