import { scriptQueue, type FakeScript } from "@wasfa/ai";
import { settingDefault, type WaAgentSettings } from "@wasfa/shared/settings";
import { describe, expect, it } from "vitest";

import { WaAgentTurnService } from "../src/wa-agent/agent/wa-agent-turn.service.js";
import {
  ElevenLabsClient,
  VoiceError,
  type Synthesis,
  type Transcript,
} from "../src/wa-agent/voice/elevenlabs.client.js";
import { speechText, textOnlyReason } from "../src/wa-agent/voice/voice-text.js";
import { WaAgentVoiceService, ttsCharsKey } from "../src/wa-agent/voice/voice.service.js";

import { MemoryRedis, fakeAi, silentLogger } from "./support/wa-agent-fakes.js";

import type { ObjectStorage } from "../src/files/object-storage.js";
import type { PlansService } from "../src/plans/plans.service.js";
import type { SettingsService } from "../src/settings/settings.service.js";
import type { WaAgentHandoffService } from "../src/wa-agent/agent/handoff.service.js";
import type { WaAgentToolDeps } from "../src/wa-agent/agent/tool-deps.js";
import type { VoiceKeyService } from "../src/wa-agent/voice/voice-key.service.js";
import type { WaAgentRepo } from "../src/wa-agent/wa-agent.repo.js";
import type { WaOutboundService } from "../src/wa-agent/wa-outbound.service.js";
import type { TurnMessage, WaConversation } from "@wasfa/db";
import type { Redis } from "ioredis";

/*
 * Work package D with fakes: the ElevenLabs client's requests, the text rules for what may be spoken,
 * and the agent turn's voice decisions. The database and R2 paths are covered by the int tests.
 */

const KEY = "xi-secret-key-0123456789abcdef";
const CONVERSATION_ID = "018f0000-0000-7000-8000-0000000000c1";
const START = Date.parse("2026-10-26T10:00:00.000Z");

// --- the client -------------------------------------------------------------------------------

interface Seen {
  url: string;
  init: RequestInit;
}

function clientWith(responses: Response[], key: string | null = KEY) {
  const seen: Seen[] = [];
  const sleeps: number[] = [];
  const logs: unknown[] = [];
  const log = (...args: unknown[]) => {
    logs.push(args);
  };
  const client = new ElevenLabsClient(
    { get: () => Promise.resolve(key) } as VoiceKeyService,
    {
      setContext: () => undefined,
      info: log,
      warn: log,
      error: log,
    } as never,
  );
  client.fetchImpl = (input, init) => {
    seen.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error("no response left"));
  };
  client.sleep = (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  return { client, seen, sleeps, logs };
}

const audioResponse = () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
const status = (code: number) => new Response("{}", { status: code });
const failure = (code: number, detail: unknown) =>
  new Response(JSON.stringify({ detail }), { status: code });

describe("the ElevenLabs client", () => {
  it("transcribes with Scribe: key header, multipart file, no audio-event tags", async () => {
    const { client, seen, logs } = clientWith([
      new Response(
        JSON.stringify({ text: "اهلا", language_code: "ara", audio_duration_secs: 2.5 }),
        { status: 200 },
      ),
    ]);
    const result: Transcript = await client.transcribe(
      new Uint8Array([9, 9]),
      "audio/ogg; codecs=opus",
    );
    expect(result).toEqual({ text: "اهلا", languageCode: "ara", seconds: 2.5 });
    const [call] = seen;
    expect(call?.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(call?.init.method).toBe("POST");
    expect((call?.init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    const form = call?.init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.has("language_code")).toBe(false);
    const file = form.get("file") as File;
    expect(file.type).toBe("audio/ogg");
    expect(file.size).toBe(2);
    // Neither the key nor the words reach the logs.
    expect(JSON.stringify(logs)).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain("اهلا");
  });

  it("sends a language hint only when asked to", async () => {
    const { client, seen } = clientWith([new Response(JSON.stringify({ text: "x" }))]);
    await client.transcribe(new Uint8Array([1]), "audio/ogg", { languageCode: "eng" });
    expect((seen[0]?.init.body as FormData).get("language_code")).toBe("eng");
  });

  it("synthesizes to Ogg/Opus with the voice, model and optional settings", async () => {
    const { client, seen } = clientWith([audioResponse()]);
    const result: Synthesis = await client.synthesize("مرحبا", {
      voiceId: "voice 1",
      modelId: "eleven_flash_v2_5",
      stability: 0.4,
    });
    expect(result.mime).toBe("audio/ogg");
    expect([...result.audio]).toEqual([1, 2, 3, 4]);
    const [call] = seen;
    expect(call?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice%201?output_format=opus_48000_64",
    );
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe(KEY);
    expect(JSON.parse(String(call?.init.body))).toEqual({
      text: "مرحبا",
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.4 },
    });
  });

  it("uses the default multilingual model and no voice settings when none are set", async () => {
    const { client, seen } = clientWith([audioResponse()]);
    await client.synthesize("hi", { voiceId: "v", modelId: "" });
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({
      text: "hi",
      model_id: "eleven_multilingual_v2",
    });
  });

  it("retries once on 429 and on 5xx, then gives up with a typed error", async () => {
    const ok = clientWith([status(429), audioResponse()]);
    await ok.client.synthesize("hi", { voiceId: "v" });
    expect(ok.seen).toHaveLength(2);
    expect(ok.sleeps).toHaveLength(1);

    const limited = clientWith([status(429), status(429), audioResponse()]);
    await expect(limited.client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(limited.seen).toHaveLength(2);

    const broken = clientWith([status(503), status(500)]);
    await expect(broken.client.transcribe(new Uint8Array([1]), "audio/ogg")).rejects.toMatchObject({
      code: "failed",
    });
    expect(broken.seen).toHaveLength(2);
  });

  it("does not retry a rejected key and maps it to unauthorized", async () => {
    const { client, seen } = clientWith([status(401), audioResponse()]);
    await expect(client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(seen).toHaveLength(1);
  });

  it("fails with no_key before any request when no key is stored", async () => {
    const { client, seen } = clientWith([audioResponse()], null);
    await expect(client.synthesize("hi", { voiceId: "v" })).rejects.toEqual(
      new VoiceError("no_key"),
    );
    await expect(client.transcribe(new Uint8Array([1]), "audio/ogg")).rejects.toMatchObject({
      code: "no_key",
    });
    expect(seen).toHaveLength(0);
  });

  it("a network failure is a typed failure, not a thrown fetch error", async () => {
    const { client } = clientWith([]);
    await expect(client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "network",
    });
  });

  it("tells a timeout from a network failure", async () => {
    const { client } = clientWith([]);
    client.fetchImpl = () => Promise.reject(new DOMException("timed out", "TimeoutError"));
    await expect(client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it.each([
    [401, { status: "invalid_api_key", message: "no" }, "unauthorized"],
    [401, { status: "quota_exceeded", message: "no" }, "quota_exceeded"],
    [400, { status: "voice_not_found", message: "no" }, "voice_not_found"],
    [404, { status: "voice_not_found" }, "voice_not_found"],
    [404, "plain text detail", "voice_not_found"],
    [400, { status: "model_not_found" }, "model_not_found"],
    [422, { code: "unsupported_model" }, "model_not_found"],
    [402, { status: "payment_required" }, "plan_required"],
    [402, {}, "plan_required"],
    [403, { status: "paid_plan_required" }, "plan_required"],
    [
      403,
      { message: "Free users cannot use library voices via the API. Upgrade." },
      "plan_required",
    ],
    [403, {}, "unauthorized"],
    [400, { status: "output_format_not_allowed" }, "format_not_allowed"],
    [403, { message: "The output format mp3_44100_192 requires Creator" }, "format_not_allowed"],
    [422, { code: "invalid_output_format" }, "format_not_allowed"],
    [400, { status: "max_character_limit_exceeded" }, "bad_request"],
    [422, [{ loc: ["body"] }], "bad_request"],
    [422, {}, "bad_request"],
    [429, { code: "concurrent_limit_exceeded" }, "rate_limited"],
  ] as const)("maps %s %j to %s", async (code, detail, expected) => {
    // 429 is retried once, so give it a second answer.
    const { client } = clientWith([failure(code, detail), failure(code, detail)]);
    await expect(
      client.synthesize("hi", { voiceId: "v", requireVoiceNote: true }),
    ).rejects.toMatchObject({ code: expected, status: code });
  });

  it("logs only a short lowercase token of the error body, never its message", async () => {
    const { client, logs } = clientWith([
      failure(400, { status: "voice_not_found", message: "secret words " + KEY }),
    ]);
    await expect(client.synthesize("سر", { voiceId: "v" })).rejects.toMatchObject({
      detail: "voice_not_found",
    });
    const text = JSON.stringify(logs);
    expect(text).toContain("voice_not_found");
    expect(text).not.toContain("secret words");
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("سر");

    const odd = clientWith([failure(400, { status: "Not A Token! <script>", message: "x" })]);
    await expect(odd.client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "bad_request",
      detail: undefined,
    });
  });

  it("reads at most 4 KB of an error body and survives a body that is not JSON", async () => {
    const { client } = clientWith([new Response("x".repeat(100_000), { status: 400 })]);
    await expect(client.synthesize("hi", { voiceId: "v" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("retries once as mp3 when the account refuses the Opus format", async () => {
    const { client, seen } = clientWith([
      failure(400, { status: "output_format_not_allowed" }),
      audioResponse(),
    ]);
    const result = await client.synthesize("hi", { voiceId: "v" });
    expect(result).toMatchObject({ mime: "audio/mpeg", voiceNote: false });
    expect(seen[0]?.url).toContain("output_format=opus_48000_64");
    expect(seen[1]?.url).toContain("output_format=mp3_44100_128");
  });

  it("does not fall back to mp3 for a clip that must be a voice note", async () => {
    const { client, seen } = clientWith([
      failure(400, { status: "output_format_not_allowed" }),
      audioResponse(),
    ]);
    await expect(
      client.synthesize("hi", { voiceId: "v", requireVoiceNote: true }),
    ).rejects.toMatchObject({ code: "format_not_allowed" });
    expect(seen).toHaveLength(1);
  });

  it("marks an Opus clip as a voice note", async () => {
    const { client } = clientWith([audioResponse()]);
    expect(await client.synthesize("hi", { voiceId: "v" })).toMatchObject({ voiceNote: true });
  });
});

describe("the voice service around ElevenLabs", () => {
  const config: WaAgentSettings["voice"] = {
    ...settingDefault("waAgent").voice,
    enabled: true,
    voiceId: "voice-1",
  };

  function service(options: { synthesis?: Synthesis | VoiceError; putFails?: boolean }) {
    const asked: Array<{ requireVoiceNote?: boolean }> = [];
    const warnings: unknown[] = [];
    const stored: string[] = [];
    const client = {
      synthesize: (_text: string, opts: { requireVoiceNote?: boolean }) => {
        asked.push(opts);
        const result = options.synthesis ?? {
          audio: new Uint8Array([1]),
          mime: "audio/ogg",
          voiceNote: true,
        };
        return result instanceof VoiceError ? Promise.reject(result) : Promise.resolve(result);
      },
    } as unknown as ElevenLabsClient;
    const storage = {
      put: (key: string) => {
        if (options.putFails) return Promise.reject(new Error("bucket down"));
        stored.push(key);
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
    } as unknown as ObjectStorage;
    const logger = {
      setContext: () => undefined,
      info: () => undefined,
      warn: (...args: unknown[]) => warnings.push(args),
    };
    const voice = new WaAgentVoiceService(
      { isSet: () => Promise.resolve(true) } as unknown as VoiceKeyService,
      client,
      storage,
      new MemoryRedis() as unknown as Redis,
      logger as never,
    );
    voice.scheduleRemoval = () => undefined;
    return { voice, asked, warnings, stored };
  }

  it("a storage failure is its own typed error for the test and quiet for a reply", async () => {
    const { voice, warnings } = service({ putFails: true });
    await expect(voice.test("hi", config, new Date(START))).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(await voice.speak("hi there", config, new Date(START))).toBeNull();
    expect(JSON.stringify(warnings)).toContain("storage_failed");
  });

  it("the test accepts an mp3 clip; a real reply insists on a voice note", async () => {
    const { voice, asked, stored } = service({
      synthesis: { audio: new Uint8Array([1]), mime: "audio/mpeg", voiceNote: false },
    });
    const clip = await voice.test("hi", config, new Date(START));
    expect(clip.mime).toBe("audio/mpeg");
    expect(stored[0]).toMatch(/\.mp3$/);
    expect(asked[0]?.requireVoiceNote).toBe(false);
    await voice.speak("hi there", config, new Date(START));
    expect(asked[1]?.requireVoiceNote).toBe(true);
  });

  it("a reply stays text and logs voice_format_unavailable when only mp3 is allowed", async () => {
    const { voice, warnings } = service({ synthesis: new VoiceError("format_not_allowed", 400) });
    expect(await voice.speak("hi there", config, new Date(START))).toBeNull();
    expect(JSON.stringify(warnings)).toContain("voice_format_unavailable");
  });
});

// --- what may be spoken ---------------------------------------------------------------------

describe("what stays text", () => {
  it.each([
    ["https://wasfa.online/pricing", "url"],
    ["زور wasfa.online وشوف", "url"],
    ["الكود WAK7Q2XM ينفع", "coupon"],
    ["الايبان EG380019000500000000263180002", "iban"],
    ["حوّل على 1234 5678 9012", "digits"],
    ["رقم الحساب ١٢٣٤٥٦٧٨٩٠", "digits"],
  ] as const)("%s is text only (%s)", (text, reason) => {
    expect(textOnlyReason(text)).toBe(reason);
  });

  it("lets ordinary sentences and small numbers be spoken", () => {
    expect(textOnlyReason("الباقة بـ 199 جنيه في الشهر وفيها 100 رصيد")).toBeNull();
    expect(textOnlyReason("Hello, how can I help you today?")).toBeNull();
    expect(textOnlyReason("Wasfa AI يقرأ الروشتة")).toBeNull();
  });

  it("reads out plain words: no markup, bullets or emojis", () => {
    expect(speechText("*أهلاً* بيك 😊\n- الباقة _برو_\n- الباقة بلس")).toBe(
      "أهلاً بيك. الباقة برو. الباقة بلس",
    );
  });
});

// --- the agent turn -------------------------------------------------------------------------

class FakeRepo {
  conversation: WaConversation = {
    id: CONVERSATION_ID,
    jid: "201012345678@s.whatsapp.net",
    phone: "+201012345678",
    userId: null,
    status: "active",
    pausedUntil: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    summary: null,
    createdAt: new Date(START),
    updatedAt: new Date(START),
  };
  messages: TurnMessage[] = [];
  metas: Array<{ ids: string[]; meta: Record<string, unknown> }> = [];
  texts: Array<{ id: string; text: string; meta: Record<string, unknown> }> = [];
  private counter = 0;

  find = () => Promise.resolve(this.conversation);
  recentMessages = (_id: string, limit: number) => Promise.resolve(this.messages.slice(-limit));
  messagesAfter = () => Promise.resolve(this.messages);
  countAfter = () => Promise.resolve(0);
  findUser = () => Promise.resolve(null);
  saveSummary = () => Promise.resolve();
  setMeta = (ids: readonly string[], meta: Record<string, unknown>) => {
    this.metas.push({ ids: [...ids], meta });
    if ("turn" in meta) {
      for (const row of this.messages) if (ids.includes(row.id)) row.answered = true;
    }
    return Promise.resolve();
  };
  setText = (id: string, text: string, meta: Record<string, unknown>) => {
    this.texts.push({ id, text, meta });
    const row = this.messages.find((message) => message.id === id);
    if (row) row.text = text;
    return Promise.resolve();
  };

  add(direction: TurnMessage["direction"], fields: Partial<TurnMessage> = {}): TurnMessage {
    this.counter += 1;
    const row: TurnMessage = {
      id: `m${String(this.counter)}`,
      direction,
      kind: "text",
      text: null,
      mediaKey: null,
      mediaMime: null,
      mediaBytes: null,
      createdAt: new Date(START + this.counter),
      answered: false,
      ...fields,
    };
    this.messages.push(row);
    if (direction === "in") this.conversation.lastInboundAt = new Date(START);
    return row;
  }
}

interface HarnessOptions {
  voice?: Partial<WaAgentSettings["voice"]>;
  script?: FakeScript;
  key?: string | null;
  transcribe?: () => Promise<Transcript>;
  synthesize?: () => Promise<Synthesis>;
}

function harness(options: HarnessOptions = {}) {
  const repo = new FakeRepo();
  const redis = new MemoryRedis();
  const sent: Array<Array<Record<string, unknown>>> = [];
  const stored = new Map<string, { bytes: number; mime: string }>();
  const removed: string[] = [];
  const spoken: string[] = [];
  const transcribed: Array<{ mime: string; bytes: number }> = [];
  const config: WaAgentSettings = {
    ...settingDefault("waAgent"),
    enabled: true,
    voice: {
      ...settingDefault("waAgent").voice,
      enabled: true,
      voiceId: "voice-1",
      ...options.voice,
    },
  };
  const key = options.key === undefined ? KEY : options.key;
  const keys = {
    get: () => Promise.resolve(key),
    isSet: () => Promise.resolve(key !== null),
  } as unknown as VoiceKeyService;
  const client = {
    transcribe: (_audio: Uint8Array, mime: string) => {
      transcribed.push({ mime, bytes: _audio.byteLength });
      return (options.transcribe ?? (() => Promise.resolve({ text: "عايز اشترك في الباقة" })))();
    },
    synthesize: (text: string) => {
      spoken.push(text);
      return (
        options.synthesize ??
        (() =>
          Promise.resolve({ audio: new Uint8Array([7, 7]), mime: "audio/ogg", voiceNote: true }))
      )();
    },
  } as unknown as ElevenLabsClient;
  const storage = {
    getBytes: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    put: (key: string, body: Uint8Array, mime: string) => {
      stored.set(key, { bytes: body.byteLength, mime });
      return Promise.resolve();
    },
    remove: (key: string) => {
      removed.push(key);
      return Promise.resolve();
    },
  } as unknown as ObjectStorage;
  const voice = new WaAgentVoiceService(
    keys,
    client,
    storage,
    redis as unknown as Redis,
    silentLogger,
  );
  const outbound = {
    enqueue: (_id: string, parts: Array<Record<string, unknown>>) => {
      sent.push(parts);
      return Promise.resolve(
        parts.map(
          (part) =>
            repo.add("out", {
              kind: part["kind"] === "voice" ? "audio" : "text",
              text: part["kind"] === "text" ? String(part["text"]) : null,
            }).id,
        ),
      );
    },
  } as unknown as WaOutboundService;
  const settings = {
    get: (name: string) =>
      Promise.resolve(name === "waAgent" ? config : settingDefault(name as "currency")),
  } as unknown as SettingsService;
  const toolDeps = {
    handoff: { pauseWhenDelivered: () => undefined },
  } as unknown as WaAgentToolDeps;
  const handoff = { pauseWhenDelivered: () => undefined } as unknown as WaAgentHandoffService;
  const ai = fakeAi(options.script ?? scriptQueue(["تمام، الباقة برو بـ 199 جنيه"]));
  const service = new WaAgentTurnService(
    repo as unknown as WaAgentRepo,
    settings,
    redis as unknown as Redis,
    ai.service,
    outbound,
    handoff,
    toolDeps,
    { effectivePlan: () => Promise.resolve({ id: "plan-1" }) } as unknown as PlansService,
    storage,
    silentLogger,
    voice,
  );
  const clock = { now: START };
  service.timing.now = () => clock.now;
  service.timing.sleep = (ms) => {
    clock.now += ms;
    return Promise.resolve();
  };
  service.random = () => 0.1;
  return {
    service,
    repo,
    redis,
    sent,
    stored,
    removed,
    spoken,
    transcribed,
    ai,
    run: () => service.onInbound(CONVERSATION_ID),
    allUserText: () =>
      (ai.adapter.requests[0]?.messages ?? [])
        .flatMap((message) => (message.role === "user" ? message.parts : []))
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n"),
    userText: () => {
      const request = ai.adapter.requests[0];
      const user = request?.messages.filter((message) => message.role === "user").at(-1);
      return user?.role === "user"
        ? user.parts.map((part) => (part.type === "text" ? part.text : "")).join("")
        : "";
    },
  };
}

const voiceNote = {
  kind: "audio",
  mediaKey: "wa/2026/10/note-1",
  mediaMime: "audio/ogg; codecs=opus",
  mediaBytes: 3,
} as const;

describe("incoming voice notes", () => {
  it("transcribes the note, stores the words and shows them to the model as customer text", async () => {
    const h = harness();
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.transcribed).toEqual([{ mime: "audio/ogg; codecs=opus", bytes: 3 }]);
    expect(h.repo.texts[0]).toMatchObject({
      id: "m1",
      text: "عايز اشترك في الباقة",
      meta: { transcribed: true },
    });
    expect(h.userText()).toContain("<user_data>");
    expect(h.userText()).toContain("عايز اشترك في الباقة");
    expect(h.userText()).not.toContain("لم تُحوَّل");
  });

  it("an earlier transcribed note reads as text in later turns", async () => {
    const h = harness();
    h.repo.add("in", { ...voiceNote, text: "كلام قديم من رسالة صوتية" });
    h.repo.add("out", { text: "اهلا" });
    h.repo.add("in", { text: "طيب والسعر؟" });
    await h.run();
    expect(h.transcribed).toHaveLength(0);
    expect(h.allUserText()).toContain("كلام قديم من رسالة صوتية");
  });

  it("keeps the placeholder and records the error code when transcription fails", async () => {
    const h = harness({ transcribe: () => Promise.reject(new VoiceError("rate_limited")) });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.repo.texts.some((entry) => entry.meta["transcribed"] === true)).toBe(false);
    expect(h.repo.metas.some((entry) => entry.meta["transcribeError"] === "rate_limited")).toBe(
      true,
    );
    expect(h.userText()).toContain("لم تُحوَّل");
    // The customer is still answered.
    expect(h.sent).toHaveLength(1);
  });

  it("an empty transcript counts as a failure", async () => {
    const h = harness({ transcribe: () => Promise.resolve({ text: "  " }) });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.repo.metas.some((entry) => entry.meta["transcribeError"] === "empty")).toBe(true);
  });

  it.each([
    ["voice is off", { enabled: false }],
    ["transcription is off", { transcribeIncoming: false }],
  ])("does not call ElevenLabs when %s", async (_name, voice) => {
    const h = harness({ voice });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.transcribed).toHaveLength(0);
    expect(h.userText()).toContain("لم تُحوَّل");
  });

  it("does not call ElevenLabs without a key", async () => {
    const h = harness({ key: null });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.transcribed).toHaveLength(0);
    expect(h.sent).toHaveLength(1);
  });
});

describe("voice replies", () => {
  it("mirror: a voice note is answered with one voice part and the words are kept", async () => {
    const h = harness({ voice: { replyMode: "mirror" } });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent).toHaveLength(1);
    const [part] = h.sent[0] ?? [];
    expect(part).toMatchObject({ kind: "voice" });
    expect(String(part?.["mediaKey"])).toMatch(/^wa\/out\/2026\/10\/[0-9a-f-]+\.ogg$/);
    expect(h.stored.get(String(part?.["mediaKey"]))).toEqual({ bytes: 2, mime: "audio/ogg" });
    expect(h.sent[0]).toHaveLength(1);
    expect(h.repo.texts.at(-1)).toMatchObject({
      id: "m2",
      text: "تمام، الباقة برو بـ 199 جنيه",
      meta: { voice: { chars: 28 } },
    });
    expect(h.spoken).toEqual(["تمام، الباقة برو بـ 199 جنيه"]);
    // Counted against the daily ElevenLabs cap, not the AI spend.
    expect(h.redis.values.get(ttsCharsKey(new Date(START)))).toBe("28");
    expect(h.redis.values.has("wa:agent:spend:20261026")).toBe(false);
  });

  it("mirror: a text question gets a text answer", async () => {
    const h = harness({ voice: { replyMode: "mirror" } });
    h.repo.add("in", { text: "السعر؟" });
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
    expect(h.spoken).toHaveLength(0);
  });

  it("never: a voice note still gets text", async () => {
    const h = harness({ voice: { replyMode: "never" } });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
    expect(h.spoken).toHaveLength(0);
  });

  it("sometimes: voice below the percentage, text above it", async () => {
    const yes = harness({ voice: { replyMode: "sometimes", sometimesPercent: 20 } });
    yes.service.random = () => 0.19;
    yes.repo.add("in", { text: "السعر؟" });
    await yes.run();
    expect(yes.sent[0]?.[0]).toMatchObject({ kind: "voice" });

    const no = harness({ voice: { replyMode: "sometimes", sometimesPercent: 20 } });
    no.service.random = () => 0.2;
    no.repo.add("in", { text: "السعر؟" });
    await no.run();
    expect(no.sent[0]?.[0]).toMatchObject({ kind: "text" });
  });

  it.each([
    ["a link", "ادخل على https://wasfa.online/pricing"],
    ["a coupon code", "خد الكود WAK7Q2XM"],
    ["a bank number", "حوّل على الايبان EG380019000500000000263180002"],
    ["a long number", "رقم الحساب 123456789012"],
  ])("a reply with %s stays text", async (_name, reply) => {
    const h = harness({ voice: { replyMode: "mirror" }, script: scriptQueue([reply]) });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
    expect(h.spoken).toHaveLength(0);
  });

  it("a reply longer than voice.maxChars stays text", async () => {
    const h = harness({
      voice: { replyMode: "mirror", maxChars: 50 },
      script: scriptQueue(["كلمة ".repeat(20)]),
    });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
  });

  it("over the daily character cap the reply is text and nothing stays reserved", async () => {
    const h = harness({ voice: { replyMode: "mirror", dailyCharCap: 30 } });
    h.redis.values.set(ttsCharsKey(new Date(START)), "10");
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
    expect(h.spoken).toHaveLength(0);
    expect(h.redis.values.get(ttsCharsKey(new Date(START)))).toBe("10");
  });

  it("a cap of 0 means no voice replies at all", async () => {
    const h = harness({ voice: { replyMode: "mirror", dailyCharCap: 0 } });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
  });

  it("a TTS failure falls back to the text parts and gives the characters back", async () => {
    const h = harness({
      voice: { replyMode: "mirror" },
      synthesize: () => Promise.reject(new VoiceError("failed")),
    });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text", text: "تمام، الباقة برو بـ 199 جنيه" });
    expect(h.redis.values.get(ttsCharsKey(new Date(START)))).toBe("0");
    expect(h.stored.size).toBe(0);
  });

  it("no key or no voice id: text", async () => {
    const noKey = harness({ voice: { replyMode: "mirror" }, key: null });
    noKey.repo.add("in", voiceNote);
    await noKey.run();
    expect(noKey.sent[0]?.[0]).toMatchObject({ kind: "text" });

    const noVoice = harness({ voice: { replyMode: "mirror", voiceId: "" } });
    noVoice.repo.add("in", voiceNote);
    await noVoice.run();
    expect(noVoice.sent[0]?.[0]).toMatchObject({ kind: "text" });
  });

  it("voice off: text even in mirror mode", async () => {
    const h = harness({ voice: { enabled: false, replyMode: "mirror" } });
    h.repo.add("in", voiceNote);
    await h.run();
    expect(h.sent[0]?.[0]).toMatchObject({ kind: "text" });
  });

  it("a spoken reply is remembered as text in the next turn", async () => {
    const h = harness({
      voice: { replyMode: "mirror" },
      script: scriptQueue(["تمام، الباقة برو بـ 199 جنيه", "تمام"]),
    });
    h.repo.add("in", voiceNote);
    await h.run();
    h.repo.add("in", { text: "تمام وبعدين؟" });
    h.ai.adapter.requests.length = 0;
    await h.run();
    const request = h.ai.adapter.requests[0];
    const assistant = request?.messages.find((message) => message.role === "assistant");
    const said =
      assistant?.role === "assistant"
        ? assistant.parts.map((part) => (part.type === "text" ? part.text : "")).join("")
        : "";
    expect(said).toContain("تمام، الباقة برو بـ 199 جنيه");
  });
});
