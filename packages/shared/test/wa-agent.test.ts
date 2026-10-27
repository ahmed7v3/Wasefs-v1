import { describe, expect, it } from "vitest";

import {
  isMediaOriginUrl,
  waAgentInboundSchema,
  waAgentOutEntrySchema,
  waAgentOutboundFor,
  waAgentSentSchema,
} from "../src/schemas/wa-agent.js";
import { SETTINGS_REGISTRY, settingDefault, waAgentSettingsSchema } from "../src/settings.js";

const ID = "018f0000-0000-7000-8000-000000000001";

describe("waAgent setting", () => {
  it("is admin-only and off by default, with the documented defaults", () => {
    expect(SETTINGS_REGISTRY.waAgent.visibility).toBe("admin");
    const defaults = settingDefault("waAgent");
    expect(defaults).toMatchObject({
      enabled: false,
      guestsEnabled: true,
      replyDelaySeconds: 10,
      typingIndicator: true,
      caps: {
        perChatPerHour: 20,
        perChatPerDay: 60,
        dailyTotal: 1_500,
        maxReplyChars: 1_200,
        maxMessagesPerTurn: 3,
      },
      spendCapUsdMicros: 5_000_000,
      persona: "",
      language: "ar_eg",
      emojiLevel: "light",
      takeoverPauseMinutes: 120,
      retentionDays: 90,
      discounts: {
        enabled: false,
        percentOff: 10,
        plans: [],
        validHours: 24,
        perUserLifetime: 1,
        dailyCap: 20,
        newCustomersOnly: true,
        minUserMessages: 4,
      },
      media: [],
      voice: {
        enabled: false,
        replyMode: "mirror",
        sometimesPercent: 20,
        maxChars: 600,
        voiceId: "",
        modelId: "",
        transcribeIncoming: true,
      },
    });
  });

  it("enforces the documented bounds", () => {
    const bad = (value: unknown) => waAgentSettingsSchema.safeParse(value).success;
    expect(bad({ replyDelaySeconds: 2 })).toBe(false);
    expect(bad({ replyDelaySeconds: 61 })).toBe(false);
    expect(bad({ takeoverPauseMinutes: 4 })).toBe(false);
    expect(bad({ retentionDays: 6 })).toBe(false);
    expect(bad({ retentionDays: 366 })).toBe(false);
    expect(bad({ discounts: { percentOff: 51 } })).toBe(false);
    expect(bad({ language: "fr" })).toBe(false);
    expect(bad({ persona: "x".repeat(4_001) })).toBe(false);
    expect(bad({ media: Array.from({ length: 31 }, () => ({ key: "a", mediaAssetId: ID })) })).toBe(
      false,
    );
    expect(bad({ media: [{ key: "card", mediaAssetId: ID, caption: "Bank details" }] })).toBe(true);
  });
});

describe("wa agent stream schemas", () => {
  it("accepts an inbound text, a resolved phone or none, and rejects a bad media key", () => {
    const base = { waMessageId: "ABC", jid: "201012345678@s.whatsapp.net", direction: "in", ts: 1 };
    expect(
      waAgentInboundSchema.safeParse({ ...base, phone: "+201012345678", kind: "text", text: "hi" })
        .success,
    ).toBe(true);
    expect(waAgentInboundSchema.safeParse({ ...base, phone: null, kind: "other" }).success).toBe(
      true,
    );
    expect(
      waAgentInboundSchema.safeParse({
        ...base,
        phone: null,
        kind: "image",
        media: { key: "../etc/passwd", mime: "image/png", bytes: 1 },
      }).success,
    ).toBe(false);
    expect(
      waAgentInboundSchema.safeParse({ ...base, phone: "0101", kind: "text", text: "x" }).success,
    ).toBe(false);
  });

  it("bounds the outbound parts by the admin caps", () => {
    const schema = waAgentOutboundFor({ maxReplyChars: 10, maxMessagesPerTurn: 2 });
    expect(schema.safeParse([{ kind: "text", text: "short" }]).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse([{ kind: "text", text: "x".repeat(11) }]).success).toBe(false);
    expect(
      schema.safeParse(Array.from({ length: 3 }, () => ({ kind: "text", text: "a" }))).success,
    ).toBe(false);
    expect(schema.safeParse([{ kind: "document", mediaKey: "a/b.pdf" }]).success).toBe(false);
    expect(schema.safeParse([{ kind: "voice", mediaKey: "../x" }]).success).toBe(false);
  });

  it("takes a file by stored key or by public media url, never both, never neither", () => {
    const schema = waAgentOutboundFor({ maxReplyChars: 100, maxMessagesPerTurn: 3 });
    const url = "https://media.example.com/media/abc/1200.jpeg";
    expect(schema.safeParse([{ kind: "image", url, caption: "c" }]).success).toBe(true);
    expect(schema.safeParse([{ kind: "document", url, fileName: "a.pdf" }]).success).toBe(true);
    expect(schema.safeParse([{ kind: "image", mediaKey: "wa/2026/10/abcdefgh" }]).success).toBe(
      true,
    );
    expect(
      schema.safeParse([{ kind: "image", mediaKey: "wa/2026/10/abcdefgh", url }]).success,
    ).toBe(false);
    expect(schema.safeParse([{ kind: "image" }]).success).toBe(false);
    expect(schema.safeParse([{ kind: "image", url: "not a url" }]).success).toBe(false);
  });

  it("limits urls to the public media origin when the origin is given", () => {
    const origin = "https://media.example.com";
    const schema = waAgentOutboundFor({ maxReplyChars: 100, maxMessagesPerTurn: 3 }, origin);
    expect(schema.safeParse([{ kind: "image", url: `${origin}/a.jpeg` }]).success).toBe(true);
    for (const url of [
      "https://evil.example.net/a.jpeg",
      "https://media.example.com.evil.net/a.jpeg",
      "https://media.example.com@evil.net/a.jpeg",
      `${origin}/../a.jpeg`,
      `${origin}/a.jpeg?x=1`,
      `${origin}/`,
    ]) {
      expect(schema.safeParse([{ kind: "image", url }]).success).toBe(false);
    }
    // No origin configured: no url is allowed at all.
    const closed = waAgentOutboundFor({ maxReplyChars: 100, maxMessagesPerTurn: 3 }, "");
    expect(closed.safeParse([{ kind: "image", url: `${origin}/a.jpeg` }]).success).toBe(false);
    expect(isMediaOriginUrl(`${origin}/x/y.jpeg`, `${origin}/`)).toBe(true);
    expect(isMediaOriginUrl(`${origin}/x`, "")).toBe(false);
  });

  it("needs one message id per part in an out entry, and a known drop reason in a verdict", () => {
    const parts = [{ kind: "text", text: "a" }];
    expect(
      waAgentOutEntrySchema.safeParse({ conversationId: ID, messageIds: [ID], jid: "j", parts })
        .success,
    ).toBe(true);
    expect(
      waAgentOutEntrySchema.safeParse({ conversationId: ID, messageIds: [ID, ID], jid: "j", parts })
        .success,
    ).toBe(false);
    expect(
      waAgentSentSchema.safeParse({ messageId: ID, status: "dropped", reason: "paused" }).success,
    ).toBe(true);
    expect(
      waAgentSentSchema.safeParse({ messageId: ID, status: "dropped", reason: "because" }).success,
    ).toBe(false);
  });
});
