import { t, type Locale } from "@wasfa/shared/i18n";

import { formatHandle, normalizeHandle } from "../conversation/attachment-handle.js";

import type { MediaInputService } from "./media-input.js";
import type { AttachmentsService } from "../conversation/attachments.service.js";
import type { AgentToolResult, AttachmentViewPort } from "./tools/tool.js";
import type { ToolLoopCallInput } from "@wasfa/ai";

/** Pictures the model may look at through `view_attachment` in one turn (docs/WA-AGENT-RUNTIME.md §8.1). */
export const MAX_VIEWS_PER_TURN = 2;

interface ViewedImage {
  handle: number;
  mime: string;
  data: Uint8Array;
}

/**
 * One turn's `view_attachment` state. The tool loop in `@wasfa/ai` carries only text in a tool result,
 * so the pixels travel another way: `request` loads the picture and queues it, and `withViewedImages`
 * appends it to the NEXT model step as a user message (a picture and a caption). The model sees it for
 * that step only; the answer it gives from it stays in the conversation.
 */
export class AttachmentViews implements AttachmentViewPort {
  private readonly queued: ViewedImage[] = [];
  private used = 0;

  constructor(
    private readonly sessionId: string,
    private readonly attachments: Pick<AttachmentsService, "find">,
    private readonly media: Pick<MediaInputService, "loadOne">,
    private readonly now: () => Date,
    readonly locale: Locale,
  ) {}

  async request(raw: string | number): Promise<AgentToolResult> {
    if (this.used >= MAX_VIEWS_PER_TURN) return { error: "view_limit" };
    const handle = normalizeHandle(raw);
    const found =
      handle === null ? null : await this.attachments.find(this.sessionId, handle, this.now());
    if (handle === null || found === null) return { error: "unknown_handle" };
    if (found.kind !== "image") return { error: "no_image" };
    if (found.status.kind === "expired" || found.status.kind === "failed") {
      return { error: "not_ready" };
    }
    const image = await this.media.loadOne({
      mediaKey: found.mediaKey,
      mediaMime: found.mediaMime,
      mediaBytes: found.mediaBytes,
    });
    if (image === null) return { error: "view_unavailable" };
    this.used += 1;
    this.queued.push({ handle, ...image });
    return { ok: true, handle: formatHandle(handle) };
  }

  /** The pictures asked for since the last model step, handed over once. */
  take(): ViewedImage[] {
    return this.queued.splice(0);
  }
}

/** The step with the pictures the model asked to see appended as one user message; unchanged without any. */
export function withViewedImages(
  step: ToolLoopCallInput,
  views: AttachmentViews | undefined,
): ToolLoopCallInput {
  const images = views?.take() ?? [];
  const locale = views?.locale ?? "ar";
  if (images.length === 0) return step;
  return {
    ...step,
    messages: [
      ...step.messages,
      {
        role: "user",
        parts: images.flatMap((image) => [
          { type: "image" as const, mime: image.mime, data: image.data },
          {
            type: "text" as const,
            text: t("whatsapp.agent.tools.viewCaption", { handle: image.handle }, locale),
          },
        ]),
      },
    ],
  };
}
