import { buildHistory } from "./agent-prompt.js";
import { AttachmentViews } from "./attachment-views.js";
import { renderAttachments } from "./attachments-prompt.js";
import { roundSystemPrompt } from "./context.js";

import type { MediaInputService } from "./media-input.js";
import type { ComposeInput } from "./round-helpers.js";
import type { AttachmentsService } from "../conversation/attachments.service.js";
import type { NormalizedMessage } from "@wasfa/ai";

/**
 * What a round tells the model: the system prompt (with the session's attachments block in v2), the
 * conversation (history with media handles and tool notes, the burst's pictures attached; or the
 * re-ask's own transcript) and, in v2, the turn's `view_attachment` window.
 */
export async function roundPrompt(
  deps: { media: MediaInputService; attachments: AttachmentsService | undefined },
  input: ComposeInput,
  system: Parameters<typeof roundSystemPrompt>[0],
): Promise<{ system: string; messages: NormalizedMessage[]; views: AttachmentViews | undefined }> {
  const { media, attachments } = deps;
  const { sessionId, rows, pending, config } = input;
  const locale = config.language === "en" ? "en" : "ar";
  const session =
    sessionId !== undefined && attachments !== undefined ? { sessionId, attachments } : null;
  const list = session === null ? [] : await session.attachments.list(session.sessionId, input.now);
  const messages =
    input.reaskFrom !== undefined
      ? [...input.reaskFrom]
      : buildHistory(
          await media.transcribePending(rows, pending, config),
          await media.loadImages(pending),
          locale,
        );
  return {
    system: roundSystemPrompt({ ...system, attachments: renderAttachments(list, locale) }),
    messages,
    views:
      session === null
        ? undefined
        : new AttachmentViews(
            session.sessionId,
            session.attachments,
            media,
            () => input.now,
            locale,
          ),
  };
}
