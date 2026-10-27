import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { PinoLogger } from "nestjs-pino";

import { REDIS } from "../../common/redis.js";
import { ObjectStorage } from "../../files/object-storage.js";

import { ElevenLabsClient, VoiceError, type Transcript } from "./elevenlabs.client.js";
import { VoiceKeyService } from "./voice-key.service.js";
import { speechText } from "./voice-text.js";

import type { WaAgentSettings } from "@wasfa/shared/settings";

type VoiceConfig = WaAgentSettings["voice"];

const DAY_SECONDS = 86_400;
/** A test clip is deleted this long after it was made (its link lives 60 s). */
const TEST_CLIP_TTL_MS = 5 * 60_000;

/** Characters spoken today (UTC), the daily cap's counter. */
export const ttsCharsKey = (at: Date) =>
  `wa:agent:tts:${at.toISOString().slice(0, 10).replaceAll("-", "")}`;

export interface SpokenReply {
  /** Object key of the Ogg/Opus clip in the uploads bucket. */
  mediaKey: string;
  /** Characters sent to ElevenLabs (what the daily cap counts). */
  chars: number;
}

export interface TestClip {
  mediaKey: string;
  mime: string;
  chars: number;
}

const objectKey = (area: "out" | "test", at: Date, extension: "ogg" | "mp3") =>
  `wa/${area}/${String(at.getUTCFullYear())}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extension}`;

/**
 * Voice for the WhatsApp agent: speech to text for customers' voice notes and text to speech for the
 * agent's spoken replies, with the daily character cap. Every failure is a quiet `null` / typed
 * `VoiceError` for the caller to turn into "stay text": voice is never required for an answer.
 */
@Injectable()
export class WaAgentVoiceService {
  /** Replaced by tests. */
  scheduleRemoval: (key: string) => void = (key) => {
    setTimeout(() => {
      this.storage.remove(key).catch(() => undefined);
    }, TEST_CLIP_TTL_MS).unref();
  };

  constructor(
    private readonly keys: VoiceKeyService,
    private readonly client: ElevenLabsClient,
    private readonly storage: ObjectStorage,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("WaAgentVoice");
  }

  /** Voice is on in the settings and a key is stored. */
  async ready(config: VoiceConfig): Promise<boolean> {
    return config.enabled && (await this.keys.isSet());
  }

  transcribe(audio: Uint8Array, mime: string, languageCode?: string): Promise<Transcript> {
    return this.client.transcribe(audio, mime, languageCode ? { languageCode } : {});
  }

  /**
   * Speaks `text` and stores the clip. Null (with a log line) when the daily cap is used up, there is no
   * voice id, or ElevenLabs / storage failed: the caller sends the text instead.
   */
  async speak(text: string, config: VoiceConfig, now: Date): Promise<SpokenReply | null> {
    const spoken = speechText(text);
    if (spoken === "" || config.voiceId === "") return null;
    const key = ttsCharsKey(now);
    const chars = spoken.length;
    let reserved = false;
    try {
      const total = await this.redis.incrby(key, chars);
      reserved = true;
      await this.redis.expire(key, 2 * DAY_SECONDS);
      if (total > config.dailyCharCap) {
        await this.refund(key, chars);
        this.logger.info({ chars, cap: config.dailyCharCap }, "Voice daily character cap reached");
        return null;
      }
      const clip = await this.synthesizeAndStore(spoken, config, "out", now);
      return { mediaKey: clip.mediaKey, chars };
    } catch (error) {
      if (reserved) await this.refund(key, chars);
      // A reply must be an Ogg/Opus voice note; an account that only gets mp3 stays on text.
      const reason =
        error instanceof VoiceError
          ? error.code === "format_not_allowed"
            ? "voice_format_unavailable"
            : error.code
          : "storage_failed";
      this.logger.warn({ reason }, "Voice reply not made");
      return null;
    }
  }

  /**
   * The admin's "Test voice": same settings, not counted against the daily cap, and an mp3 clip is fine
   * for listening. Throws `VoiceError` (`storage_failed` when the clip could not be saved).
   */
  async test(text: string, config: VoiceConfig, now: Date): Promise<TestClip> {
    if (config.voiceId === "") throw new VoiceError("failed");
    const spoken = speechText(text);
    if (spoken === "") throw new VoiceError("failed");
    const clip = await this.synthesizeAndStore(spoken, config, "test", now);
    this.scheduleRemoval(clip.mediaKey);
    return { mediaKey: clip.mediaKey, mime: clip.mime, chars: spoken.length };
  }

  /** Removes a clip nobody will play (the reply could not be queued). */
  async discard(mediaKey: string): Promise<void> {
    await this.storage.remove(mediaKey).catch(() => undefined);
  }

  private async synthesizeAndStore(
    spoken: string,
    config: VoiceConfig,
    area: "out" | "test",
    now: Date,
  ): Promise<{ mediaKey: string; mime: string }> {
    const synthesis = await this.client.synthesize(spoken, {
      voiceId: config.voiceId,
      modelId: config.modelId,
      stability: config.stability,
      similarityBoost: config.similarityBoost,
      // WhatsApp plays only Ogg/Opus as a voice note (the bridge labels every clip that way).
      requireVoiceNote: area === "out",
    });
    const mediaKey = objectKey(area, now, synthesis.voiceNote ? "ogg" : "mp3");
    try {
      await this.storage.put(mediaKey, synthesis.audio, synthesis.mime);
    } catch {
      throw new VoiceError("storage_failed");
    }
    return { mediaKey, mime: synthesis.mime };
  }

  private async refund(key: string, chars: number): Promise<void> {
    await this.redis.decrby(key, chars).catch(() => undefined);
  }
}
