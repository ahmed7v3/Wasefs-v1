import { telegramAdsSettingsSchema } from "@wasfa/shared/telegram-ads";
import { describe, expect, it, vi } from "vitest";

import { signTelegramAdToken } from "../src/telegram-bot/telegram-ad-token.js";
import { TelegramAdsService } from "../src/telegram-bot/telegram-ads.service.js";
import { TelegramApiError, type TelegramApi } from "../src/telegram-bot/telegram-api.client.js";

import type { TelegramAdCandidate } from "@wasfa/db";

const SECRET = "s".repeat(40);
const CHAT = 4242;
const CREATIVE = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a10";
const CAMPAIGN = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a20";
const NOW = new Date("2026-11-09T12:00:00Z");
const logger = { setContext: vi.fn(), warn: vi.fn(), error: vi.fn() };

function candidate(over: Partial<TelegramAdCandidate["creative"]> = {}): TelegramAdCandidate {
  const at = new Date("2026-11-01T00:00:00Z");
  return {
    creative: {
      id: CREATIVE,
      campaignId: CAMPAIGN,
      name: "c",
      status: "approved",
      layout: "card",
      headline: "Headline",
      body: "Body.",
      imageMediaId: null,
      buttons: [{ label: "Go", url: "https://shop.example/x" }],
      buttonsPerRow: 1,
      category: "general",
      weight: 100,
      startsAt: null,
      endsAt: null,
      targeting: { locales: [], audience: "all", triggers: [] },
      createdAt: at,
      updatedAt: at,
      ...over,
    },
    campaign: {
      id: CAMPAIGN,
      name: "camp",
      advertiser: "",
      status: "active",
      startsAt: null,
      endsAt: null,
      dailyImpressionCap: null,
      totalImpressionCap: null,
      notes: "",
      createdAt: at,
      updatedAt: at,
    },
    media: null,
  };
}

function fakeRedis() {
  const store = new Map<string, string>();
  const pipeline = () => {
    const chain = {
      incr: vi.fn((key: string) => {
        store.set(key, String(Number(store.get(key) ?? 0) + 1));
        return chain;
      }),
      expire: vi.fn(() => chain),
      set: vi.fn((key: string, value: string) => {
        store.set(key, value);
        return chain;
      }),
      exec: vi.fn(async () => []),
    };
    return chain;
  };
  return {
    store,
    mget: vi.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    pipeline: vi.fn(pipeline),
  };
}

function build(
  options: {
    settings?: Record<string, unknown>;
    candidates?: TelegramAdCandidate[];
    adsFree?: boolean;
    hidden?: boolean;
    userId?: string | null;
  } = {},
) {
  const redis = fakeRedis();
  const repo = {
    chatFacts: vi.fn(async () => ({
      chatId: CHAT,
      locale: "ar" as const,
      userId: options.userId ?? null,
      adsHidden: options.hidden ?? false,
    })),
    candidates: vi.fn(async () => options.candidates ?? [candidate()]),
    impressionCounts: vi.fn(async () => new Map()),
    endCampaign: vi.fn(async () => undefined),
    recordEvent: vi.fn(async () => undefined),
    eventSince: vi.fn(async () => false),
    lastImpressionTrigger: vi.fn(async () => "after_rx_done" as string | null),
    creativeCampaign: vi.fn(async () => CAMPAIGN as string | null),
    setAdsHidden: vi.fn(async () => undefined),
    buttonTarget: vi.fn(async () => ({
      campaignId: CAMPAIGN,
      buttons: [{ label: "Go", url: "https://shop.example/x" }],
    })),
  };
  const chats = { patchChat: vi.fn(async () => undefined) };
  const adsService = { isAdsFree: vi.fn(async () => options.adsFree ?? false) };
  const settings = {
    get: vi.fn(async () =>
      telegramAdsSettingsSchema.parse({ triggers: ["after_rx_done"], ...options.settings }),
    ),
  };
  const service = new TelegramAdsService(
    repo as never,
    chats as never,
    adsService as never,
    settings as never,
    redis as never,
    {
      BETTER_AUTH_SECRET: SECRET,
      MEDIA_PUBLIC_ORIGIN: undefined,
      WEB_ORIGIN: ["https://wasfa.online"],
    } as never,
    logger as never,
  );
  service.rng = () => 0;
  const api = {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
    sendPhoto: vi.fn(async () => ({ message_id: 1 })),
    answerCallbackQuery: vi.fn(async () => undefined),
    editMessageReplyMarkup: vi.fn(async () => undefined),
  };
  return { service, redis, repo, chats, adsService, api, asApi: api as unknown as TelegramApi };
}

describe("TelegramAdsService delivery", () => {
  it("sends one tracked ad after a delivery and records counters and the impression", async () => {
    const { service, api, asApi, repo, redis } = build();
    await service.sendAfterDelivery(asApi, { chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(api.sendMessage.mock.calls[0]);
    expect(sent).toContain("https://wasfa.online/t/");
    expect(sent).not.toContain("shop.example");
    expect(repo.recordEvent).toHaveBeenCalledWith({
      kind: "impression",
      creativeId: CREATIVE,
      campaignId: CAMPAIGN,
      chatId: CHAT,
      trigger: "after_rx_done",
    });
    expect([...redis.store.keys()].some((key) => key.startsWith("ads:tg:chat:"))).toBe(true);
    expect(redis.store.get("ads:tg:last:4242")).toBe(CREATIVE);
  });

  it("sends nothing when switched off, for an unlisted trigger, a hidden chat or an ad-free plan", async () => {
    const run = async (options: Parameters<typeof build>[0], trigger = "after_rx_done" as const) => {
      const built = build(options);
      await built.service.sendAfterDelivery(
        built.asApi,
        { chatId: CHAT, userId: "u" },
        "ar",
        trigger,
        NOW,
      );
      return built;
    };
    expect((await run({ settings: { enabled: false } })).api.sendMessage).not.toHaveBeenCalled();
    expect((await run({}, "after_rx_done")).api.sendMessage).toHaveBeenCalled();
    const unlisted = build();
    await unlisted.service.sendAfterDelivery(
      unlisted.asApi,
      { chatId: CHAT, userId: null },
      "ar",
      "after_balance",
      NOW,
    );
    expect(unlisted.api.sendMessage).not.toHaveBeenCalled();
    expect((await run({ hidden: true })).api.sendMessage).not.toHaveBeenCalled();
    const free = await run({ adsFree: true });
    expect(free.api.sendMessage).not.toHaveBeenCalled();
    expect(free.repo.candidates).not.toHaveBeenCalled();
  });

  it("never serves a medicine creative", async () => {
    const { service, api, asApi } = build({ candidates: [candidate({ category: "medicine" })] });
    await service.sendAfterDelivery(asApi, { chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("the per-chat daily limit applies only when enabled", async () => {
    const limited = build({ settings: { maxPerChatPerDay: { enabled: true, value: 1 } } });
    const args = [{ chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW] as const;
    await limited.service.sendAfterDelivery(limited.asApi, ...args);
    await limited.service.sendAfterDelivery(limited.asApi, ...args);
    expect(limited.api.sendMessage).toHaveBeenCalledTimes(1);

    const free = build({ settings: { maxPerChatPerDay: { enabled: false, value: 1 } } });
    await free.service.sendAfterDelivery(free.asApi, ...args);
    await free.service.sendAfterDelivery(free.asApi, ...args);
    await free.service.sendAfterDelivery(free.asApi, ...args);
    expect(free.api.sendMessage).toHaveBeenCalledTimes(3);
  });

  it("swallows failures, and marks a chat that blocked the bot", async () => {
    const { service, api, asApi, chats } = build();
    api.sendMessage.mockRejectedValueOnce(new TelegramApiError(403, "blocked"));
    await expect(
      service.sendAfterDelivery(asApi, { chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW),
    ).resolves.toBeUndefined();
    expect(chats.patchChat).toHaveBeenCalledWith(CHAT, { blocked: true });
    api.sendMessage.mockRejectedValueOnce(new Error("boom"));
    await expect(
      service.sendAfterDelivery(asApi, { chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW),
    ).resolves.toBeUndefined();
  });

  it("a hero without an image goes out as a card message", async () => {
    const { service, api, asApi } = build({ candidates: [candidate({ layout: "hero" })] });
    await service.sendAfterDelivery(asApi, { chatId: CHAT, userId: null }, "ar", "after_rx_done", NOW);
    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("TelegramAdsService callbacks", () => {
  const press = (data: string, rows?: never) => ({
    chatId: CHAT,
    locale: "ar" as const,
    queryId: "q1",
    messageId: 77,
    data,
    rows,
  });

  it("recognises the ad buttons only", () => {
    expect(TelegramAdsService.isAdCallback(`adr:${CREATIVE}`)).toBe(true);
    expect(TelegramAdsService.isAdCallback(`adh:${CREATIVE}`)).toBe(true);
    expect(TelegramAdsService.isAdCallback("menu:help")).toBe(false);
  });

  it("records a reaction once, answers with thanks and marks the button done", async () => {
    const { service, api, asApi, repo } = build();
    const rows = [[{ text: "👍 مهتم", callback_data: `adr:${CREATIVE}` }]];
    await service.onCallback(asApi, { ...press(`adr:${CREATIVE}`), rows } as never);
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("q1", "شكراً! 👍");
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "reaction", creativeId: CREATIVE, chatId: CHAT }),
    );
    expect(JSON.stringify(api.editMessageReplyMarkup.mock.calls[0])).toContain("✅ تم");
  });

  it("a repeat press within a day records nothing new but still answers", async () => {
    const { service, api, asApi, repo } = build();
    repo.eventSince.mockResolvedValue(true);
    await service.onCallback(asApi, press(`adr:${CREATIVE}`) as never);
    expect(repo.recordEvent).not.toHaveBeenCalled();
    expect(api.answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  it("hide records once, hides the chat, answers and removes the keyboard", async () => {
    const { service, api, asApi, repo } = build();
    await service.onCallback(asApi, press(`adh:${CREATIVE}`) as never);
    expect(api.answerCallbackQuery).toHaveBeenCalledWith("q1", "تم إخفاء الإعلانات");
    expect(repo.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ kind: "hide" }));
    expect(repo.setAdsHidden).toHaveBeenCalledWith(CHAT, true);
    expect(api.editMessageReplyMarkup).toHaveBeenCalledWith(CHAT, 77, { inline_keyboard: [] });
  });

  it("hiding still works on a repeat press, without a second event", async () => {
    const { service, repo, asApi } = build();
    repo.eventSince.mockResolvedValue(true);
    await service.onCallback(asApi, press(`adh:${CREATIVE}`) as never);
    expect(repo.recordEvent).not.toHaveBeenCalled();
    expect(repo.setAdsHidden).toHaveBeenCalledWith(CHAT, true);
  });

  it("an ad that never had an impression (a test send) records no event", async () => {
    const { service, repo, asApi } = build();
    repo.lastImpressionTrigger.mockResolvedValue(null);
    await service.onCallback(asApi, press(`adr:${CREATIVE}`) as never);
    expect(repo.recordEvent).not.toHaveBeenCalled();
  });

  it("a malformed creative id only answers the callback", async () => {
    const { service, repo, api, asApi } = build();
    await service.onCallback(asApi, press("adr:nope") as never);
    expect(api.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(repo.creativeCampaign).not.toHaveBeenCalled();
  });

  it("/ads_on re-enables a hidden chat and reports no change otherwise", async () => {
    const hidden = build({ hidden: true });
    expect(await hidden.service.enableForChat(CHAT)).toBe(true);
    expect(hidden.repo.setAdsHidden).toHaveBeenCalledWith(CHAT, false);
    const shown = build({ hidden: false });
    expect(await shown.service.enableForChat(CHAT)).toBe(false);
  });
});

describe("TelegramAdsService tracked clicks", () => {
  const token = (button = 0) =>
    signTelegramAdToken(
      SECRET,
      { creativeId: CREATIVE, chatId: CHAT, trigger: "after_rx_done", button },
      new Date(),
    );

  it("returns the stored button URL and counts one click per token per minute", async () => {
    const { service, repo } = build();
    const t = token();
    expect(await service.trackClick(t)).toBe("https://shop.example/x");
    expect(await service.trackClick(t)).toBe("https://shop.example/x");
    expect(repo.recordEvent).toHaveBeenCalledTimes(1);
    expect(repo.recordEvent).toHaveBeenCalledWith({
      kind: "click",
      creativeId: CREATIVE,
      campaignId: CAMPAIGN,
      chatId: CHAT,
      trigger: "after_rx_done",
    });
  });

  it("answers the web origin for a forged, expired or dangling token", async () => {
    const { service, repo } = build();
    expect(await service.trackClick("garbage")).toBe("https://wasfa.online");
    const expired = signTelegramAdToken(
      SECRET,
      { creativeId: CREATIVE, chatId: CHAT, trigger: "after_rx_done", button: 0 },
      new Date("2020-01-01T00:00:00Z"),
    );
    expect(await service.trackClick(expired)).toBe("https://wasfa.online");
    expect(await service.trackClick(token(3))).toBe("https://wasfa.online");
    expect(repo.recordEvent).not.toHaveBeenCalled();
  });
});
