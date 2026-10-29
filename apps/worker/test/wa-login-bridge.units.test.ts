import { WA_INBOUND_STREAM, WA_REPLY_STREAM } from "@wasfa/shared/schemas/phone";
import { WA_LOGIN_STREAM, waLoginEntrySchema } from "@wasfa/shared/schemas/wa-login";
import { settingDefault } from "@wasfa/shared/settings";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { routeInbound, type InboundRouterDeps } from "../src/wa-bridge/agent-inbound.js";

import type { LidResolver, RawMessage } from "../src/wa-bridge/inbound.js";

const NOW = 1_800_000_000_000;
const PN = "201012345678@s.whatsapp.net";
const LID = "123456789012345@lid";
const noLid: LidResolver = { getPNForLID: () => Promise.resolve(null) };

/** Just the Redis commands the router uses, in memory. */
class FakeRedis {
  readonly values = new Map<string, string>();
  readonly streams = new Map<string, unknown[]>();

  set(key: string, value: string, ...rest: Array<string | number>): Promise<"OK" | null> {
    if (rest.includes("NX") && this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    return Promise.resolve("OK");
  }

  exists(key: string): Promise<number> {
    return Promise.resolve(this.values.has(key) ? 1 : 0);
  }

  xadd(stream: string, ...args: Array<string | number>): Promise<string> {
    const list = this.streams.get(stream) ?? [];
    list.push(JSON.parse(String(args.at(-1))) as unknown);
    this.streams.set(stream, list);
    return Promise.resolve("1-0");
  }
}

function setup(options: { loginOn?: boolean; agentOn?: boolean } = {}) {
  const redis = new FakeRedis();
  const noted: string[] = [];
  let reads = 0;
  const deps: InboundRouterDeps = {
    redis: redis as unknown as InboundRouterDeps["redis"],
    guard: {
      noteInbound: (jid: string, id: string) => {
        noted.push(`${jid}:${id}`);
        return Promise.resolve();
      },
    },
    settings: {
      current: () =>
        Promise.resolve({
          agent: { ...settingDefault("waAgent"), enabled: options.agentOn ?? false },
          verificationOn: true,
          whatsappLoginOn: options.loginOn ?? true,
        }),
    },
    resolver: noLid,
    media: null,
    logger: pino({ level: "silent" }),
    now: () => NOW,
  };
  return {
    redis,
    noted,
    deps,
    get reads() {
      return reads;
    },
    route: (raw: RawMessage) =>
      routeInbound(raw, deps, () => {
        reads++;
        return Promise.resolve();
      }),
  };
}

function text(body: string, key: Partial<RawMessage["key"]> = {}, extra: Partial<RawMessage> = {}) {
  return {
    key: { id: "MSG1", remoteJid: PN, fromMe: false, ...key },
    message: { conversation: body },
    messageTimestamp: Math.floor(NOW / 1000),
    pushName: "Mona",
    ...extra,
  } satisfies RawMessage;
}

const loginEntries = (h: ReturnType<typeof setup>) => h.redis.streams.get(WA_LOGIN_STREAM) ?? [];

describe("login claims in the bridge", () => {
  it("queues a claim with the resolved phone, the token and the clipped name", async () => {
    const h = setup();
    const outcome = await h.route(
      text("رمز الدخول لوصفة: WASFA-abcd-1234", {}, { pushName: "Mona\u0000 " }),
    );
    expect(outcome).toEqual({ route: "login", kind: "login" });
    const [entry] = loginEntries(h);
    expect(waLoginEntrySchema.parse(entry)).toEqual({
      kind: "login",
      id: "MSG1",
      phone: "+201012345678",
      jid: PN,
      receivedAt: NOW,
      token: "ABCD1234",
      pushName: "Mona",
    });
    expect(h.noted).toEqual([`${PN}:MSG1`]);
    expect(h.reads).toBe(1);
    expect(h.redis.streams.get(WA_INBOUND_STREAM)).toBeUndefined();
  });

  it("routes a claim even with the agent on, and before code parsing", async () => {
    const h = setup({ agentOn: true });
    // The token contains digits; none of them may be mistaken for a verification code.
    await h.route(text("WASFA-1234-5678"));
    expect(loginEntries(h)).toHaveLength(1);
    expect(h.redis.streams.get(WA_INBOUND_STREAM)).toBeUndefined();
  });

  it("answers an unresolved sender once with wa_unresolved and signs nobody in", async () => {
    const h = setup();
    const lid = text("WASFA-ABCD-1234", { remoteJid: LID });
    const outcome = await h.route(lid);
    expect(outcome).toEqual({ route: "ignored", reason: "unresolved_sender" });
    expect(loginEntries(h)).toHaveLength(0);
    expect(h.redis.streams.get(WA_REPLY_STREAM)).toEqual([
      { inboundId: "MSG1", jid: LID, outcome: "wa_unresolved" },
    ]);
  });

  it("takes the phone from the alternate jid of a LID chat", async () => {
    const h = setup();
    await h.route(text("WASFA-ABCD-1234", { remoteJid: LID, remoteJidAlt: PN }));
    expect(waLoginEntrySchema.parse(loginEntries(h)[0])).toMatchObject({ phone: "+201012345678" });
  });

  it("falls through to the old routing when the setting is off", async () => {
    const h = setup({ loginOn: false });
    const outcome = await h.route(text("WASFA-ABCD-1234"));
    expect(loginEntries(h)).toHaveLength(0);
    expect(outcome.route).toBe("ignored");
  });

  it("ignores old messages and the owner's own", async () => {
    const h = setup();
    const old = text("WASFA-ABCD-1234", {}, { messageTimestamp: Math.floor(NOW / 1000) - 3_600 });
    expect((await h.route(old)).route).toBe("ignored");
    expect((await h.route(text("WASFA-ABCD-1234", { fromMe: true }))).route).toBe("ignored");
    expect(loginEntries(h)).toHaveLength(0);
  });

  it("still verifies a plain code", async () => {
    const h = setup();
    expect(await h.route(text("رمز التحقق في وصفة AI: 482913"))).toEqual({ route: "verification" });
    expect(h.redis.streams.get(WA_INBOUND_STREAM)).toHaveLength(1);
    expect(loginEntries(h)).toHaveLength(0);
  });
});

describe("logout command in the bridge", () => {
  it.each(["خروج", "logout", " LOGOUT "])("%j is the undo word", async (word) => {
    const h = setup();
    expect(await h.route(text(word))).toEqual({ route: "login", kind: "logout" });
    expect(waLoginEntrySchema.parse(loginEntries(h)[0])).toMatchObject({
      kind: "logout",
      phone: "+201012345678",
    });
  });

  it("is the whole message: a sentence containing the word is not a command", async () => {
    const h = setup();
    await h.route(text("خروج من الحساب كيف؟"));
    await h.route(text("how do I logout"));
    expect(loginEntries(h)).toHaveLength(0);
  });

  it("is not routed when the setting is off", async () => {
    const h = setup({ loginOn: false });
    await h.route(text("LOGOUT"));
    expect(loginEntries(h)).toHaveLength(0);
  });
});
