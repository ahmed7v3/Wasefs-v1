import { z } from "zod";

/*
 * The analysis PDF of the Telegram bot (docs/TELEGRAM-BOT.md, "PDF"): the api asks the worker (the
 * only place with Typst) for the PDF of a finished analysis, and gets the storage key back.
 */

/** The job on the `documents` queue. */
export const TELEGRAM_RX_PDF_JOB = "telegram.rx-pdf";

export const TELEGRAM_PDF_LOCALES = ["ar", "en"] as const;
export type TelegramPdfLocale = (typeof TELEGRAM_PDF_LOCALES)[number];

export const telegramRxPdfPayloadSchema = z.object({
  analysisId: z.uuid(),
  locale: z.enum(TELEGRAM_PDF_LOCALES),
});
export type TelegramRxPdfPayload = z.output<typeof telegramRxPdfPayloadSchema>;
