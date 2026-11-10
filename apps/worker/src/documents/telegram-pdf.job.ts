import { rxResultSchema } from "@wasfa/shared/schemas/rx";
import { UnrecoverableError } from "bullmq";

import { findAnalysis } from "../rx/repo.js";

import { createRxPdf } from "./rx-pdf.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type TelegramPdfContext = Pick<JobContext, "db" | "logger" | "storage" | "documents" | "env">;

/**
 * `telegram.rx-pdf`: renders the PDF of a FINISHED analysis in the language the Telegram chat uses,
 * with the same Typst template and renderer as the WhatsApp agent, and returns the storage key (the
 * api waits for the job and reads the bytes). The api checked that the analysis is the user's before
 * asking; the worker only needs it to be done. Logs ids and codes, never content.
 */
export async function telegramRxPdfJob(
  { analysisId, locale }: JobPayload<"documents", "telegram.rx-pdf">,
  { db, logger, storage, documents, env }: TelegramPdfContext,
): Promise<string> {
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  if (documents === undefined) throw new Error("The document renderer is not configured");

  const row = await findAnalysis(db, analysisId);
  if (row === null || row.status !== "done") {
    // Trying again cannot make an unfinished or missing analysis readable.
    throw new UnrecoverableError("analysis_not_ready");
  }
  const result = rxResultSchema.safeParse(row.result);
  if (!result.success) throw new UnrecoverableError("analysis_result_invalid");

  const key = await createRxPdf(analysisId, {
    documents,
    storage,
    logger,
    language: () => Promise.resolve(locale),
    link: (id) => (env === undefined ? null : `${env.WEB_ORIGIN}/analyze/${id}`),
  }).render(result.data, locale);
  if (key === null) throw new Error("pdf_render_failed");
  logger.info({ analysisId, locale }, "Telegram analysis PDF rendered");
  return key;
}
