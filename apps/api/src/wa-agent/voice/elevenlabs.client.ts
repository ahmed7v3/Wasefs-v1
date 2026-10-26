import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { VoiceKeyService } from "./voice-key.service.js";

/*
 * ElevenLabs over plain fetch (docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 * and .../text-to-speech/convert). Speech to text: `scribe_v2`. Text to speech: Ogg/Opus
 * (`opus_48000_64`), which WhatsApp plays as a voice note. The key goes in the `xi-api-key` header
 * only. Logs carry byte / character counts, durations and error codes: never the key, a text or audio.
 */

const BASE_URL = "https://api.elevenlabs.io";
export const STT_MODEL = "scribe_v2";
/** The default of the API, and a multilingual model that speaks Arabic. */
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
export const TTS_OUTPUT_FORMAT = "opus_48000_64";
export const TTS_MIME = "audio/ogg";
const TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = 600;
const MAX_RETRY_AFTER_MS = 3_000;

export type VoiceErrorCode = "no_key" | "unauthorized" | "rate_limited" | "failed";

export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = "VoiceError";
  }
}

export interface Transcript {
  text: string;
  languageCode?: string;
  seconds?: number;
}

export interface SynthesisOptions {
  voiceId: string;
  /** Empty = the API's default multilingual model. */
  modelId?: string;
  stability?: number | undefined;
  similarityBoost?: number | undefined;
}

export interface Synthesis {
  audio: Uint8Array;
  mime: string;
}

@Injectable()
export class ElevenLabsClient {
  /** Replaced by tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });

  constructor(
    private readonly keys: VoiceKeyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext("ElevenLabs");
  }

  async transcribe(
    audio: Uint8Array,
    mime: string,
    options: { languageCode?: string } = {},
  ): Promise<Transcript> {
    const key = await this.requireKey();
    const type = mime.split(";")[0]?.trim() || "application/octet-stream";
    const form = new FormData();
    form.set("model_id", STT_MODEL);
    // "(laughter)" style tags would end up in the customer's text.
    form.set("tag_audio_events", "false");
    if (options.languageCode) form.set("language_code", options.languageCode);
    form.set("file", new Blob([new Uint8Array(audio)], { type }), "voice-note");

    const started = Date.now();
    const response = await this.send("stt", `${BASE_URL}/v1/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": key },
      body: form,
    });
    const body = (await response.json().catch(() => null)) as {
      text?: unknown;
      language_code?: unknown;
      audio_duration_secs?: unknown;
    } | null;
    if (!body || typeof body.text !== "string") throw this.fail("stt", new VoiceError("failed"));
    this.logger.info(
      { op: "stt", bytes: audio.byteLength, chars: body.text.length, ms: Date.now() - started },
      "ElevenLabs transcription done",
    );
    return {
      text: body.text,
      ...(typeof body.language_code === "string" ? { languageCode: body.language_code } : {}),
      ...(typeof body.audio_duration_secs === "number"
        ? { seconds: body.audio_duration_secs }
        : {}),
    };
  }

  async synthesize(text: string, options: SynthesisOptions): Promise<Synthesis> {
    const key = await this.requireKey();
    const voiceSettings: Record<string, number> = {};
    if (options.stability !== undefined) voiceSettings["stability"] = options.stability;
    if (options.similarityBoost !== undefined) {
      voiceSettings["similarity_boost"] = options.similarityBoost;
    }
    const started = Date.now();
    const response = await this.send(
      "tts",
      `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${TTS_OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: options.modelId || DEFAULT_TTS_MODEL,
          ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
        }),
      },
    );
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) throw this.fail("tts", new VoiceError("failed"));
    this.logger.info(
      { op: "tts", chars: text.length, bytes: audio.byteLength, ms: Date.now() - started },
      "ElevenLabs speech done",
    );
    return { audio, mime: TTS_MIME };
  }

  private async requireKey(): Promise<string> {
    const key = await this.keys.get();
    if (key === null) throw new VoiceError("no_key");
    return key;
  }

  /** One call with a timeout; a 429 or 5xx is tried once more after a short wait. */
  private async send(op: "stt" | "tts", url: string, init: RequestInit): Promise<Response> {
    let lastError: VoiceError | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // A timeout or a network failure: the customer is waiting, no second try.
        throw this.fail(op, new VoiceError("failed"));
      }
      if (response.ok) return response;
      lastError = new VoiceError(codeOf(response.status), response.status);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) break;
      await this.sleep(retryAfterMs(response));
    }
    throw this.fail(op, lastError ?? new VoiceError("failed"));
  }

  private fail(op: "stt" | "tts", error: VoiceError): VoiceError {
    this.logger.warn({ op, code: error.code, status: error.status }, "ElevenLabs call failed");
    return error;
  }
}

function codeOf(status: number): VoiceErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "failed";
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000)
    : RETRY_BACKOFF_MS;
}
