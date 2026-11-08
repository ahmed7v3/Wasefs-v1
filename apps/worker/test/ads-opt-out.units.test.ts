import { describe, expect, it } from "vitest";

import { extractAdsPrefCommand, normalizeAdsKeyword } from "../src/wa-bridge/inbound.js";

const resolver = { getPNForLID: () => Promise.resolve(null) };
const raw = (text: string, remoteJid = "201012345678@s.whatsapp.net") => ({
  key: { id: "m1", remoteJid, fromMe: false },
  message: { conversation: text },
  messageTimestamp: Math.floor(Date.now() / 1000),
});

describe("ads opt-out keywords", () => {
  it.each([
    ["وقف الإعلانات", "off"],
    ["وقف الاعلانات", "off"],
    ["  وقف  الإعلانات. ", "off"],
    ["ايقاف الاعلانات", "off"],
    ["stop ads", "off"],
    ["STOP ADS", "off"],
    ["شغل الإعلانات", "on"],
    ["شغل الاعلانات!", "on"],
    ["تشغيل الاعلانات", "on"],
    ["ads on", "on"],
    ["Ads On", "on"],
  ])("%s is %s", async (text, action) => {
    expect(await extractAdsPrefCommand(raw(text), resolver)).toEqual({
      action,
      digits: "201012345678",
      jid: "201012345678@s.whatsapp.net",
    });
  });

  it("is only a whole-message keyword, never a sentence that contains it", async () => {
    for (const text of [
      "لو سمحت وقف الإعلانات",
      "please stop ads now",
      "الإعلانات",
      "وقف",
      "stop",
      "إيقاف التنبيهات",
    ]) {
      expect(await extractAdsPrefCommand(raw(text), resolver)).toBeNull();
    }
  });

  it("ignores messages from us, and chats that are not 1:1", async () => {
    const own = { ...raw("stop ads"), key: { ...raw("stop ads").key, fromMe: true } };
    expect(await extractAdsPrefCommand(own, resolver)).toBeNull();
    expect(await extractAdsPrefCommand(raw("stop ads", "123-456@g.us"), resolver)).toBeNull();
  });

  it("normalizes diacritics, tatweel and alef forms", () => {
    expect(normalizeAdsKeyword("وَقْف الإعلانات")).toBe("وقف الاعلانات");
    expect(normalizeAdsKeyword("وقـــف الأعلانات؟")).toBe("وقف الاعلانات");
  });
});
