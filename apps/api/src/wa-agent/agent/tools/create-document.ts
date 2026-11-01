import {
  WA_DOCUMENT_LIMITS,
  WA_DOCUMENT_TEMPLATES,
  waCreateDocumentArgsSchema,
} from "@wasfa/shared/schemas/wa-document";

import { defineTool } from "./tool.js";

const L = WA_DOCUMENT_LIMITS;

/**
 * Makes a PDF (or a PNG card) the customer can keep, print or share, and sends it in the chat when it
 * is ready. The model supplies data only: the layouts are fixed templates in the worker, so nothing it
 * writes is ever markup. The result only says it started; the file arrives separately.
 */
export const createDocumentTool = defineTool({
  definition: {
    name: "create_document",
    description:
      "Create a file for the customer and send it in the chat: a PDF report or summary, a comparison or price table, a medication schedule, or a PNG card. Use it only when a file really helps (the customer asks for one, a long table or schedule, something to print or share); otherwise answer in the chat. Put only facts from tool results or this conversation in it, never data of other people, and for medical content only what a medical tool returned. Free of charge. The file is prepared in the background and sent separately, so tell the customer it is being prepared. Guests may use report and table only.",
    parameters: {
      type: "object",
      properties: {
        template: { type: "string", enum: [...WA_DOCUMENT_TEMPLATES] },
        language: {
          type: "string",
          enum: ["ar", "en"],
          description:
            "The language of the fixed labels of the file; default is the chat language.",
        },
        fileName: {
          type: "string",
          description: "A short file name without extension, in the language of the file.",
        },
        content: {
          type: "object",
          description: [
            "Plain text only (no markup). By template:",
            `report: { title (max ${String(L.title)}), subtitle?, sections: [{ heading, paragraphs: [text up to ${String(L.paragraph)} chars], bullets?: [text] }] (1-${String(L.sections)} sections), footerNote? }.`,
            `table: { title, columns: [1-${String(L.columns)} headings], rows: [[one cell per column]] (1-${String(L.rows)} rows), notes? }.`,
            `schedule (medication schedule, only from tool results): { title, rows: [{ medicine, dose, times: ["8:00 AM"], notes? }] } (1-${String(L.scheduleRows)} rows); the medical notice is added for you.`,
            `card (picture): { title (max 80), lines: [1-${String(L.cardLines)} short lines, max 120 chars each], footer? }.`,
          ].join("\n"),
        },
      },
      required: ["template", "fileName", "content"],
      additionalProperties: false,
    },
  },
  schema: waCreateDocumentArgsSchema,
  linkedOnly: false,
  effect: "write",
  handler: (ctx, args, effect) =>
    ctx.deps.documents.create({
      ...(effect === undefined ? {} : { effectKey: effect.key }),
      conversationId: ctx.conversationId,
      linked: ctx.userId !== null,
      language: ctx.config.language === "en" ? "en" : "ar",
      args,
      now: ctx.now,
    }),
});
