import { newId } from "@wasfa/shared/ids";
import { waDocumentFormat, waDocumentKey } from "@wasfa/shared/schemas/wa-document";

import { pushWaAgentEvent } from "../notifications/wa-agent-events.js";

import { documentRequest } from "./data.js";
import { renderReason } from "./renderer.js";

import type { JobContext } from "../queues.js";
import type { JobPayload } from "@wasfa/shared/queues";

type DocumentContext = Pick<JobContext, "redis" | "logger" | "storage" | "documents">;

const CONTENT_TYPE = { pdf: "application/pdf", png: "image/png" } as const;

/**
 * `wa-agent.render-document`: renders the file the agent asked for, stores it under
 * `wa/out/<yyyy>/<mm>/<uuid>.<pdf|png>` and tells the api on `wa:agent:events`. A render that cannot be
 * done again by trying (bad output, timeout) ends as `document_failed` so the customer is told; the
 * object is removed when the ready event cannot be pushed, so nothing is stored that no message
 * points to. Logs the template, the conversation id and codes, never the content.
 */
export async function waAgentRenderDocumentJob(
  payload: JobPayload<"documents", "wa-agent.render-document">,
  { redis, logger, storage, documents }: DocumentContext,
  now = new Date(),
): Promise<void> {
  const { conversationId, template } = payload;
  if (storage === undefined) {
    throw new Error("Uploads storage is not configured (R2_UPLOADS_* are not set)");
  }
  if (documents === undefined) throw new Error("The document renderer is not configured");

  const format = waDocumentFormat(template);
  const key = waDocumentKey(now, newId(), format);
  let stored = false;
  try {
    const { bytes, pages } = await documents.render(documentRequest(payload, now));
    await storage.put(key, bytes, CONTENT_TYPE[format]);
    stored = true;
    await pushWaAgentEvent(redis, {
      type: "document_ready",
      conversationId,
      mediaKey: key,
      fileName: `${payload.fileName}.${format}`,
      kind: format === "png" ? "image" : "document",
    });
    logger.info(
      { conversationId, template, pages, bytes: bytes.length },
      "WhatsApp agent document rendered",
    );
  } catch (error) {
    if (stored) await storage.remove(key).catch(() => undefined);
    logger.warn(
      { conversationId, template, reason: renderReason(error) },
      "Document render failed",
    );
    try {
      await pushWaAgentEvent(redis, { type: "document_failed", conversationId });
    } catch (pushError) {
      // Redis is the one thing both events need: let the queue retry the whole job.
      logger.warn({ conversationId, reason: renderReason(pushError) }, "Document event not queued");
      throw pushError;
    }
  }
}
