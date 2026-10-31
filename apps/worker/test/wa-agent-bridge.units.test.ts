import {
  WA_AGENT_IN_STREAM,
  WA_AGENT_SENT_STREAM,
  WA_INBOUND_STREAM,
} from "@wasfa/shared/schemas/phone";
import {
  waAgentBlockKey,
  waAgentInboundSchema,
  waAgentLastInKey,
  waAgentPauseKey,
  waAgentSentIdKey,
  waAgentSentSchema,
  type WaAgentInbound,
  type WaAgentSent,
} from "@wasfa/shared/schemas/wa-agent";
import { settingDefault, type WaAgentSettings } from "@wasfa/shared/settings";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";

import { routeInbound, type InboundRouterDeps } from "../src/wa-bridge/agent-inbound.js";
import {
  AGENT_OUT_STALE_MS,
  MAX_REPLY_WAIT_MS,
  processAgentOut,
  replyDelayMs,
  type AgentOutboundDeps,
  type AgentSocket,
} from "../src/wa-bridge/agent-outbound.js";
import { AgentSettingsCache, type AgentSwitches } from "../src/wa-bridge/agent-settings.js";

import type { MediaIo } from "../src/wa-bridge/agent-media.js";
import type { LidResolver, RawMessage } from "../src/wa-bridge/inbound.js";
import type { Database } from "@wasfa/db";

const NOW = 1_800_000_000_000;
const nowSeconds = Math.floor(NOW / 1000);
const PN = "201012345678@s.whatsapp.net";
const logger = pino({ level: "silent" });
const MEDIA_ORIGIN = "https://media.example.com";
const noLid: LidResolver = { getPNForLID: () => Promise.resolve(null) };

/** The few Redis commands the bridge's agent code uses, in memory (Lua is emulated, see `eval`). */
class FakeRedis {
  readonly values = new Map<string, string>();
  readonly counters = new Map<string, number>();
  readonly streams = new Map<string, unknown[]>();
  /** What the spacing script returns (ms to wait before the send). */
  spacingMs = 0;
  evalCalls = 0;

  set(key: string, value: string, ...rest: Array<string | number>): Promise<"OK" | null> {
    if (rest.includes("NX") && this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.values.has(key) ? 1 : 0);
  }

  decrby(key: string, by: number): Promise<number> {
    const next = (this.counters.get(key) ?? 0) - by;
    this.counters.set(key, next);
    return Promise.resolve(next);
  }

  xadd(stream: string, ...args: Array<string | number>): Promise<string> {
    const list = this.streams.get(stream) ?? [];
    list.push(JSON.parse(String(args.at(-1))) as unknown);
    this.streams.set(stream, list);
    return Promise.resolve("1-0");
  }

  /** The caps script (INCRBY) is emulated in JS; the spacing script answers `spacingMs`. */
  eval(script: string, _keyCount: number, ...args: string[]): Promise<number> {
    this.evalCalls++;
    if (!script.includes("INCRBY")) return Promise.resolve(this.spacingMs);
    const keys = args.slice(0, 3);
    const [parts, ...caps] = args.slice(3, 7).map(Number);
    for (const [index, key] of keys.entries()) {
      if ((this.counters.get(key) ?? 0) + (parts ?? 0) > (caps[index] ?? 0)) {
        return Promise.resolve(index + 1);
      }
    }
    for (const key of keys) this.counters.set(key, (this.counters.get(key) ?? 0) + (parts ?? 0));
    return Promise.resolve(0);
  }

  stream<T>(name: string): T[] {
    return (this.streams.get(name) ?? []) as T[];
  }
}

function settingsWith(overrides: Partial<WaAgentSettings> = {}): WaAgentSettings {
  return { ...settingDefault("waAgent"), enabled: true, ...overrides };
}

function switches(agent: Partial<WaAgentSettings>, verificationOn = true, whatsappLoginOn = true) {
  const value: AgentSwitches = { agent: settingsWith(agent), verificationOn, whatsappLoginOn };
  return { current: () => Promise.resolve(value) };
}

function msg(
  body: string | null,
  extra: Partial<RawMessage> = {},
  key: Partial<RawMessage["key"]> = {},
) {
  return {
    key: { id: "MSG1", remoteJid: PN, fromMe: false, ...key },
    message: body === null ? null : { conversation: body },
    messageTimestamp: nowSeconds,
    pushName: "Mona",
    ...extra,
  } satisfies RawMessage;
}

interface Harness {
  redis: FakeRedis;
  noted: string[];
  reads: number;
  deps: InboundRouterDeps;
  route: (raw: RawMessage) => ReturnType<typeof routeInbound>;
}

function harness(options: {
  agentEnabled: boolean;
  verificationOn: boolean;
  media?: MediaIo | null;
  resolver?: LidResolver;
}): Harness {
  const redis = new FakeRedis();
  const noted: string[] = [];
  const state = { reads: 0 };
  const deps: InboundRouterDeps = {
    redis: redis as unknown as InboundRouterDeps["redis"],
    guard: {
      noteInbound: (jid: string, id: string) => {
        noted.push(`${jid}:${id}`);
        return Promise.resolve();
      },
    },
    settings: switches({ enabled: options.agentEnabled }, options.verificationOn),
    resolver: options.resolver ?? noLid,
    media: options.media ?? null,
    logger,
    now: () => NOW,
  };
  return {
    redis,
    noted,
    get reads() {
      return state.reads;
    },
    deps,
    route: (raw) =>
      routeInbound(raw, deps, () => {
        state.reads++;
        return Promise.resolve();
      }),
  };
}

const agentEntries = (h: Harness) => h.redis.stream<WaAgentInbound>(WA_AGENT_IN_STREAM);
const codeEntries = (h: Harness) => h.redis.stream<unknown>(WA_INBOUND_STREAM);

describe("inbound routing: verification and agent are independent", () => {
  it.each([
    // [agent, verification, text, expected route]
    [false, true, "482913", "verification"],
    [false, true, "hello there", "ignored"],
    [false, false, "482913", "verification"], // byte-for-byte as today: the api honours its own switch
    [false, false, "hello there", "ignored"],
    [true, true, "482913", "verification"],
    [true, true, "hello there", "agent"],
    [true, false, "482913", "agent"], // verification off must not stop the agent, code or not
    [true, false, "hello there", "agent"],
  ] as const)(
    "agent %s, verification %s, %j goes to %s",
    async (agent, verification, text, expected) => {
      const h = harness({ agentEnabled: agent, verificationOn: verification });
      const outcome = await h.route(msg(text));
      expect(outcome.route).toBe(expected);
      expect(codeEntries(h)).toHaveLength(expected === "verification" ? 1 : 0);
      expect(agentEntries(h)).toHaveLength(expected === "agent" ? 1 : 0);
      // The legacy path also opens the 24 h reply window it always opened.
      expect(h.noted).toHaveLength(expected === "verification" ? 1 : 0);
    },
  );

  it("queues a customer text with the sender's number, name and the chat window", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    await h.route(msg("بكام الاشتراك؟"));
    const [entry] = agentEntries(h);
    expect(waAgentInboundSchema.parse(entry)).toMatchObject({
      waMessageId: "MSG1",
      jid: PN,
      phone: "+201012345678",
      direction: "in",
      kind: "text",
      text: "بكام الاشتراك؟",
      pushName: "Mona",
      ts: nowSeconds * 1000,
    });
    expect(h.redis.values.get(waAgentLastInKey(PN))).toBe(String(NOW));
    expect(h.reads).toBe(1);
  });

  it("ignores groups, stale history and messages without content", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    expect(await h.route(msg("hi", {}, { remoteJid: "120363000000@g.us" }))).toMatchObject({
      reason: "not_direct",
    });
    expect(await h.route(msg("hi", { messageTimestamp: nowSeconds - 16 * 60 }))).toMatchObject({
      reason: "stale",
    });
    expect(await h.route(msg(null))).toMatchObject({ reason: "not_content" });
    expect(await h.route(msg("   "))).toMatchObject({ reason: "not_content" });
    expect(agentEntries(h)).toHaveLength(0);
  });

  it("stores a redelivered message once", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    await h.route(msg("hi"));
    expect(await h.route(msg("hi"))).toMatchObject({ reason: "duplicate" });
    expect(agentEntries(h)).toHaveLength(1);
  });

  it("keys an unresolved LID chat by the LID jid, a resolved one by the phone-number jid", async () => {
    const lid = "123456789@lid";
    const h = harness({ agentEnabled: true, verificationOn: true });
    await h.route(msg("hi", {}, { remoteJid: lid }));
    expect(agentEntries(h)[0]).toMatchObject({ jid: lid, phone: null });

    const resolved = harness({
      agentEnabled: true,
      verificationOn: true,
      resolver: { getPNForLID: () => Promise.resolve(PN) },
    });
    await resolved.route(msg("hi", {}, { remoteJid: lid }));
    expect(agentEntries(resolved)[0]).toMatchObject({ jid: PN, phone: "+201012345678" });
  });
});

describe("the owner typing (fromMe)", () => {
  const own = (extra: Partial<RawMessage["key"]> = {}) =>
    msg("I will call you", {}, { fromMe: true, ...extra });

  it("is ignored when the agent is off", async () => {
    const h = harness({ agentEnabled: false, verificationOn: true });
    expect(await h.route(own())).toMatchObject({ route: "ignored", reason: "from_me" });
    expect(agentEntries(h)).toHaveLength(0);
  });

  it("is forwarded as an owner message when the agent is on, without opening the reply window", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    expect(await h.route(own())).toEqual({ route: "owner" });
    expect(agentEntries(h)[0]).toMatchObject({ direction: "owner", kind: "text", jid: PN });
    expect(h.redis.values.has(waAgentLastInKey(PN))).toBe(false);
    expect(h.reads).toBe(0);
  });

  it("ignores what the bridge sent itself", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    await h.redis.set(waAgentSentIdKey("MSG1"), "1");
    expect(await h.route(own())).toMatchObject({ reason: "own_sent" });
    expect(agentEntries(h)).toHaveLength(0);
  });

  it("ignores old history and groups", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    expect(await h.route(own({ id: "OLD" }))).toEqual({ route: "owner" });
    const stale = msg(
      "old",
      { messageTimestamp: nowSeconds - 3_600 },
      { fromMe: true, id: "OLD2" },
    );
    expect(await h.route(stale)).toMatchObject({ reason: "stale" });
    expect(await h.route(own({ id: "G", remoteJid: "1203@g.us" }))).toMatchObject({
      reason: "not_direct",
    });
  });
});

describe("inbound media", () => {
  function io(overrides: Partial<MediaIo> = {}) {
    const puts: Array<{ key: string; bytes: number; type: string }> = [];
    let downloads = 0;
    const media: MediaIo = {
      download: () => {
        downloads++;
        return Promise.resolve(Buffer.alloc(2_000, 1));
      },
      put: (key, body, type) => {
        puts.push({ key, bytes: body.length, type });
        return Promise.resolve();
      },
      ...overrides,
    };
    return { media, puts, downloads: () => downloads };
  }

  const withMessage = (message: NonNullable<RawMessage["message"]>) => ({
    ...msg(null),
    message,
  });

  it("stores an image under wa/<yyyy>/<mm>/<uuid> with its caption", async () => {
    const fake = io();
    const h = harness({ agentEnabled: true, verificationOn: true, media: fake.media });
    await h.route(
      withMessage({
        imageMessage: { mimetype: "image/jpeg", fileLength: 5_000, caption: "my rx" },
      }),
    );
    const [entry] = agentEntries(h);
    expect(entry).toMatchObject({ kind: "image", text: "my rx" });
    expect(entry?.media).toMatchObject({ mime: "image/jpeg", bytes: 2_000 });
    expect(entry?.media?.key).toMatch(/^wa\/2027\/\d{2}\/[0-9a-f-]{36}$/);
    expect(fake.puts).toEqual([{ key: entry?.media?.key, bytes: 2_000, type: "image/jpeg" }]);
  });

  it("stores a PDF and a voice note (mime parameters dropped, seconds kept)", async () => {
    const fake = io();
    const h = harness({ agentEnabled: true, verificationOn: true, media: fake.media });
    await h.route(
      withMessage({ documentMessage: { mimetype: "application/pdf", fileLength: 100_000 } }),
    );
    await h.route({
      ...withMessage({
        audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 42, fileLength: 60_000 },
      }),
      key: { id: "AUDIO", remoteJid: PN, fromMe: false },
    });
    expect(agentEntries(h).map((entry) => entry.kind)).toEqual(["document", "audio"]);
    expect(agentEntries(h)[1]?.media).toMatchObject({ mime: "audio/ogg", seconds: 42 });
  });

  it.each([
    [
      "an image over 10 MB",
      { imageMessage: { mimetype: "image/png", fileLength: 11 * 1024 * 1024 } },
      "image",
      "too_large",
    ],
    [
      "a PDF over 10 MB",
      { documentMessage: { mimetype: "application/pdf", fileLength: 11 * 1024 * 1024 } },
      "document",
      "too_large",
    ],
    [
      "a voice note over 3 MB",
      { audioMessage: { mimetype: "audio/ogg", seconds: 30, fileLength: 4 * 1024 * 1024 } },
      "audio",
      "too_large",
    ],
    [
      "a voice note over 180 s",
      { audioMessage: { mimetype: "audio/ogg", seconds: 181, fileLength: 1_000 } },
      "audio",
      "too_large",
    ],
    [
      "a gif",
      { imageMessage: { mimetype: "image/gif", fileLength: 100 } },
      "image",
      "unsupported_type",
    ],
    [
      "a Word file",
      { documentMessage: { mimetype: "application/msword", fileLength: 100 } },
      "document",
      "unsupported_type",
    ],
  ] as const)(
    "keeps %s as its kind with a typed reason, without downloading it",
    async (_name, message, kind, mediaStatus) => {
      const fake = io();
      const h = harness({ agentEnabled: true, verificationOn: true, media: fake.media });
      await h.route(withMessage(message));
      const [entry] = agentEntries(h);
      expect(entry).toMatchObject({ kind, mediaStatus });
      expect(entry?.media).toBeUndefined();
      expect(fake.downloads()).toBe(0);
      expect(fake.puts).toHaveLength(0);
    },
  );

  it.each([
    ["a video", { videoMessage: {} }],
    ["a sticker", { stickerMessage: {} }],
    ["a location", { locationMessage: {} }],
    ["a contact", { contactMessage: {} }],
  ] as const)("turns %s into kind other without media or reason", async (_name, message) => {
    const fake = io();
    const h = harness({ agentEnabled: true, verificationOn: true, media: fake.media });
    await h.route(withMessage(message));
    const [entry] = agentEntries(h);
    expect(entry).toMatchObject({ kind: "other" });
    expect(entry?.media).toBeUndefined();
    expect(entry?.mediaStatus).toBeUndefined();
    expect(fake.downloads()).toBe(0);
  });

  it("keeps the kind with a reason when the real size is over the limit, the download fails or storage is off", async () => {
    const big = io({ download: () => Promise.resolve(Buffer.alloc(3 * 1024 * 1024 + 1)) });
    const image = { imageMessage: { mimetype: "image/png", fileLength: 1_000 } };
    const audio = { audioMessage: { mimetype: "audio/ogg", seconds: 10, fileLength: 1_000 } };
    const hBig = harness({ agentEnabled: true, verificationOn: true, media: big.media });
    await hBig.route(withMessage(audio));
    expect(agentEntries(hBig)[0]).toMatchObject({ kind: "audio", mediaStatus: "too_large" });

    vi.useFakeTimers();
    const failing = io({ download: () => Promise.reject(new Error("boom")) });
    const hFail = harness({ agentEnabled: true, verificationOn: true, media: failing.media });
    const routed = hFail.route(withMessage(image));
    await vi.advanceTimersByTimeAsync(10_000);
    await routed;
    vi.useRealTimers();
    expect(agentEntries(hFail)[0]).toMatchObject({ kind: "image", mediaStatus: "download_failed" });

    const hOff = harness({ agentEnabled: true, verificationOn: true, media: null });
    await hOff.route(withMessage(image));
    expect(agentEntries(hOff)[0]).toMatchObject({
      kind: "image",
      mediaStatus: "storage_unavailable",
    });
  });

  it("ignores reactions and other protocol messages", async () => {
    const h = harness({ agentEnabled: true, verificationOn: true });
    expect(await h.route(withMessage({}))).toMatchObject({ reason: "not_content" });
  });
});

describe("agent settings cache", () => {
  it("reads at most every 30 s and keeps the last good value when a read fails", async () => {
    let now = 0;
    let reads = 0;
    let fail = false;
    const cache = new AgentSettingsCache(
      {} as Database,
      logger,
      () => now,
      () => {
        reads++;
        if (fail) return Promise.reject(new Error("db down"));
        return Promise.resolve({
          agent: settingsWith(),
          verificationOn: false,
          whatsappLoginOn: true,
        });
      },
    );
    expect((await cache.current()).agent.enabled).toBe(true);
    now = 29_000;
    await cache.current();
    expect(reads).toBe(1);
    now = 31_000;
    fail = true;
    expect((await cache.current()).agent.enabled).toBe(true);
    expect(reads).toBe(2);
  });

  it("starts with the agent off and verification as today when nothing could be read", async () => {
    const cache = new AgentSettingsCache(
      {} as Database,
      logger,
      () => 0,
      () => Promise.reject(new Error("db down")),
    );
    const value = await cache.current();
    expect(value.agent.enabled).toBe(false);
    expect(value.verificationOn).toBe(true);
  });
});

describe("replyDelayMs", () => {
  const base = { lastInboundAt: NOW, now: NOW, replyDelaySeconds: 10 };

  it("is the configured delay plus or minus 25 %", () => {
    expect(replyDelayMs({ ...base, random: 0 })).toBe(7_500);
    expect(replyDelayMs({ ...base, random: 0.5 })).toBe(10_000);
    expect(replyDelayMs({ ...base, random: 0.999999 })).toBeGreaterThanOrEqual(12_499);
    expect(replyDelayMs({ ...base, random: 0.999999 })).toBeLessThanOrEqual(12_500);
  });

  it("counts from the customer's last message, never goes negative", () => {
    expect(replyDelayMs({ ...base, now: NOW + 4_000, random: 0.5 })).toBe(6_000);
    expect(replyDelayMs({ ...base, now: NOW + 60_000, random: 0 })).toBe(0);
  });

  it("never waits more than 60 s from now", () => {
    expect(replyDelayMs({ ...base, replyDelaySeconds: 60, random: 1 })).toBe(MAX_REPLY_WAIT_MS);
    expect(replyDelayMs({ ...base, lastInboundAt: NOW + 120_000, random: 0.5 })).toBe(
      MAX_REPLY_WAIT_MS,
    );
  });
});

describe("outbound guard and sending", () => {
  const MESSAGE_IDS = [
    "018f0000-0000-7000-8000-000000000011",
    "018f0000-0000-7000-8000-000000000012",
    "018f0000-0000-7000-8000-000000000013",
  ] as const;
  const CONVERSATION = "018f0000-0000-7000-8000-000000000001";

  interface Out {
    redis: FakeRedis;
    calls: string[];
    sleeps: number[];
    deps: AgentOutboundDeps;
    run: (parts: unknown[], streamId?: string) => ReturnType<typeof processAgentOut>;
    verdicts: () => WaAgentSent[];
  }

  function outbound(
    options: {
      agent?: Partial<WaAgentSettings>;
      connected?: boolean;
      lastInboundAgoMs?: number | null;
      files?: Record<string, Buffer>;
      failOn?: string;
      onSleep?: (redis: FakeRedis) => void;
      mediaOrigin?: string | undefined;
    } = {},
  ): Out {
    const redis = new FakeRedis();
    const calls: string[] = [];
    const sleeps: number[] = [];
    if (options.lastInboundAgoMs !== null) {
      redis.values.set(waAgentLastInKey(PN), String(NOW - (options.lastInboundAgoMs ?? 0)));
    }
    const fail = (what: string) =>
      options.failOn === what ? Promise.reject(new Error("socket closed")) : Promise.resolve();
    let counter = 0;
    const id = async (what: string) => {
      await fail(what);
      calls.push(what);
      return `WA${String(++counter)}`;
    };
    const socket: AgentSocket = {
      isConnected: () => options.connected ?? true,
      composing: () => {
        calls.push("composing");
        return Promise.resolve();
      },
      paused: () => {
        calls.push("paused");
        return Promise.resolve();
      },
      sendAgentText: (_jid, text) => id(`text:${text}`),
      sendImage: (_jid, data, caption) => id(`image:${String(data.length)}:${caption ?? ""}`),
      sendDocument: (_jid, data, name, mime) => id(`doc:${name}:${mime}:${String(data.length)}`),
      sendVoice: (_jid, data) => id(`voice:${String(data.length)}`),
      sendImageUrl: (_jid, url, caption) => id(`imageurl:${url}:${caption ?? ""}`),
      sendDocumentUrl: (_jid, url, name, mime) => id(`docurl:${url}:${name}:${mime}`),
    };
    const files = options.files ?? {};
    const deps: AgentOutboundDeps = {
      redis: redis as unknown as AgentOutboundDeps["redis"],
      settings: switches({ ...options.agent }),
      socket,
      store: { get: (key) => Promise.resolve(files[key] ?? null) },
      logger,
      mediaOrigin: "mediaOrigin" in options ? options.mediaOrigin : MEDIA_ORIGIN,
      sleep: (ms) => {
        sleeps.push(ms);
        options.onSleep?.(redis);
        return Promise.resolve();
      },
      now: () => NOW,
      random: () => 0.5,
    };
    return {
      redis,
      calls,
      sleeps,
      deps,
      run: (parts, streamId) =>
        processAgentOut(
          {
            conversationId: CONVERSATION,
            messageIds: MESSAGE_IDS.slice(0, parts.length),
            jid: PN,
            parts,
          },
          deps,
          streamId,
        ),
      verdicts: () =>
        redis.stream<unknown>(WA_AGENT_SENT_STREAM).map((value) => waAgentSentSchema.parse(value)),
    };
  }

  const text = (value: string) => ({ kind: "text", text: value });

  it("types, waits out the reply delay, sends the parts in order and reports each", async () => {
    const out = outbound({ lastInboundAgoMs: 2_000 });
    const result = await out.run([text("one"), text("two")]);
    expect(result).toEqual({ outcome: "sent", sent: 2 });
    expect(out.calls).toEqual(["composing", "text:one", "composing", "text:two", "paused"]);
    // 10 s from the customer's message, 2 s already gone; then spacing (0) for part one.
    expect(out.sleeps[0]).toBe(8_000);
    expect(out.verdicts()).toEqual([
      { messageId: MESSAGE_IDS[0], status: "sent", waMessageId: "WA1" },
      { messageId: MESSAGE_IDS[1], status: "sent", waMessageId: "WA2" },
    ]);
    // The bridge's own ids are remembered so their echo is not mistaken for the owner typing.
    expect(out.redis.values.has(waAgentSentIdKey("WA1"))).toBe(true);
    expect(out.redis.values.has(waAgentSentIdKey("WA2"))).toBe(true);
    expect(out.redis.values.has("wa:last-sent")).toBe(true);
  });

  it("does not send the typing indicator when it is switched off", async () => {
    const out = outbound({ agent: { typingIndicator: false } });
    await out.run([text("one")]);
    expect(out.calls).not.toContain("composing");
  });

  it("sends images, PDFs and voice notes from the bucket", async () => {
    const out = outbound({
      files: {
        "wa/2027/01/img": Buffer.alloc(10),
        "wa/2027/01/doc": Buffer.alloc(20),
        "wa/2027/01/voice": Buffer.alloc(30),
      },
      agent: { caps: { ...settingDefault("waAgent").caps, maxMessagesPerTurn: 3 } },
    });
    await out.run([
      { kind: "image", mediaKey: "wa/2027/01/img", caption: "cap" },
      { kind: "document", mediaKey: "wa/2027/01/doc", fileName: "bank.pdf" },
      { kind: "voice", mediaKey: "wa/2027/01/voice" },
    ]);
    expect(out.calls.filter((call) => !call.startsWith("composing") && call !== "paused")).toEqual([
      "image:10:cap",
      "doc:bank.pdf:application/pdf:20",
      "voice:30",
    ]);
  });

  it("sends an image and a PDF by public media url", async () => {
    const out = outbound({
      agent: { caps: { ...settingDefault("waAgent").caps, maxMessagesPerTurn: 3 } },
    });
    const image = `${MEDIA_ORIGIN}/media/abc/1200.jpeg`;
    const doc = `${MEDIA_ORIGIN}/docs/bank.pdf`;
    const result = await out.run([
      { kind: "image", url: image, caption: "cap" },
      { kind: "document", url: doc, fileName: "bank.pdf" },
      text("after"),
    ]);
    expect(result).toEqual({ outcome: "sent", sent: 3 });
    expect(out.calls.filter((call) => !call.startsWith("composing") && call !== "paused")).toEqual([
      `imageurl:${image}:cap`,
      `docurl:${doc}:bank.pdf:application/pdf`,
      "text:after",
    ]);
  });

  it("refuses a part whose url is outside the media origin, or any url without an origin", async () => {
    for (const url of [
      "https://evil.example.net/a.jpeg",
      `${MEDIA_ORIGIN}.evil.net/a.jpeg`,
      `${MEDIA_ORIGIN}@evil.net/a.jpeg`,
      `${MEDIA_ORIGIN}/../a.jpeg`,
    ]) {
      const out = outbound();
      expect(await out.run([{ kind: "image", url }])).toEqual({
        outcome: "dropped",
        reason: "invalid",
      });
      expect(out.calls).toEqual([]);
    }
    const noOrigin = outbound({ mediaOrigin: undefined });
    expect(await noOrigin.run([{ kind: "image", url: `${MEDIA_ORIGIN}/a.jpeg` }])).toEqual({
      outcome: "dropped",
      reason: "invalid",
    });
  });

  it("rejects a part that names both a stored key and a url", async () => {
    const out = outbound();
    const result = await out.run([
      { kind: "image", mediaKey: "wa/2027/01/img", url: `${MEDIA_ORIGIN}/a.jpeg` },
    ]);
    expect(result).toEqual({ outcome: "invalid" });
  });

  it("drops a part whose file is gone and still sends the rest", async () => {
    const out = outbound();
    const result = await out.run([{ kind: "image", mediaKey: "wa/2027/01/none" }, text("after")]);
    expect(result).toEqual({ outcome: "sent", sent: 1 });
    expect(out.verdicts()).toEqual([
      { messageId: MESSAGE_IDS[0], status: "dropped", reason: "media_missing" },
      { messageId: MESSAGE_IDS[1], status: "sent", waMessageId: "WA1" },
    ]);
  });

  it("stops at the first failed send and reports the rest as dropped", async () => {
    const out = outbound({ failOn: "text:two" });
    await out.run([text("one"), text("two"), text("three")]);
    expect(out.verdicts()).toEqual([
      { messageId: MESSAGE_IDS[0], status: "sent", waMessageId: "WA1" },
      { messageId: MESSAGE_IDS[1], status: "dropped", reason: "send_failed" },
      { messageId: MESSAGE_IDS[2], status: "dropped", reason: "send_failed" },
    ]);
  });

  describe("drops with a reason and sends nothing", () => {
    async function expectDropped(out: Out, reason: string, parts = [text("hi")]) {
      expect(await out.run(parts)).toEqual({ outcome: "dropped", reason });
      expect(out.calls.filter((call) => call.startsWith("text:"))).toEqual([]);
      expect(out.calls).not.toContain("composing");
      expect(out.verdicts()).toEqual(
        parts.map((_part, index) => ({ messageId: MESSAGE_IDS[index], status: "dropped", reason })),
      );
    }

    it("when the agent is disabled", async () => {
      await expectDropped(outbound({ agent: { enabled: false } }), "disabled");
    });

    it("when WhatsApp is not connected", async () => {
      await expectDropped(outbound({ connected: false }), "not_connected");
    });

    it("when the customer never wrote (never start a conversation)", async () => {
      await expectDropped(outbound({ lastInboundAgoMs: null }), "no_recent_inbound");
    });

    it("when the customer's last message is older than 24 h", async () => {
      await expectDropped(
        outbound({ lastInboundAgoMs: 24 * 3_600_000 + 1_000 }),
        "no_recent_inbound",
      );
      const fresh = outbound({ lastInboundAgoMs: 23 * 3_600_000 });
      expect((await fresh.run([text("hi")])).outcome).toBe("sent");
    });

    it("while the chat is paused after the owner took over", async () => {
      const out = outbound();
      out.redis.values.set(waAgentPauseKey(PN), "1");
      await expectDropped(out, "paused");
    });

    it("when the chat is blocked", async () => {
      const out = outbound();
      out.redis.values.set(waAgentBlockKey(PN), "1");
      await expectDropped(out, "blocked");
    });

    it("over the per-chat hourly cap", async () => {
      const out = outbound({
        agent: { caps: { ...settingDefault("waAgent").caps, perChatPerHour: 2 } },
      });
      expect((await out.run([text("a"), text("b")])).outcome).toBe("sent");
      out.calls.length = 0;
      expect(await out.run([text("c")])).toEqual({ outcome: "dropped", reason: "cap_chat_hour" });
      expect(out.calls.filter((call) => call.startsWith("text:"))).toEqual([]);
    });

    it("over the per-chat daily cap", async () => {
      const out = outbound({
        agent: { caps: { ...settingDefault("waAgent").caps, perChatPerDay: 1 } },
      });
      await out.run([text("a")]);
      expect(await out.run([text("b")])).toEqual({ outcome: "dropped", reason: "cap_chat_day" });
    });

    it("over the daily total", async () => {
      const out = outbound({
        agent: { caps: { ...settingDefault("waAgent").caps, dailyTotal: 1 } },
      });
      await out.run([text("a")]);
      expect(await out.run([text("b")])).toEqual({ outcome: "dropped", reason: "cap_total_day" });
    });

    it("when the entry is left over from before a restart", async () => {
      const out = outbound();
      const old = `${String(NOW - AGENT_OUT_STALE_MS - 1)}-0`;
      expect(await out.run([text("late")], old)).toEqual({ outcome: "dropped", reason: "stale" });
      expect((await out.run([text("fresh")], `${String(NOW - 1_000)}-0`)).outcome).toBe("sent");
    });
  });

  it("re-checks pause while 'typing' and gives the caps back", async () => {
    const out = outbound({
      onSleep: (redis) => redis.values.set(waAgentPauseKey(PN), "1"),
    });
    expect(await out.run([text("hi")])).toEqual({ outcome: "dropped", reason: "paused" });
    expect(out.calls.filter((call) => call.startsWith("text:"))).toEqual([]);
    expect([...out.redis.counters.values()].every((value) => value === 0)).toBe(true);
  });

  it("answers invalid entries with nothing sent", async () => {
    const out = outbound();
    expect(await processAgentOut({ nonsense: true }, out.deps)).toEqual({ outcome: "invalid" });
    expect(out.calls).toEqual([]);
  });
});
