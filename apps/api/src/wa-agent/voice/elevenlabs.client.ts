import { Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

import { classify, readErrorBody, retryAfterMs } from "./elevenlabs.http.js";
import { VoiceKeyService } from "./voice-key.service.js";

/*
 * ElevenLabs over plain fetch (docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 * and .../text-to-speech/convert). Speech to text: `scribe_v2`. Text to speech: Ogg/Opus
 * (`opus_48000_64`), which WhatsApp plays as a voice note. The docs tie only mp3_44100_192 (Creator) and
 * 44.1 kHz PCM/WAV (Pro) to a plan, so Opus is open to every paid plan; if an account is still refused
 * the format, one retry asks for `mp3_44100_128` (fine for the admin test, NOT a voice note: see
 * `requireVoiceNote`). The key goes in the `xi-api-key` header only. Logs carry byte / character
 * counts, durations, the HTTP status, our error code and the short `detail` token of the error body:
 * never the key, a text, audio or the free-text message.
 * Error codes: https://elevenlabs.io/docs/eleven-api/resources/errors
 */

const BASE_URL = "https://api.elevenlabs.io";
export const STT_MODEL = "scribe_v2";
/** The default of the API, and a multilingual model that speaks Arabic. */
export const DEFAULT_TTS_MODEL = "eleven_multilingual_v2";
export const TTS_OUTPUT_FORMAT = "opus_48000_64";
export const TTS_MIME = "audio/ogg";
/** Open to every plan; asked for once when the account refuses the Opus format. */
export const TTS_FALLBACK_FORMAT = "mp3_44100_128";
export const TTS_FALLBACK_MIME = "audio/mpeg";
const TIMEOUT_MS = 30_000;

export type VoiceErrorCode =
  | "no_key"
  | "unauthorized"
  | "rate_limited"
  | "quota_exceeded"
  | "voice_not_found"
  | "model_not_found"
  | "plan_required"
  | "format_not_allowed"
  | "bad_request"
  | "timeout"
  | "network"
  | "storage_failed"
  | "failed";

export class VoiceError extends Error {
  constructor(
    readonly code: VoiceErrorCode,
    readonly status?: number,
    /** The short `detail` token of the ElevenLabs error body (`^[a-z_]{1,64}$`), if there was one. */
    readonly detail?: string,
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
  /**
   * The clip goes to WhatsApp as a voice note (Ogg/Opus only): never fall back to mp3, fail with
   * `format_not_allowed` instead. The admin test leaves it off and accepts mp3.
   */
  requireVoiceNote?: boolean;
}

export interface Synthesis {
  audio: Uint8Array;
  mime: string;
  /** Ogg/Opus: playable as a WhatsApp voice note. False for the mp3 fallback. */
  voiceNote: boolean;
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
    try {
      return await this.speak(key, text, options, TTS_OUTPUT_FORMAT);
    } catch (error) {
      if (!(error instanceof VoiceError) || error.code !== "format_not_allowed") throw error;
      if (options.requireVoiceNote) throw error;
      this.logger.info({ to: TTS_FALLBACK_FORMAT }, "ElevenLabs refused Opus, retrying as mp3");
      return this.speak(key, text, options, TTS_FALLBACK_FORMAT);
    }
  }

  private async speak(
    key: string,
    text: string,
    options: SynthesisOptions,
    format: string,
  ): Promise<Synthesis> {
    const voiceSettings: Record<string, number> = {};
    if (options.stability !== undefined) voiceSettings["stability"] = options.stability;
    if (options.similarityBoost !== undefined) {
      voiceSettings["similarity_boost"] = options.similarityBoost;
    }
    const started = Date.now();
    const response = await this.send(
      "tts",
      `${BASE_URL}/v1/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${format}`,
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
      { op: "tts", format, chars: text.length, bytes: audio.byteLength, ms: Date.now() - started },
      "ElevenLabs speech done",
    );
    const voiceNote = format === TTS_OUTPUT_FORMAT;
    return { audio, mime: voiceNote ? TTS_MIME : TTS_FALLBACK_MIME, voiceNote };
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
      } catch (error) {
        // A timeout or a network failure: the customer is waiting, no second try.
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        throw this.fail(op, new VoiceError(timedOut ? "timeout" : "network"));
      }
      if (response.ok) return response;
      const body = await readErrorBody(response);
      lastError = new VoiceError(classify(op, response.status, body), response.status, body.token);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) break;
      await this.sleep(retryAfterMs(response));
    }
    throw this.fail(op, lastError ?? new VoiceError("failed"));
  }

  private fail(op: "stt" | "tts", error: VoiceError): VoiceError {
    this.logger.warn(
      { op, code: error.code, status: error.status, detail: error.detail },
      "ElevenLabs call failed",
    );
    return error;
  }
}
