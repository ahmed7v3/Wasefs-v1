import { Injectable } from "@nestjs/common";
import {
  WA_AGENT_VISION_MIMES,
  WA_AGENT_MAX_AUDIO_BYTES,
  WA_AGENT_MAX_FILE_BYTES,
  WA_AGENT_MAX_TEXT,
} from "@wasfa/shared/schemas/wa-agent";

import { ObjectStorage } from "../../files/object-storage.js";
import { WaAgentRepo } from "../conversation/conversation.repo.js";
import { VoiceError } from "../voice/elevenlabs.client.js";
import { WaAgentVoiceService } from "../voice/voice.service.js";

import type { TurnImage } from "./agent-prompt.js";
import type { TurnMessage } from "@wasfa/db";
import type { WaAgentSettings } from "@wasfa/shared/settings";

const MAX_IMAGES = 4;
/** Voice notes transcribed per turn (each one costs ElevenLabs time). */
const MAX_TRANSCRIPTS = 5;

/** What the customer sent besides text: pictures read for the model, voice notes turned into words. */
@Injectable()
export class MediaInputService {
  constructor(
    private readonly repo: WaAgentRepo,
    private readonly storage: ObjectStorage,
    private readonly voice: WaAgentVoiceService,
  ) {}

  /** The customer's pictures of this turn (at most 4, 10 MB each), read from the private uploads bucket. */
  async loadImages(pending: readonly TurnMessage[]): Promise<TurnImage[]> {
    const wanted = pending
      .filter(
        (message) =>
          message.kind === "image" &&
          message.mediaKey !== null &&
          message.mediaMime !== null &&
          (WA_AGENT_VISION_MIMES as readonly string[]).includes(message.mediaMime) &&
          (message.mediaBytes ?? 0) <= WA_AGENT_MAX_FILE_BYTES,
      )
      .slice(-MAX_IMAGES);
    const images: TurnImage[] = [];
    for (const message of wanted) {
      if (message.mediaKey === null || message.mediaMime === null) continue;
      try {
        images.push({
          messageId: message.id,
          mime: message.mediaMime,
          data: await this.storage.getBytes(message.mediaKey, WA_AGENT_MAX_FILE_BYTES),
        });
      } catch {
        // The picture shows up as a placeholder; the rest of the turn goes on.
      }
    }
    return images;
  }

  /**
   * Turns this turn's voice notes into text (ElevenLabs speech to text), stores the words as the
   * message's text and returns the rows as the model should see them: any audio row that has words
   * (a transcript, or the words of a voice reply) reads as text. A note that cannot be transcribed
   * stays a placeholder and carries `meta.transcribeError`.
   */
  async transcribePending(
    rows: readonly TurnMessage[],
    pending: readonly TurnMessage[],
    config: WaAgentSettings,
  ): Promise<TurnMessage[]> {
    const texts = new Map<string, string>();
    const wanted = pending
      .filter((message) => message.kind === "audio" && (message.text?.trim() ?? "") === "")
      .slice(-MAX_TRANSCRIPTS);
    if (wanted.length > 0 && config.voice.enabled && config.voice.transcribeIncoming) {
      if (await this.voice.ready(config.voice)) {
        for (const message of wanted) {
          const text = await this.transcribeOne(message);
          if (text !== null) texts.set(message.id, text);
        }
      }
    }
    return rows.map((row) => {
      const text = texts.get(row.id) ?? row.text;
      const said = text?.trim() ?? "";
      return row.kind === "audio" && said !== ""
        ? { ...row, kind: "text" as const, text: said }
        : row;
    });
  }

  async transcribeOne(message: TurnMessage): Promise<string | null> {
    const fail = async (code: string): Promise<null> => {
      await this.repo.setMeta([message.id], { transcribeError: code }).catch(() => undefined);
      return null;
    };
    if (
      message.mediaKey === null ||
      message.mediaMime === null ||
      (message.mediaBytes ?? 0) > WA_AGENT_MAX_AUDIO_BYTES
    ) {
      return fail("no_audio");
    }
    let audio: Uint8Array;
    try {
      audio = await this.storage.getBytes(message.mediaKey, WA_AGENT_MAX_AUDIO_BYTES);
    } catch {
      return fail("read_failed");
    }
    try {
      // No language hint: customers mix Arabic and English, and the API detects the language itself.
      const transcript = await this.voice.transcribe(audio, message.mediaMime);
      const text = transcript.text.trim().slice(0, WA_AGENT_MAX_TEXT);
      if (text === "") return await fail("empty");
      await this.repo.setText(message.id, text, { transcribed: true });
      return text;
    } catch (error) {
      return fail(error instanceof VoiceError ? error.code : "failed");
    }
  }
}
