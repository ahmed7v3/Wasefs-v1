import { randomUUID } from "node:crypto";

import {
  WA_AGENT_DOCUMENT_MIMES,
  WA_AGENT_IMAGE_MIMES,
  WA_AGENT_MAX_AUDIO_BYTES,
  WA_AGENT_MAX_AUDIO_SECONDS,
  WA_AGENT_MAX_FILE_BYTES,
  WA_AGENT_MAX_TEXT,
  WA_AGENT_MEDIA_PREFIX,
  type WaAgentInbound,
  type WaAgentKind,
  type WaMediaStatus,
} from "@wasfa/shared/schemas/wa-agent";

import { downloadWithRetries, type DownloadIo } from "./agent-media-download.js";
import { unwrapContent, type RawMessage } from "./inbound.js";

/*
 * What the agent reads from a WhatsApp message and what of it may be stored. Media is downloaded
 * with Baileys, checked against the limits (docs/WA-AGENT.md) and put in the private uploads bucket;
 * anything over a limit, of another type, or that fails to download keeps its kind with a typed
 * `mediaStatus` and no media; the agent turn says why. `other` is only for content it cannot read
 * (video, sticker, location, contact). Nothing here logs content.
 */

export type AgentContent =
  | { kind: "text"; text: string }
  | {
      kind: "image" | "document" | "audio";
      text: string | null;
      mime: string | null;
      bytes: number | null;
      seconds: number | null;
    }
  | { kind: "other"; text: string | null };

function longToNumber(
  value: number | { toNumber: () => number } | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : value.toNumber();
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** The mime type without its parameters (`audio/ogg; codecs=opus` to `audio/ogg`), lower-cased. */
function baseMime(mime: string | null | undefined): string | null {
  const base = mime?.split(";")[0]?.trim().toLowerCase();
  return base ? base : null;
}

function caption(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, WA_AGENT_MAX_TEXT) : null;
}

/**
 * Classifies one message. `null` = nothing to answer (a reaction, a protocol message, an empty
 * text); content the agent cannot read (video, sticker, location, contact) is kind `other`.
 */
export function agentContentOf(raw: RawMessage["message"]): AgentContent | null {
  // Wrapped content (disappearing, view-once, edited, ...) is read like plain content.
  const message = unwrapContent(raw);
  if (!message) return null;
  const text = message.conversation ?? message.extendedTextMessage?.text;
  if (typeof text === "string") {
    return text.trim() === "" ? null : { kind: "text", text: text.slice(0, WA_AGENT_MAX_TEXT) };
  }
  if (message.imageMessage) {
    const { imageMessage: image } = message;
    return {
      kind: "image",
      text: caption(image.caption),
      mime: baseMime(image.mimetype),
      bytes: longToNumber(image.fileLength),
      seconds: null,
    };
  }
  if (message.documentMessage) {
    const { documentMessage: document } = message;
    return {
      kind: "document",
      text: caption(document.caption),
      mime: baseMime(document.mimetype),
      bytes: longToNumber(document.fileLength),
      seconds: null,
    };
  }
  if (message.audioMessage) {
    const { audioMessage: audio } = message;
    return {
      kind: "audio",
      text: null,
      mime: baseMime(audio.mimetype),
      bytes: longToNumber(audio.fileLength),
      seconds: audio.seconds ?? null,
    };
  }
  if (
    message.videoMessage ||
    message.stickerMessage ||
    message.locationMessage ||
    message.liveLocationMessage ||
    message.contactMessage ||
    message.contactsArrayMessage
  ) {
    return { kind: "other", text: null };
  }
  return null;
}

/** The raw message with its disappearing-message wrapper removed (what Baileys downloads from). */
export function unwrapped(raw: RawMessage): RawMessage {
  return { ...raw, message: unwrapContent(raw.message) };
}

const isImageMime = (mime: string) => (WA_AGENT_IMAGE_MIMES as readonly string[]).includes(mime);

export function mediaAllowed(
  kind: "image" | "document" | "audio",
  mime: string | null,
): mime is string {
  if (mime === null) return false;
  // An image sent "as a document" (the usual way to send a HEIC original) is still an image.
  if (kind === "image") return isImageMime(mime);
  if (kind === "document") {
    return isImageMime(mime) || (WA_AGENT_DOCUMENT_MIMES as readonly string[]).includes(mime);
  }
  return mime.startsWith("audio/");
}

/** Declared or actual size and length against the limits of the kind. */
export function withinLimits(
  kind: "image" | "document" | "audio",
  bytes: number | null,
  seconds: number | null,
): boolean {
  const maxBytes = kind === "audio" ? WA_AGENT_MAX_AUDIO_BYTES : WA_AGENT_MAX_FILE_BYTES;
  if (bytes !== null && bytes > maxBytes) return false;
  return !(kind === "audio" && seconds !== null && seconds > WA_AGENT_MAX_AUDIO_SECONDS);
}

export interface MediaIo extends DownloadIo {
  /** The private uploads bucket. */
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
}

/** `wa/<yyyy>/<mm>/<uuid>` */
export function mediaKeyFor(now: number, id: string = randomUUID()): string {
  const iso = new Date(now).toISOString();
  return `${WA_AGENT_MEDIA_PREFIX}${iso.slice(0, 4)}/${iso.slice(5, 7)}/${id}`;
}

export interface IngestedMedia {
  kind: WaAgentKind;
  /** `ok` with `media`; otherwise why there is no stored file. The kind is kept either way. */
  mediaStatus: WaMediaStatus;
  media?: NonNullable<WaAgentInbound["media"]>;
}

/**
 * Turns an image / PDF / voice note into stored media. A failure keeps the semantic kind (the agent
 * knows a photo was sent) with a typed `mediaStatus` and no media key. `io` is null when uploads
 * storage is not configured.
 */
export async function ingestMedia(
  content: Extract<AgentContent, { kind: "image" | "document" | "audio" }>,
  raw: RawMessage,
  io: MediaIo | null,
  now: number,
): Promise<IngestedMedia> {
  const { mime, bytes, seconds } = content;
  const kind =
    content.kind === "document" && mime !== null && isImageMime(mime) ? "image" : content.kind;
  const failed = (mediaStatus: Exclude<WaMediaStatus, "ok">): IngestedMedia => ({
    kind,
    mediaStatus,
  });
  if (io === null) return failed("storage_unavailable");
  if (!mediaAllowed(content.kind, mime)) return failed("unsupported_type");
  if (!withinLimits(content.kind, bytes, seconds)) return failed("too_large");

  const downloaded = await downloadWithRetries(io, unwrapped(raw));
  if (!downloaded.ok) return failed(downloaded.reason);
  const { body } = downloaded;
  if (body.length === 0) return failed("download_failed");
  if (!withinLimits(content.kind, body.length, seconds)) return failed("too_large");
  const key = mediaKeyFor(now);
  try {
    await io.put(key, body, mime);
  } catch {
    return failed("storage_unavailable");
  }
  return {
    kind,
    mediaStatus: "ok",
    media: {
      key,
      mime,
      bytes: body.length,
      ...(seconds === null ? {} : { seconds: Math.round(seconds) }),
    },
  };
}
