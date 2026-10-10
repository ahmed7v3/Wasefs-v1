import { describe, expect, it } from "vitest";

import {
  MAX_INBOUND_AGE_MS,
  extractInbound,
  isDirectJid,
  splitJid,
  type LidResolver,
  type RawMessage,
} from "../src/wa-bridge/inbound.js";

const NOW = 1_800_000_000_000;
const nowSeconds = Math.floor(NOW / 1000);
const noLid: LidResolver = { getPNForLID: () => Promise.resolve(null) };

function text(
  body: string,
  key: Partial<RawMessage["key"]> = {},
  extra: Partial<RawMessage> = {},
): RawMessage {
  return {
    key: { id: "MSG1", remoteJid: "201012345678@s.whatsapp.net", fromMe: false, ...key },
    message: { conversation: body },
    messageTimestamp: nowSeconds,
    ...extra,
  };
}

describe("splitJid / isDirectJid", () => {
  it("drops device and agent suffixes", () => {
    expect(splitJid("201012345678:12@s.whatsapp.net")).toEqual({
      user: "201012345678",
      server: "s.whatsapp.net",
    });
    expect(splitJid("201012345678_1:3@s.whatsapp.net")?.user).toBe("201012345678");
    expect(splitJid("nonsense")).toBeNull();
    expect(splitJid("@s.whatsapp.net")).toBeNull();
  });

  it("accepts 1:1 chats only", () => {
    expect(isDirectJid("201012345678@s.whatsapp.net")).toBe(true);
    expect(isDirectJid("123456789@lid")).toBe(true);
    expect(isDirectJid("120363000000@g.us")).toBe(false);
    expect(isDirectJid("status@broadcast")).toBe(false);
    expect(isDirectJid("12345@newsletter")).toBe(false);
    expect(isDirectJid("12345@broadcast")).toBe(false);
    expect(isDirectJid(null)).toBe(false);
    expect(isDirectJid(undefined)).toBe(false);
  });
});

describe("extractInbound", () => {
  it("turns a pre-filled verification message into a claim with the sender's number", async () => {
    const result = await extractInbound(text("رمز التحقق في وصفة AI: 482913"), noLid, NOW);
    expect(result).toEqual({
      ok: true,
      message: {
        id: "MSG1",
        phone: "+201012345678",
        code: "482913",
        receivedAt: nowSeconds * 1000,
        jid: "201012345678@s.whatsapp.net",
      },
    });
  });

  it("reads extended text and disappearing-message wrappers, and Long timestamps", async () => {
    const extended = await extractInbound(
      {
        ...text(""),
        message: { extendedTextMessage: { text: "482913" } },
        messageTimestamp: { toNumber: () => nowSeconds },
      },
      noLid,
      NOW,
    );
    expect(extended.ok).toBe(true);
    const wrapped = await extractInbound(
      { ...text(""), message: { ephemeralMessage: { message: { conversation: "482913" } } } },
      noLid,
      NOW,
    );
    expect(wrapped.ok).toBe(true);
  });

  it("resolves a LID sender through remoteJidAlt first, then the LID mapping", async () => {
    const viaAlt = await extractInbound(
      text("482913", { remoteJid: "999@lid", remoteJidAlt: "201099999999@s.whatsapp.net" }),
      noLid,
      NOW,
    );
    expect(viaAlt).toMatchObject({ ok: true, message: { phone: "+201099999999" } });

    const lookups: string[] = [];
    const viaMap = await extractInbound(
      text("482913", { remoteJid: "999@lid" }),
      {
        getPNForLID: (lid) => {
          lookups.push(lid);
          return Promise.resolve("201088888888:7@s.whatsapp.net");
        },
      },
      NOW,
    );
    expect(viaMap).toMatchObject({ ok: true, message: { phone: "+201088888888" } });
    expect(lookups).toEqual(["999@lid"]);
  });

  it("ignores a sender it cannot resolve, including when the lookup throws", async () => {
    expect(await extractInbound(text("482913", { remoteJid: "999@lid" }), noLid, NOW)).toEqual({
      ok: false,
      reason: "unresolved_sender",
    });
    const broken: LidResolver = { getPNForLID: () => Promise.reject(new Error("boom")) };
    expect(await extractInbound(text("482913", { remoteJid: "999@lid" }), broken, NOW)).toEqual({
      ok: false,
      reason: "unresolved_sender",
    });
  });

  it("ignores everything that is not a person's text containing a code", async () => {
    const reason = async (raw: RawMessage) => {
      const result = await extractInbound(raw, noLid, NOW);
      return result.ok ? "accepted" : result.reason;
    };
    expect(await reason(text("482913", { fromMe: true }))).toBe("from_me");
    expect(await reason(text("482913", { remoteJid: "120363000000@g.us" }))).toBe("not_direct");
    expect(await reason(text("482913", { remoteJid: "status@broadcast" }))).toBe("not_direct");
    expect(await reason(text("482913", { id: null }))).toBe("no_id");
    expect(await reason({ ...text(""), message: { conversation: null } })).toBe("not_text");
    expect(await reason({ ...text(""), message: null })).toBe("not_text");
    expect(await reason(text("hello there"))).toBe("no_code");
    expect(await reason(text("call 01012345678"))).toBe("no_code");
  });

  it("ignores history replayed after a reconnect", async () => {
    const old = text(
      "482913",
      {},
      { messageTimestamp: nowSeconds - MAX_INBOUND_AGE_MS / 1000 - 5 },
    );
    expect(await extractInbound(old, noLid, NOW)).toEqual({ ok: false, reason: "stale" });
  });

  it("never takes the phone number from the message text", async () => {
    const result = await extractInbound(
      text("my number is +201000000000, code 482913"),
      noLid,
      NOW,
    );
    expect(result).toMatchObject({ ok: true, message: { phone: "+201012345678" } });
  });
});
