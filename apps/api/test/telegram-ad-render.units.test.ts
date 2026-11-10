import { describe, expect, it } from "vitest";

import { pickTelegramAdVariant } from "../src/telegram-bot/telegram-ad-image.js";
import {
  CALLBACK_DATA_MAX_BYTES,
  CAPTION_MAX,
  firstSentence,
  hideData,
  markReacted,
  reactionData,
  renderTelegramAd,
  type AdCreativeContent,
  type RenderInput,
} from "../src/telegram-bot/telegram-ad-render.js";
import {
  TELEGRAM_AD_TOKEN_TTL_SECONDS,
  signTelegramAdToken,
  verifyTelegramAdToken,
} from "../src/telegram-bot/telegram-ad-token.js";
import { withRates } from "../src/telegram-bot/telegram-ads-stats.js";

import type { InlineButton } from "../src/telegram-bot/telegram-types.js";

const ID = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a10";
const creative = (over: Partial<AdCreativeContent> = {}): AdCreativeContent => ({
  layout: "hero",
  headline: "خصم 20% على التوصيل",
  body: "اطلب دواءك الآن. التوصيل خلال ساعة.",
  buttons: [
    { label: "اطلب الآن", url: "https://shop.example/a" },
    { label: "المزيد", url: "https://shop.example/b" },
  ],
  buttonsPerRow: 1,
  ...over,
});
const input = (over: Partial<RenderInput> = {}): RenderInput => ({
  creativeId: ID,
  locale: "ar",
  hasImage: true,
  links: ["https://wasfa.online/t/x?b=0", "https://wasfa.online/t/y?b=1"],
  allowHide: true,
  allowReactions: true,
  ...over,
});
const rows = (markup: ReturnType<typeof renderTelegramAd>["keyboard"]) =>
  markup !== undefined && "inline_keyboard" in markup ? markup.inline_keyboard : [];

describe("layouts", () => {
  it("hero: a photo with label, bold headline and body as the caption", () => {
    const ad = renderTelegramAd(creative(), input());
    expect(ad.kind).toBe("photo");
    expect(ad.text).toBe(
      "📢 <i>إعلان</i>\n\n<b>خصم 20% على التوصيل</b>\n\nاطلب دواءك الآن. التوصيل خلال ساعة.",
    );
  });

  it("hero without a usable image falls back to a card", () => {
    const ad = renderTelegramAd(creative(), input({ hasImage: false }));
    expect(ad.kind).toBe("message");
    expect(ad.text).toContain("┈┈┈");
    expect(ad.text).toContain("<b>خصم 20% على التوصيل</b>");
  });

  it("card: a message with a divider and no image", () => {
    const ad = renderTelegramAd(creative({ layout: "card" }), input({ hasImage: true }));
    expect(ad.kind).toBe("message");
    expect(ad.text.split("\n")[1]).toMatch(/^┈+$/);
  });

  it("compact: one line with the first sentence of the body", () => {
    const ad = renderTelegramAd(creative({ layout: "compact" }), input());
    expect(ad.kind).toBe("message");
    expect(ad.text).toBe("📢 <i>إعلان</i> · <b>خصم 20% على التوصيل</b> — اطلب دواءك الآن.");
    expect(ad.text.includes("\n")).toBe(false);
    expect(firstSentence("")).toBe("");
    expect(firstSentence("No stop here")).toBe("No stop here");
  });

  it("labels the ad by the chat language", () => {
    expect(renderTelegramAd(creative(), input({ locale: "en" })).text.startsWith("📢 <i>Ad</i>")).toBe(
      true,
    );
  });

  it("omits an empty body without stray blank lines", () => {
    const ad = renderTelegramAd(creative({ body: "" }), input());
    expect(ad.text.endsWith("</b>")).toBe(true);
  });
});

describe("escaping and limits", () => {
  it("escapes every admin text", () => {
    const ad = renderTelegramAd(
      creative({ headline: "<script>&", body: "a < b > c & d" }),
      input(),
    );
    expect(ad.text).toContain("<b>&lt;script&gt;&amp;</b>");
    expect(ad.text).toContain("a &lt; b &gt; c &amp; d");
    expect(ad.text).not.toContain("<script>");
  });

  it("keeps a hero caption within Telegram's limit even when escaping grows the text", () => {
    const ad = renderTelegramAd(creative({ body: "<&>".repeat(400) }), input());
    expect(ad.text.length).toBeLessThanOrEqual(CAPTION_MAX);
    expect(ad.kind).toBe("photo");
  });
});

describe("keyboard", () => {
  it("puts the call to action first, one button per row by default, then the engagement row", () => {
    const keyboard = rows(renderTelegramAd(creative(), input()).keyboard);
    expect(keyboard).toHaveLength(3);
    expect(keyboard[0]).toEqual([{ text: "👉 اطلب الآن", url: "https://wasfa.online/t/x?b=0" }]);
    expect(keyboard[1]).toEqual([{ text: "المزيد", url: "https://wasfa.online/t/y?b=1" }]);
    expect(keyboard[2]).toEqual([
      { text: "👍 مهتم", callback_data: `adr:${ID}` },
      { text: "🙈 إخفاء الإعلانات", callback_data: `adh:${ID}` },
    ]);
  });

  it("two buttons per row; English engagement texts", () => {
    const keyboard = rows(
      renderTelegramAd(creative({ buttonsPerRow: 2 }), input({ locale: "en" })).keyboard,
    );
    expect(keyboard[0]).toHaveLength(2);
    expect(keyboard[1]?.map((button) => button.text)).toEqual(["👍 Interested", "🙈 Hide ads"]);
  });

  it("drops the engagement buttons the settings switch off, and the whole keyboard when empty", () => {
    const noHide = rows(renderTelegramAd(creative(), input({ allowHide: false })).keyboard);
    expect(noHide.at(-1)?.map((button) => button.text)).toEqual(["👍 مهتم"]);
    const bare = renderTelegramAd(
      creative({ buttons: [] }),
      input({ allowHide: false, allowReactions: false }),
    );
    expect(bare.keyboard).toBeUndefined();
  });

  it("keeps callback data under Telegram's 64 bytes", () => {
    expect(Buffer.byteLength(reactionData(ID))).toBeLessThan(CALLBACK_DATA_MAX_BYTES);
    expect(Buffer.byteLength(hideData(ID))).toBeLessThan(CALLBACK_DATA_MAX_BYTES);
  });

  it("marks the interest button as done and leaves the rest", () => {
    const original = rows(renderTelegramAd(creative(), input()).keyboard) as InlineButton[][];
    const after = markReacted(original, "ar");
    const flat = "inline_keyboard" in after ? after.inline_keyboard.flat() : [];
    expect(flat.map((button) => button.text)).toContain("✅ تم");
    expect(flat.map((button) => button.text)).not.toContain("👍 مهتم");
    expect(flat.map((button) => button.text)).toContain("🙈 إخفاء الإعلانات");
  });
});

describe("tracked token", () => {
  const SECRET = "s".repeat(40);
  const NOW = new Date("2026-11-09T12:00:00Z");
  const claims = { creativeId: ID, chatId: 987654321, trigger: "after_followup", button: 1 } as const;

  it("round-trips and expires after 30 days", () => {
    const token = signTelegramAdToken(SECRET, claims, NOW);
    expect(verifyTelegramAdToken(SECRET, token, NOW)).toEqual(claims);
    const justBefore = new Date(NOW.getTime() + (TELEGRAM_AD_TOKEN_TTL_SECONDS - 1) * 1000);
    const atExpiry = new Date(NOW.getTime() + TELEGRAM_AD_TOKEN_TTL_SECONDS * 1000);
    expect(verifyTelegramAdToken(SECRET, token, justBefore)).not.toBeNull();
    expect(verifyTelegramAdToken(SECRET, token, atExpiry)).toBeNull();
  });

  it("rejects another secret, a tampered payload and hostile input", () => {
    const token = signTelegramAdToken(SECRET, claims, NOW);
    expect(verifyTelegramAdToken("t".repeat(40), token, NOW)).toBeNull();
    const text = Buffer.from(token, "base64url").toString("utf8");
    const forged = Buffer.from(text.replace("987654321", "111111111")).toString("base64url");
    expect(verifyTelegramAdToken(SECRET, forged, NOW)).toBeNull();
    for (const bad of [undefined, "", "x".repeat(500), "not-base64!!", "YQ"]) {
      expect(verifyTelegramAdToken(SECRET, bad, NOW)).toBeNull();
    }
  });

  it("carries only creative, chat, trigger and button", () => {
    const token = signTelegramAdToken(SECRET, claims, NOW);
    expect(Buffer.from(token, "base64url").toString("utf8").split(".")).toHaveLength(6);
  });
});

describe("image variant", () => {
  const media = {
    status: "ready",
    variants: [
      { format: "avif", width: 1600, key: "media/h/1600.avif" },
      { format: "jpeg", width: 640, key: "media/h/640.jpg" },
      { format: "jpeg", width: 1280, key: "media/h/1280.jpg" },
      { format: "jpeg", width: 1920, key: "media/h/1920.jpg" },
      { format: "webp", width: 1280, key: "media/h/1280.webp" },
    ],
  } as const;

  it("prefers the smallest JPEG at least 1280 wide, never AVIF", () => {
    expect(pickTelegramAdVariant(media, "https://m.example/")?.url).toBe(
      "https://m.example/media/h/1280.jpg",
    );
  });

  it("falls back to WebP, then to the widest, and to null when not ready", () => {
    const webpOnly = { status: "ready", variants: [media.variants[4]] } as const;
    expect(pickTelegramAdVariant(webpOnly, "https://m.example")?.format).toBe("webp");
    const small = { status: "ready", variants: [media.variants[1]] } as const;
    expect(pickTelegramAdVariant(small, "https://m.example")?.key).toBe("media/h/640.jpg");
    expect(pickTelegramAdVariant({ ...media, status: "processing" }, "https://m.example")).toBeNull();
    expect(pickTelegramAdVariant(media, undefined)).toBeNull();
    expect(pickTelegramAdVariant(null, "https://m.example")).toBeNull();
  });
});

describe("stats math", () => {
  it("computes ctr and engagement from the counts", () => {
    const rates = withRates({ impressions: 200, clicks: 10, reactions: 30, hides: 2, reach: 150 });
    expect(rates.ctr).toBeCloseTo(0.05);
    expect(rates.engagementRate).toBeCloseTo(0.2);
    expect(rates.reach).toBe(150);
  });

  it("is zero, not NaN, with no impressions", () => {
    const rates = withRates({ impressions: 0, clicks: 3, reactions: 1, hides: 0, reach: 0 });
    expect(rates.ctr).toBe(0);
    expect(rates.engagementRate).toBe(0);
  });
});
