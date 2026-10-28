import { t } from "@wasfa/shared/i18n";
import { WA_INBOUND_STREAM, WA_REPLY_STREAM, replyText } from "@wasfa/shared/schemas/phone";
import { settingDefault } from "@wasfa/shared/settings";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { routeInbound, type InboundRouterDeps } from "../src/wa-bridge/agent-inbound.js";
import { isAllowedReplyText } from "../src/wa-bridge/guard.js";
import {
  describeIgnored,
  hourBucket,
  recordIgnored,
} from "../src/wa-bridge/inbound-diagnostics.js";
import { extractInbound, unwrapContent } from "../src/wa-bridge/inbound.js";
import { createLidResolver, LID_CACHE_TTL_SECONDS } from "../src/wa-bridge/lid-cache.js";

import type { LidResolver, RawMessage } from "../src/wa-bridge/inbound.js";
import type { Logger } from "pino";

const NOW = 1_800_000_000_000;
const nowSeconds = Math.floor(NOW / 1000);
const LID = "123456789012345@lid";
const PN = "201012345678@s.whatsapp.net";
const noLid: LidResolver = { getPNForLID: () => Promise.resolve(null) };

function lidMessage(
  key: Partial<RawMessage["key"]> = {},
  extra: Partial<RawMessage> = {},
): RawMessage {
  return {
    key: { id: "BIZ1", remoteJid: LID, fromMe: false, ...key },
    message: { conversation: "482913" },
    messageTimestamp: nowSeconds,
    verifiedBizName: "Some Shop",
    ...extra,
  };
}

/** Just the Redis commands these units use. */
class FakeRedis {
  readonly values = new Map<string, string>();
  readonly streams = new Map<string, unknown[]>();
  readonly hashes = new Map<string, Map<string, number>>();
  readonly ttls = new Map<string, number>();
  readonly sets = new Map<string, string[]>();

  srandmember(key: string, count: number): Promise<string[]> {
    return Promise.resolve((this.sets.get(key) ?? []).slice(0, count));
  }

  set(key: string, value: string, ...rest: Array<string | number>): Promise<"OK" | null> {
    if (rest.includes("NX") && this.values.has(key)) return Promise.resolve(null);
    this.values.set(key, value);
    const ex = rest.indexOf("EX");
    if (ex >= 0) this.ttls.set(key, Number(rest[ex + 1]));
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
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

  multi() {
    const ops: Array<() => void> = [];
    const chain = {
      hincrby: (key: string, field: string, by: number) => {
        ops.push(() => {
          const hash = this.hashes.get(key) ?? new Map<string, number>();
          hash.set(field, (hash.get(field) ?? 0) + by);
          this.hashes.set(key, hash);
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.ttls.set(key, seconds);
        });
        return chain;
      },
      exec: () => {
        for (const op of ops) op();
        return Promise.resolve([]);
      },
    };
    return chain;
  }
}

describe("business-like LID senders: where the phone comes from", () => {
  it("uses remoteJidAlt", async () => {
    const result = await extractInbound(lidMessage({ remoteJidAlt: PN }), noLid, NOW);
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678", jid: LID } });
  });

  it("uses participantAlt", async () => {
    const result = await extractInbound(lidMessage({ participantAlt: PN }), noLid, NOW);
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678" } });
  });

  it("uses the LID mapping", async () => {
    const resolver: LidResolver = {
      getPNForLID: () => Promise.resolve("201012345678:4@s.whatsapp.net"),
    };
    const result = await extractInbound(lidMessage(), resolver, NOW);
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678" } });
  });

  it("learns the pair when an alternate field resolves a LID", async () => {
    const learned: Array<[string, string]> = [];
    const resolver: LidResolver = {
      getPNForLID: () => Promise.resolve(null),
      learn: (lid, pn) => {
        learned.push([lid, pn]);
        return Promise.resolve();
      },
    };
    await extractInbound(lidMessage({ remoteJidAlt: PN }), resolver, NOW);
    expect(learned).toEqual([[LID, PN]]);
  });

  it("answers hosted business jids on the phone-number jid", async () => {
    const result = await extractInbound(
      lidMessage({ remoteJid: "201012345678@hosted" }),
      noLid,
      NOW,
    );
    expect(result).toMatchObject({ ok: true, message: { jid: PN, phone: "+201012345678" } });
  });
});

describe("the Redis lid -> phone cache", () => {
  it("serves a learned mapping without asking Baileys, and keeps it 30 days", async () => {
    const redis = new FakeRedis();
    const calls: string[] = [];
    const resolver = createLidResolver({
      redis: redis as never,
      baileys: {
        getPNForLID: (lid) => {
          calls.push(lid);
          return Promise.resolve(null);
        },
        getLIDForPN: () => Promise.resolve(null),
      },
      logger: pino({ level: "silent" }),
    });
    await resolver.learn?.(LID, "201012345678:9@s.whatsapp.net");
    expect(redis.ttls.get("wa:lid:123456789012345")).toBe(LID_CACHE_TTL_SECONDS);
    expect(LID_CACHE_TTL_SECONDS).toBe(30 * 24 * 3600);
    expect(await resolver.getPNForLID(LID)).toBe(PN);
    expect(calls).toEqual([]);
    const viaCache = await extractInbound(lidMessage(), resolver, NOW);
    expect(viaCache).toMatchObject({ ok: true, message: { phone: "+201012345678" } });
  });

  it("stores what Baileys answers and ignores junk pairs", async () => {
    const redis = new FakeRedis();
    const resolver = createLidResolver({
      redis: redis as never,
      baileys: { getPNForLID: () => Promise.resolve(PN), getLIDForPN: () => Promise.resolve(null) },
      logger: pino({ level: "silent" }),
    });
    expect(await resolver.getPNForLID(LID)).toBe(PN);
    expect(redis.values.get("wa:lid:123456789012345")).toBe("201012345678");
    await resolver.learn?.("nonsense", PN);
    await resolver.learn?.(LID, "abc@s.whatsapp.net");
    expect(redis.values.size).toBe(1);
  });
});

describe("a LID sender WhatsApp never paired with a number (WhatsApp Business)", () => {
  function resolverWith(claimed: string[], lidOf: Record<string, string>) {
    const redis = new FakeRedis();
    redis.sets.set("wa:lidclaim:482913", claimed);
    const asked: string[] = [];
    const resolver = createLidResolver({
      redis: redis as never,
      baileys: {
        getPNForLID: () => Promise.resolve(null),
        getLIDForPN: (pn) => {
          asked.push(pn);
          return Promise.resolve(lidOf[pn] ?? null);
        },
      },
      logger: pino({ level: "silent" }),
    });
    return { redis, asked, resolver };
  }

  it("accepts the code when WhatsApp says the claimed number's LID is the sender's, and learns it", async () => {
    const { redis, resolver } = resolverWith(["201012345678"], { [PN]: "123456789012345:3@lid" });
    const result = await extractInbound(lidMessage(), resolver, NOW);
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678", jid: LID } });
    expect(redis.values.get("wa:lid:123456789012345")).toBe("201012345678");
  });

  it("refuses when the claimed number belongs to another LID", async () => {
    const { resolver } = resolverWith(["201012345678"], { [PN]: "999999999999999@lid" });
    expect(await extractInbound(lidMessage(), resolver, NOW)).toEqual({
      ok: false,
      reason: "unresolved_sender",
    });
  });

  it("picks the matching number among several claims and skips junk", async () => {
    const other = "201099999999@s.whatsapp.net";
    const { resolver, asked } = resolverWith(["nope", "201099999999", "201012345678"], {
      [other]: "555555555555555@lid",
      [PN]: "123456789012345@lid",
    });
    const result = await extractInbound(lidMessage(), resolver, NOW);
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678" } });
    expect(asked).toEqual([other, PN]);
  });

  it("does nothing without a claim for that code", async () => {
    const { resolver, asked } = resolverWith([], {});
    expect(await extractInbound(lidMessage(), resolver, NOW)).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
  });

  it("treats a failing WhatsApp lookup as unresolved", async () => {
    const redis = new FakeRedis();
    redis.sets.set("wa:lidclaim:482913", ["201012345678"]);
    const resolver = createLidResolver({
      redis: redis as never,
      baileys: {
        getPNForLID: () => Promise.resolve(null),
        getLIDForPN: () => Promise.reject(new Error("usync timeout")),
      },
      logger: pino({ level: "silent" }),
    });
    expect(await extractInbound(lidMessage(), resolver, NOW)).toEqual({
      ok: false,
      reason: "unresolved_sender",
    });
  });
});

describe("a code from a sender that cannot be resolved", () => {
  function setup() {
    const redis = new FakeRedis();
    const noted: string[] = [];
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
            agent: settingDefault("waAgent"),
            verificationOn: true,
            whatsappLoginOn: true,
          }),
      },
      resolver: noLid,
      media: null,
      logger: pino({ level: "silent" }),
      now: () => NOW,
    };
    return { redis, noted, deps };
  }

  it("verifies nothing and queues one waUnresolved reply on the same chat", async () => {
    const { redis, noted, deps } = setup();
    const outcome = await routeInbound(lidMessage(), deps, () => Promise.resolve());
    expect(outcome).toEqual({ route: "ignored", reason: "unresolved_sender" });
    expect(redis.streams.get(WA_INBOUND_STREAM)).toBeUndefined();
    expect(redis.streams.get(WA_REPLY_STREAM)).toEqual([
      { inboundId: "BIZ1", jid: LID, outcome: "wa_unresolved" },
    ]);
    expect(noted).toEqual([`${LID}:BIZ1`]);

    // A second code in the same hour is not answered again.
    await routeInbound(lidMessage({ id: "BIZ2" }), deps, () => Promise.resolve());
    expect(redis.streams.get(WA_REPLY_STREAM)).toHaveLength(1);
  });

  it("has a reply the guard accepts, in both languages", () => {
    expect(isAllowedReplyText(replyText("wa_unresolved"))).toBe(true);
    expect(isAllowedReplyText(t("phone.verify.waUnresolved", undefined, "en"))).toBe(true);
    expect(replyText("wa_unresolved")).toBe(t("phone.verify.waUnresolved", undefined, "ar"));
  });
});

describe("content wrappers", () => {
  const inner = { extendedTextMessage: { text: "482913" } };
  it.each([
    ["viewOnceMessage", { viewOnceMessage: { message: inner } }],
    ["viewOnceMessageV2", { viewOnceMessageV2: { message: inner } }],
    ["viewOnceMessageV2Extension", { viewOnceMessageV2Extension: { message: inner } }],
    ["deviceSentMessage", { deviceSentMessage: { message: inner } }],
    ["editedMessage", { editedMessage: { message: inner } }],
    ["ephemeralMessage", { ephemeralMessage: { message: inner } }],
    [
      "ephemeral over view-once",
      { ephemeralMessage: { message: { viewOnceMessage: { message: inner } } } },
    ],
  ] as const)("reads a code through %s", async (_name, message) => {
    const result = await extractInbound({ ...lidMessage({ remoteJid: PN }), message }, noLid, NOW);
    expect(result).toMatchObject({ ok: true, message: { code: "482913" } });
  });

  it("unwraps documentWithCaptionMessage down to the document", () => {
    const document = { documentMessage: { caption: "see", mimetype: "application/pdf" } };
    expect(unwrapContent({ documentWithCaptionMessage: { message: document } })).toBe(document);
  });
});

describe("diagnostics for ignored messages", () => {
  const silentLogger = (lines: unknown[]) =>
    pino(
      { level: "info" },
      { write: (line: string) => void lines.push(JSON.parse(line) as unknown) },
    ) as Logger;

  it("describes a ciphertext stub without crashing", () => {
    const raw: RawMessage = {
      key: { id: "X", remoteJid: LID, fromMe: false },
      messageStubType: 2,
      messageStubParameters: ["Message absent from node"],
      verifiedBizName: "Shop",
    };
    expect(describeIgnored("not_text", raw)).toEqual({
      reason: "not_text",
      addressing: "lid",
      hasAlt: false,
      stub: 2,
      stubDetail: "absent",
      contentType: null,
      business: true,
    });
  });

  it("reports the first real content key, through wrappers", () => {
    const raw = lidMessage(
      { remoteJidAlt: PN },
      {
        verifiedBizName: null,
        message: {
          viewOnceMessage: { message: { imageMessage: { caption: "secret 123456" } } },
        },
      },
    );
    expect(describeIgnored("not_text", raw)).toMatchObject({
      contentType: "imageMessage",
      hasAlt: true,
      business: false,
    });
  });

  it("logs at info with no phone, jid, text or code, and counts the reason per hour", async () => {
    const lines: unknown[] = [];
    const redis = new FakeRedis();
    const raw = lidMessage(
      { remoteJidAlt: PN },
      { message: { conversation: "hello 482913 from 201012345678" }, pushName: "Mona" },
    );
    await recordIgnored(
      { redis: redis as never, logger: silentLogger(lines), now: () => NOW },
      "no_code",
      raw,
    );
    const serialized = JSON.stringify(lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 30, reason: "no_code", addressing: "lid" });
    for (const secret of [
      "201012345678",
      "123456789012345",
      "482913",
      "hello",
      "Mona",
      "Some Shop",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    const key = `wa:inbound:ignored:${hourBucket(NOW)}`;
    expect(redis.hashes.get(key)?.get("no_code")).toBe(1);
    expect(redis.ttls.get(key)).toBe(48 * 3600);
    expect(hourBucket(NOW)).toMatch(/^\d{10}$/);
  });
});
