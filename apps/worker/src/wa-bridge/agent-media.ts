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
} from "@wasfa/shared/schemas/wa-agent";

import { unwrapContent, type RawMessage } from "./inbound.js";

/*
 * What the agent reads from a WhatsApp message and what of it may be stored. Media is downloaded
 * with Baileys, checked against the limits (docs/WA-AGENT.md) and put in the private uploads bucket;
 * anything over a limit, of another type, or that fails to download becomes kind `other` without
 * media, and the agent says it could not open it. Nothing here logs content.
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

export function mediaAllowed(
  kind: "image" | "document" | "audio",
  mime: string | null,
): mime is string {
  if (mime === null) return false;
  if (kind === "image") return (WA_AGENT_IMAGE_MIMES as readonly string[]).includes(mime);
  if (kind === "document") return (WA_AGENT_DOCUMENT_MIMES as readonly string[]).includes(mime);
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

export interface MediaIo {
  /** The decrypted bytes of the message's media (Baileys). */
  download: (raw: RawMessage) => Promise<Buffer>;
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
  media?: NonNullable<WaAgentInbound["media"]>;
}

/**
 * Turns an image / PDF / voice note into stored media, or into kind `other` (limits, type, download
 * or storage failure). `io` is null when uploads storage is not configured.
 */
export async function ingestMedia(
  content: Extract<AgentContent, { kind: "image" | "document" | "audio" }>,
  raw: RawMessage,
  io: MediaIo | null,
  now: number,
): Promise<IngestedMedia> {
  const { kind, mime, bytes, seconds } = content;
  if (io === null || !mediaAllowed(kind, mime) || !withinLimits(kind, bytes, seconds)) {
    return { kind: "other" };
  }
  try {
    const body = await io.download(unwrapped(raw));
    if (!withinLimits(kind, body.length, seconds) || body.length === 0) return { kind: "other" };
    const key = mediaKeyFor(now);
    await io.put(key, body, mime);
    return {
      kind,
      media: {
        key,
        mime,
        bytes: body.length,
        ...(seconds === null ? {} : { seconds: Math.round(seconds) }),
      },
    };
  } catch {
    return { kind: "other" };
  }
}
