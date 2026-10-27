import { newId } from "@wasfa/shared/ids";
import { waDocumentKey } from "@wasfa/shared/schemas/wa-document";

import { rxResultRequest } from "./data.js";
import { renderReason, type DocumentRenderer } from "./renderer.js";

import type { RxPdfPort } from "../rx/events.js";
import type { ObjectStore } from "../storage/object-store.js";
import type { Locale } from "@wasfa/shared/i18n";
import type { Logger } from "pino";

export interface RxPdfDeps {
  documents: DocumentRenderer;
  storage: ObjectStore;
  logger: Logger;
  /** The language of the WhatsApp agent (`waAgent.language`). */
  language: () => Promise<Locale>;
  /** The result page on the web, or null when no origin is known. */
  link: (analysisId: string) => string | null;
}

/**
 * Renders the finished reading as a PDF into `wa/out/` for the agent's follow-up. Any failure gives
 * `null` (the text result is sent anyway); only the error code is logged.
 */
export function createRxPdf(analysisId: string, deps: RxPdfDeps): RxPdfPort {
  return {
    async render(result) {
      try {
        const language = await deps.language();
        const now = new Date();
        const { bytes } = await deps.documents.render(
          rxResultRequest(result, deps.link(analysisId), language, now),
        );
        const key = waDocumentKey(now, newId(), "pdf");
        await deps.storage.put(key, bytes, "application/pdf");
        return key;
      } catch (error) {
        deps.logger.warn({ analysisId, reason: renderReason(error) }, "rx PDF not rendered");
        return null;
      }
    },
    async discard(key) {
      await deps.storage.remove(key).catch(() => undefined);
    },
  };
}
