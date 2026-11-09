import { telegramAdsSettingsSchema } from "@wasfa/shared/telegram-ads";
import { describe, expect, it } from "vitest";

import {
  avoidRepeat,
  campaignExhausted,
  eligibleCandidates,
  inQuietWindow,
  isMedicineCategory,
  limitGate,
  passesProbability,
  preGate,
  quietHoursActive,
  weightedPick,
  type TelegramAdCandidateFacts,
  type TelegramAdChatFacts,
  type TelegramAdCounters,
} from "../src/telegram-bot/telegram-ads-selection.js";

const NOW = new Date("2026-11-09T12:00:00Z"); // 14:00 in Cairo (UTC+2)
const NO_LIMITS = {
  probability: { enabled: false, value: 0.7 },
  maxPerChatPerDay: { enabled: false, value: 3 },
  minGapMinutes: { enabled: false, value: 30 },
};
const settings = (patch: Record<string, unknown> = {}) =>
  telegramAdsSettingsSchema.parse({
    triggers: ["after_rx_done", "after_followup"],
    ...NO_LIMITS,
    ...patch,
  });
const chat: TelegramAdChatFacts = { locale: "ar", linked: true, adsHidden: false };
const idle: TelegramAdCounters = {
  chatToday: 0,
  chatThisWeek: 0,
  gapActive: false,
  globalToday: 0,
};

function candidate(
  id: string,
  over: {
    creative?: Partial<TelegramAdCandidateFacts["creative"]>;
    campaign?: Partial<TelegramAdCandidateFacts["campaign"]>;
  } = {},
): TelegramAdCandidateFacts {
  return {
    creative: {
      id,
      status: "approved",
      category: "general",
      weight: 100,
      startsAt: null,
      endsAt: null,
      targeting: { locales: [], audience: "all", triggers: [] },
      ...over.creative,
    },
    campaign: {
      id: `camp-${id}`,
      status: "active",
      startsAt: null,
      endsAt: null,
      dailyImpressionCap: null,
      totalImpressionCap: null,
      ...over.campaign,
    },
  };
}

type Trigger = "after_rx_done" | "after_followup" | "after_pdf";
const eligible = (
  list: TelegramAdCandidateFacts[],
  counts = new Map<string, { today: number; total: number }>(),
  facts = chat,
  trigger: Trigger = "after_rx_done",
) => eligibleCandidates({ candidates: list, counts, chat: facts, trigger, now: NOW });

describe("gates before the counters", () => {
  const gate = (over: Partial<Parameters<typeof preGate>[0]> = {}) =>
    preGate({
      settings: settings(),
      trigger: "after_rx_done",
      chat,
      adsFree: false,
      now: NOW,
      ...over,
    });

  it("lets an ordinary moment through", () => {
    expect(gate()).toBeNull();
  });

  it("stops on the master switch, an unlisted trigger, a hidden chat and an ad-free plan", () => {
    expect(gate({ settings: settings({ enabled: false }) })).toBe("disabled");
    expect(gate({ trigger: "after_balance" })).toBe("trigger");
    expect(gate({ chat: { ...chat, adsHidden: true } })).toBe("hidden");
    expect(gate({ adsFree: true })).toBe("ads_free");
  });

  it("an empty trigger list shows nothing", () => {
    expect(gate({ settings: settings({ triggers: [] }) })).toBe("trigger");
  });

  it("honours a hidden chat only while the hide feature is on", () => {
    expect(
      gate({ settings: settings({ allowHide: false }), chat: { ...chat, adsHidden: true } }),
    ).toBeNull();
  });
});

describe("quiet hours", () => {
  it("wraps midnight and treats equal bounds as none", () => {
    expect(inQuietWindow(23 * 60 + 30, "23:00", "08:00")).toBe(true);
    expect(inQuietWindow(3 * 60, "23:00", "08:00")).toBe(true);
    expect(inQuietWindow(8 * 60, "23:00", "08:00")).toBe(false);
    expect(inQuietWindow(12 * 60, "23:00", "08:00")).toBe(false);
    expect(inQuietWindow(10 * 60, "09:00", "17:00")).toBe(true);
    expect(inQuietWindow(5, "10:00", "10:00")).toBe(false);
  });

  it("applies only when enabled, in the configured timezone", () => {
    const night = new Date("2026-11-09T22:30:00Z"); // 00:30 in Cairo
    const on = settings({ quietHours: { enabled: true, start: "23:00", end: "08:00" } });
    expect(quietHoursActive(on, night)).toBe(true);
    expect(quietHoursActive(on, NOW)).toBe(false);
    const off = settings({ quietHours: { enabled: false, start: "23:00", end: "08:00" } });
    expect(quietHoursActive(off, night)).toBe(false);
    // The same instant is the afternoon in New York (17:30).
    const ny = settings({
      quietHours: { enabled: true, start: "23:00", end: "08:00", timezone: "America/New_York" },
    });
    expect(quietHoursActive(ny, night)).toBe(false);
  });

  it("blocks through preGate", () => {
    const night = new Date("2026-11-09T22:30:00Z");
    const on = settings({ quietHours: { enabled: true } });
    expect(
      preGate({ settings: on, trigger: "after_rx_done", chat, adsFree: false, now: night }),
    ).toBe("quiet_hours");
  });
});

describe("limits apply only when enabled", () => {
  const big: TelegramAdCounters = {
    chatToday: 1_000,
    chatThisWeek: 1_000,
    gapActive: true,
    globalToday: 1_000_000,
  };

  it("every limit off means unbounded, whatever the counters say", () => {
    expect(limitGate(settings(), big)).toBeNull();
  });

  it("each limit blocks on its own switch", () => {
    const on = (key: string, value: number) => settings({ [key]: { enabled: true, value } });
    expect(limitGate(on("maxPerChatPerDay", 3), { ...idle, chatToday: 3 })).toBe("chat_day");
    expect(limitGate(on("maxPerChatPerDay", 3), { ...idle, chatToday: 2 })).toBeNull();
    expect(limitGate(on("maxPerChatPerWeek", 10), { ...idle, chatThisWeek: 10 })).toBe("chat_week");
    expect(limitGate(on("minGapMinutes", 30), { ...idle, gapActive: true })).toBe("gap");
    expect(limitGate(on("minGapMinutes", 0), { ...idle, gapActive: true })).toBeNull();
    expect(limitGate(on("globalDailyLimit", 5), { ...idle, globalToday: 5 })).toBe("global_day");
  });

  it("a disabled limit ignores its value", () => {
    const off = settings({ maxPerChatPerDay: { enabled: false, value: 1 } });
    expect(limitGate(off, { ...idle, chatToday: 50 })).toBeNull();
  });

  it("probability off passes always; on draws against the rng", () => {
    expect(passesProbability(settings(), () => 0.99)).toBe(true);
    const on = settings({ probability: { enabled: true, value: 0.5 } });
    expect(passesProbability(on, () => 0.49)).toBe(true);
    expect(passesProbability(on, () => 0.5)).toBe(false);
  });
});

describe("eligible creatives", () => {
  it("drops unapproved creatives and the medicine floor, however it is spelled", () => {
    const list = [
      candidate("ok"),
      candidate("draft", { creative: { status: "draft" } }),
      candidate("med", { creative: { category: "medicine" } }),
      candidate("MED", { creative: { category: " Medicine " } }),
    ];
    expect(eligible(list).map((c) => c.creative.id)).toEqual(["ok"]);
    expect(isMedicineCategory("MEDICINE")).toBe(true);
    expect(isMedicineCategory("pharmacy")).toBe(false);
  });

  it("respects the creative and campaign windows and status", () => {
    const past = new Date("2026-11-01T00:00:00Z");
    const future = new Date("2026-12-01T00:00:00Z");
    const list = [
      candidate("live"),
      candidate("notyet", { creative: { startsAt: future } }),
      candidate("over", { creative: { endsAt: past } }),
      candidate("campaign-paused", { campaign: { status: "paused" } }),
      candidate("campaign-future", { campaign: { startsAt: future } }),
      candidate("campaign-over", { campaign: { endsAt: past } }),
    ];
    expect(eligible(list).map((c) => c.creative.id)).toEqual(["live"]);
  });

  it("applies the campaign daily and total impression caps", () => {
    const capped = candidate("a", {
      campaign: { dailyImpressionCap: 10, totalImpressionCap: 100 },
    });
    const counts = (today: number, total: number) =>
      new Map([[capped.campaign.id, { today, total }]]);
    expect(eligible([capped], counts(9, 99))).toHaveLength(1);
    expect(eligible([capped], counts(10, 50))).toHaveLength(0);
    expect(eligible([capped], counts(1, 100))).toHaveLength(0);
    expect(campaignExhausted(capped.campaign, { today: 1, total: 100 })).toBe(true);
    expect(campaignExhausted(capped.campaign, { today: 10, total: 50 })).toBe(false);
    expect(campaignExhausted(candidate("b").campaign, { today: 1e9, total: 1e9 })).toBe(false);
  });

  it("matches targeting by locale, audience and trigger", () => {
    const target = (
      locales: ("ar" | "en")[],
      audience: "all" | "linked" | "unlinked",
      triggers: Trigger[],
    ) => ({ creative: { targeting: { locales, audience, triggers } } });
    const all = [
      candidate("ar", target(["ar"], "all", [])),
      candidate("en", target(["en"], "all", [])),
      candidate("linked", target([], "linked", [])),
      candidate("unlinked", target([], "unlinked", [])),
      candidate("fu", target([], "all", ["after_followup"])),
    ];
    const ids = (facts: TelegramAdChatFacts, trigger: Trigger) =>
      eligible(all, new Map(), facts, trigger).map((c) => c.creative.id);
    expect(ids(chat, "after_rx_done")).toEqual(["ar", "linked"]);
    expect(ids({ ...chat, locale: "en", linked: false }, "after_followup")).toEqual([
      "en",
      "unlinked",
      "fu",
    ]);
  });
});

describe("the draw", () => {
  it("is weighted", () => {
    const a = candidate("a", { creative: { weight: 100 } });
    const b = candidate("b", { creative: { weight: 300 } });
    expect(weightedPick([a, b], () => 0.1)?.creative.id).toBe("a");
    expect(weightedPick([a, b], () => 0.3)?.creative.id).toBe("b");
    expect(weightedPick([a, b], () => 0.99)?.creative.id).toBe("b");
    expect(weightedPick([], () => 0)).toBeNull();
  });

  it("avoids the creative this chat saw last when others exist", () => {
    const a = candidate("a");
    const b = candidate("b");
    expect(avoidRepeat([a, b], "a").map((c) => c.creative.id)).toEqual(["b"]);
    expect(avoidRepeat([a], "a").map((c) => c.creative.id)).toEqual(["a"]);
    expect(avoidRepeat([a, b], null)).toHaveLength(2);
  });
});
