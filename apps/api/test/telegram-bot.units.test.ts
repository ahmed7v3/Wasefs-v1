import { AppError, ErrorCode } from "@wasfa/shared/errors";
import { describe, expect, it, vi } from "vitest";

import { TelegramAdsService } from "../src/telegram-bot/telegram-ads.service.js";
import { TelegramAnalysisService } from "../src/telegram-bot/telegram-analysis.service.js";
import { TelegramBotService, profileOf } from "../src/telegram-bot/telegram-bot.service.js";
import {
  callback,
  parseCallback,
  confirmUnlink,
  historyKeyboard,
  mainMenu,
  resultKeyboard,
} from "../src/telegram-bot/telegram-keyboards.js";
import { phoneFromContact } from "../src/telegram-bot/telegram-link.js";
import { CHAT_RATE_MAX, chatRateVerdict } from "../src/telegram-bot/telegram-rate-limit.js";
import {
  TELEGRAM_MAX_CHARS,
  formatAnalysis,
  splitMessage,
} from "../src/telegram-bot/telegram-render.js";
import {
  telegramWebhookSecret,
  webhookSecretMatches,
} from "../src/telegram-bot/telegram-secret.js";

import type { TelegramApi } from "../src/telegram-bot/telegram-api.client.js";
import type {
  TelegramMessage,
  TelegramUpdate,
  ReplyMarkup,
} from "../src/telegram-bot/telegram-types.js";
import type { RxResult } from "@wasfa/shared/schemas/rx";

const RX_ID = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a10";
const USER_ID = "01939c3a-6e6b-7d2e-8a41-0d2f5c3b9a11";

/** The few Redis commands the bot uses, on a map. */
function fakeRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    store,
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    incr: vi.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: vi.fn(async () => 1),
    multi: vi.fn(() => ({
      incr: () => ({ expire: () => ({ exec: async () => [] }) }),
    })),
  };
}

function fakeApi() {
  return {
    sendMessage: vi.fn(async () => ({ message_id: 7 })),
    editMessageText: vi.fn<TelegramApi["editMessageText"]>(async () => undefined),
    answerCallbackQuery: vi.fn(async () => undefined),
    sendChatAction: vi.fn(async () => undefined),
    downloadFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}
const asApi = (api: ReturnType<typeof fakeApi>) => api as unknown as TelegramApi;

const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const result = (names: string[]): RxResult =>
  ({
    schemaVersion: 1,
    items: names.map((name) => ({
      rawText: name,
      name,
      matchedDrugId: null,
      matchScore: null,
      activeIngredients: [],
      strength: "500mg",
      form: "tablet",
      dose: "1 tablet",
      frequency: "3 times daily",
      duration: "5 days",
      route: null,
      notes: null,
      confidence: 0.9,
      badge: "medium",
      verified: "confirmed",
      box_2d: null,
      page: 0,
    })),
    date: null,
    prescriberLegible: true,
    findings: [],
    unreadableRegions: [],
  }) as unknown as RxResult;

describe("webhook secret", () => {
  const key = Buffer.alloc(32, 7);

  it("is the first 48 hex characters of HMAC-SHA256(key, telegram-webhook), stable per key", () => {
    const secret = telegramWebhookSecret(key);
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
    expect(telegramWebhookSecret(key)).toBe(secret);
    expect(telegramWebhookSecret(Buffer.alloc(32, 8))).not.toBe(secret);
  });

  it("accepts only the exact header", () => {
    const secret = telegramWebhookSecret(key);
    expect(webhookSecretMatches(secret, secret)).toBe(true);
    expect(webhookSecretMatches(`${secret}x`, secret)).toBe(false);
    expect(webhookSecretMatches(secret.slice(1), secret)).toBe(false);
    expect(webhookSecretMatches("a".repeat(48), secret)).toBe(false);
    expect(webhookSecretMatches(undefined, secret)).toBe(false);
    expect(webhookSecretMatches([secret], secret)).toBe(false);
  });
});

describe("contact linking guard", () => {
  const message = (patch: Partial<TelegramMessage>): TelegramMessage => ({
    message_id: 1,
    chat: { id: 5, type: "private" },
    from: { id: 5 },
    contact: { phone_number: "201001234567", user_id: 5 },
    ...patch,
  });

  it("links the sender's own number and normalises it to E.164", () => {
    expect(phoneFromContact(message({}))).toEqual({ ok: true, phone: "+201001234567" });
    expect(
      phoneFromContact(message({ contact: { phone_number: "+20 100 123 4567", user_id: 5 } })),
    ).toEqual({ ok: true, phone: "+201001234567" });
  });

  it("refuses a contact whose user_id is not the sender (forwarded or typed card)", () => {
    expect(
      phoneFromContact(message({ contact: { phone_number: "201001234567", user_id: 9 } })),
    ).toEqual({
      ok: false,
      reason: "not_own_contact",
    });
    expect(phoneFromContact(message({ contact: { phone_number: "201001234567" } }))).toEqual({
      ok: false,
      reason: "not_own_contact",
    });
  });

  it("refuses groups and unreadable numbers", () => {
    expect(phoneFromContact(message({ chat: { id: 5, type: "group" } }))).toEqual({
      ok: false,
      reason: "not_private",
    });
    expect(phoneFromContact(message({ contact: { phone_number: "12", user_id: 5 } }))).toEqual({
      ok: false,
      reason: "invalid_phone",
    });
  });
});

describe("message splitting", () => {
  it("never exceeds 4096 characters and loses no words", () => {
    const text = Array.from({ length: 900 }, (_, i) => `word${String(i)}`).join(" ");
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(parts.join(" ").split(/\s+/)).toEqual(text.split(/\s+/));
  });

  it("hard-cuts a text without any break and prefers paragraph breaks", () => {
    for (const part of splitMessage("x".repeat(10_000))) {
      expect(part.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    }
    const paragraphs = `${"a".repeat(3_000)}\n\n${"b".repeat(3_000)}`;
    expect(splitMessage(paragraphs)).toEqual(["a".repeat(3_000), "b".repeat(3_000)]);
  });

  it("splits a long analysis into whole blocks, the disclaimer last", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Medicine${String(i)}`);
    const parts = formatAnalysis(result(names), "ar");
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(parts.join("\n")).toContain("Medicine39");
    expect(parts.at(-1)).toContain("⚕️");
  });

  it("escapes HTML coming from the reading", () => {
    const [text] = formatAnalysis(result(["A<b>&C"]), "en");
    expect(text).toContain("A&lt;b&gt;&amp;C");
  });
});

describe("keyboards", () => {
  const buttons = (markup: ReplyMarkup) =>
    "inline_keyboard" in markup ? markup.inline_keyboard.flat() : [];

  it("keeps every callback under 64 bytes and round-trips verb and argument", () => {
    const markups = [
      mainMenu("ar", null),
      resultKeyboard("ar", RX_ID, "https://wasfa.online/analyze/x"),
      historyKeyboard([{ id: RX_ID, label: "x" }]),
      confirmUnlink("en"),
    ];
    for (const markup of markups) {
      for (const each of buttons(markup)) {
        if ("callback_data" in each) {
          expect(Buffer.byteLength(each.callback_data)).toBeLessThanOrEqual(64);
        }
      }
    }
    expect(parseCallback(callback("rx", RX_ID))).toEqual({ verb: "rx", arg: RX_ID });
    expect(parseCallback("menu:new")).toEqual({ verb: "menu", arg: "new" });
    expect(() => callback("rx", "x".repeat(70))).toThrow();
  });

  it("main menu holds the eight actions; support is a URL when a username is set", () => {
    expect(buttons(mainMenu("ar", null))).toHaveLength(8);
    const support = buttons(mainMenu("ar", "wasfa_help")).at(-1);
    expect(support && "url" in support ? support.url : null).toBe("https://t.me/wasfa_help");
  });
});

describe("chat rate limit", () => {
  it("allows 30 per window, warns once, then drops", async () => {
    const redis = fakeRedis();
    const verdicts: string[] = [];
    for (let i = 0; i < CHAT_RATE_MAX + 3; i += 1) {
      verdicts.push(await chatRateVerdict(redis, 42, 1_000_000));
    }
    expect(verdicts.slice(0, CHAT_RATE_MAX).every((verdict) => verdict === "ok")).toBe(true);
    expect(verdicts.slice(CHAT_RATE_MAX)).toEqual(["warn", "drop", "drop"]);
    // A new window starts clean.
    expect(await chatRateVerdict(redis, 42, 1_000_000 + 601_000)).toBe("ok");
  });
});

describe("TelegramBotService", () => {
  function setup(options: { linked?: boolean; enabled?: boolean } = {}) {
    const api = fakeApi();
    const redis = fakeRedis();
    const analysis = { reopen: vi.fn(), rerun: vi.fn(), analyze: vi.fn() };
    const chat = {
      chatId: 5,
      userId: options.linked === false ? null : USER_ID,
      locale: "ar" as const,
      contextResetAt: null,
      lastRxId: null,
      blocked: false,
    };
    const repo = {
      chat: vi.fn(async () => chat),
      patchChat: vi.fn(async () => undefined),
      user: vi.fn(async () => ({
        id: USER_ID,
        name: "Sara Ali",
        email: "s@example.com",
        emailVerified: true,
        phoneVerified: true,
        status: "active",
      })),
      userIdByPhone: vi.fn(async () => null),
    };
    const ads = { sendAfterDelivery: vi.fn() };
    const service = new TelegramBotService(
      { get: vi.fn(async () => "123456:token") } as never,
      { bind: () => asApi(api) } as never,
      repo as never,
      {
        get: vi.fn(async () => ({
          enabled: options.enabled ?? true,
          welcomeAr: "",
          welcomeEn: "",
          supportUsername: "",
        })),
      } as never,
      analysis as never,
      { answer: vi.fn() } as never,
      ads as never,
      {} as never,
      {} as never,
      redis as never,
      { WEB_ORIGIN: ["https://wasfa.online"] } as never,
      logger as never,
    );
    return { service, api, redis, analysis, repo, ads };
  }

  const callbackUpdate = (data: string, id = 1): TelegramUpdate => ({
    update_id: id,
    callback_query: {
      id: "cb1",
      from: { id: 5 },
      data,
      message: { message_id: 3, chat: { id: 5, type: "private" } },
    },
  });

  it("drops a repeated update_id and schedules a new one once", async () => {
    const { service } = setup();
    const jobs: (() => Promise<void>)[] = [];
    service.schedule = (job) => jobs.push(job);
    expect(await service.accept({ update_id: 900 })).toBe(true);
    expect(await service.accept({ update_id: 900 })).toBe(false);
    expect(await service.accept({ update_id: 901 })).toBe(true);
    expect(jobs).toHaveLength(2);
  });

  it("opens an analysis only for a linked chat and a well-formed id", async () => {
    const linked = setup();
    await linked.service.process(callbackUpdate(`rx:${RX_ID}`));
    expect(linked.analysis.reopen).toHaveBeenCalledWith(expect.anything(), RX_ID);
    expect(linked.api.answerCallbackQuery).toHaveBeenCalledWith("cb1");

    const malformed = setup();
    await malformed.service.process(callbackUpdate("rx:not-a-uuid"));
    expect(malformed.analysis.reopen).not.toHaveBeenCalled();

    const guest = setup({ linked: false });
    await guest.service.process(callbackUpdate(`rx:${RX_ID}`));
    expect(guest.analysis.reopen).not.toHaveBeenCalled();
    // A friendly gate with the contact button, never an error.
    expect(JSON.stringify(guest.api.sendMessage.mock.calls)).toContain("request_contact");
  });

  it("answers with the maintenance message while the bot is switched off", async () => {
    const { service, api, analysis } = setup({ enabled: false });
    await service.process({
      update_id: 5,
      message: { message_id: 1, chat: { id: 5, type: "private" }, from: { id: 5 }, text: "/start" },
    });
    expect(analysis.analyze).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("refuses to link a contact that is not the sender's own", async () => {
    const { service, repo } = setup({ linked: false });
    await service.process({
      update_id: 6,
      message: {
        message_id: 1,
        chat: { id: 5, type: "private" },
        from: { id: 5 },
        contact: { phone_number: "201001234567", user_id: 99 },
      },
    });
    expect(repo.userIdByPhone).not.toHaveBeenCalled();
    expect(repo.patchChat).not.toHaveBeenCalledWith(
      5,
      expect.objectContaining({ userId: expect.anything() }),
    );
  });
});

describe("TelegramAnalysisService", () => {
  function setup() {
    const api = fakeApi();
    const redis = fakeRedis();
    const files = {
      importObject: vi.fn(async () => "file-1"),
      awaitProcessed: vi.fn(async () => "processed"),
    };
    const rx = { create: vi.fn(), get: vi.fn() };
    const credits = { forUser: vi.fn(async () => ({ wallet: { balance: 3 } })) };
    const settings = { get: vi.fn(async () => ({ creditsPerPage: 5 })) };
    const storage = { put: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) };
    const repo = { patchChat: vi.fn(async () => undefined) };
    const ads = { sendAfterDelivery: vi.fn(async () => undefined) };
    const service = new TelegramAnalysisService(
      files as never,
      rx as never,
      credits as never,
      settings as never,
      storage as never,
      repo as never,
      redis as never,
      logger as never,
      ads as never,
    );
    service.timing.sleep = async () => undefined;
    const ctx = {
      tg: asApi(api),
      chatId: 5,
      user: { id: USER_ID } as never,
      locale: "ar" as const,
      webOrigin: "https://wasfa.online",
    };
    const photo = { fileId: "f", uniqueId: "u1", mime: "image/jpeg" as const, bytes: 3 };
    return { service, api, redis, files, rx, repo, storage, ctx, photo, ads };
  }

  it("imports the photo, polls, edits the progress message and sends the formatted result", async () => {
    const { service, api, files, rx, repo, storage, ctx, photo, ads } = setup();
    rx.create.mockResolvedValue({ id: RX_ID, nearDuplicate: null });
    rx.get
      .mockResolvedValueOnce({ id: RX_ID, status: "processing" })
      .mockResolvedValueOnce({ id: RX_ID, status: "verifying" })
      .mockResolvedValueOnce({ id: RX_ID, status: "done", result: result(["Panadol"]), files: [] });

    await service.analyze(ctx, [photo]);

    expect(rx.create).toHaveBeenCalledTimes(1);
    expect(rx.create).toHaveBeenCalledWith(ctx.user, { fileIds: ["file-1"], mode: "balanced" });
    expect(files.importObject).toHaveBeenCalledWith(
      { id: USER_ID, orgIds: [] },
      expect.objectContaining({ purpose: "rx_page", mime: "image/jpeg", bytes: 3 }),
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
    // Progress message edited through the stages, ending ready.
    const edits = api.editMessageText.mock.calls.map((call) => call[2]);
    expect(edits.at(-1)).toContain("جاهز");
    expect(edits.length).toBeGreaterThanOrEqual(3);
    const sent = api.sendMessage.mock.calls as unknown as [
      number,
      string,
      { replyMarkup?: unknown }?,
    ][];
    const resultMessage = sent.at(-1);
    expect(resultMessage?.[1]).toContain("Panadol");
    expect(JSON.stringify(resultMessage?.[2])).toContain(`rerun:${RX_ID}`);
    expect(repo.patchChat).toHaveBeenCalledWith(5, expect.objectContaining({ lastRxId: RX_ID }));
    // The ad is asked for after the result went out, never before.
    expect(ads.sendAfterDelivery).toHaveBeenCalledTimes(1);
  });

  it("shows price, balance and a top-up button when credits are short, and allows a retry", async () => {
    const { service, api, redis, rx, ctx, photo } = setup();
    rx.create.mockRejectedValue(
      new AppError(ErrorCode.QUOTA_EXCEEDED, { details: { reason: "insufficient_credits" } }),
    );

    await service.analyze(ctx, [photo]);

    const last = api.sendMessage.mock.calls.at(-1) as unknown as [number, string, unknown];
    expect(last[1]).toContain("5");
    expect(last[1]).toContain("3");
    expect(JSON.stringify(last[2])).toContain("https://wasfa.online/pricing");
    // Nothing started, so the same photo may be sent again after topping up.
    expect(redis.store.has("tg:rx:5:u1")).toBe(false);
  });

  it("never charges twice for the same photos: a second send re-shows the finished result", async () => {
    const { service, api, rx, ctx, photo } = setup();
    rx.create.mockResolvedValue({ id: RX_ID, nearDuplicate: null });
    rx.get.mockResolvedValue({ id: RX_ID, status: "done", result: result(["Panadol"]), files: [] });

    await service.analyze(ctx, [photo]);
    await service.analyze(ctx, [photo]);

    expect(rx.create).toHaveBeenCalledTimes(1);
    expect(api.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not open an analysis the rx service does not find for this user", async () => {
    const { service, api, rx, repo, ctx } = setup();
    rx.get.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND));
    await service.reopen(ctx, RX_ID);
    expect(repo.patchChat).not.toHaveBeenCalled();
    const text = (api.sendMessage.mock.calls.at(-1) as unknown as [number, string])[1];
    expect(text).toContain("لم أجد");
  });

  it("offers a retry button when the analysis fails and does not remember it as done", async () => {
    const { service, api, redis, rx, ctx, photo } = setup();
    rx.create.mockResolvedValue({ id: RX_ID, nearDuplicate: null });
    rx.get.mockResolvedValue({ id: RX_ID, status: "refunded", result: null, files: [] });
    await service.analyze(ctx, [photo]);
    expect(JSON.stringify(api.editMessageText.mock.calls.at(-1))).toContain(`rerun:${RX_ID}`);
    expect(redis.store.has("tg:rx:5:u1")).toBe(false);
  });
});

describe("profile capture", () => {
  const from = {
    id: 5,
    username: "sara",
    first_name: "Sara",
    last_name: "Ali",
    language_code: "ar",
  };
  const private5 = { id: 5, type: "private" };

  function build(chatPatch: Record<string, unknown> = {}) {
    const api = fakeApi();
    const chat = {
      chatId: 5,
      userId: null,
      locale: "ar" as const,
      contextResetAt: null,
      lastRxId: null,
      blocked: false,
      startedAt: null,
      ...chatPatch,
    };
    const repo = {
      chat: vi.fn(async () => chat),
      patchChat: vi.fn(async () => undefined),
      user: vi.fn(async () => null),
      userIdByPhone: vi.fn(async () => null),
    };
    const service = new TelegramBotService(
      { get: vi.fn(async () => "123456:token") } as never,
      { bind: () => asApi(api) } as never,
      repo as never,
      {
        get: vi.fn(async () => ({
          enabled: true,
          welcomeAr: "",
          welcomeEn: "",
          supportUsername: "",
          adsEnabled: true,
        })),
      } as never,
      {} as never,
      {} as never,
      { sendAfterDelivery: vi.fn() } as never,
      {} as never,
      {} as never,
      fakeRedis() as never,
      { WEB_ORIGIN: ["https://wasfa.online"] } as never,
      logger as never,
    );
    return { service, repo };
  }

  it("maps what Telegram reports and drops empty values", () => {
    expect(profileOf(from)).toEqual({
      telegramUserId: 5,
      username: "sara",
      firstName: "Sara",
      lastName: "Ali",
      languageCode: "ar",
    });
    expect(profileOf({ id: 9 })).toMatchObject({ username: null, languageCode: null });
    expect(profileOf(undefined)).toBeUndefined();
  });

  it("upserts the profile on every update and sets started_at on the first /start only", async () => {
    const first = build();
    await first.service.process({
      update_id: 1,
      message: { message_id: 1, chat: private5, from, text: "/start" },
    });
    expect(first.repo.chat).toHaveBeenCalledWith(5, expect.objectContaining({ username: "sara" }));
    expect(first.repo.patchChat).toHaveBeenCalledWith(5, { startedAt: expect.any(Date) });

    const again = build({ startedAt: new Date() });
    await again.service.process({
      update_id: 2,
      message: { message_id: 1, chat: private5, from, text: "/start" },
    });
    expect(again.repo.patchChat).not.toHaveBeenCalledWith(5, { startedAt: expect.any(Date) });
  });

  it("saves the phone of the own contact of the sender even without a matching account", async () => {
    const { service, repo } = build();
    await service.process({
      update_id: 3,
      message: {
        message_id: 1,
        chat: private5,
        from,
        contact: { phone_number: "201001234567", user_id: 5 },
      },
    });
    expect(repo.patchChat).toHaveBeenCalledWith(5, {
      phone: "+201001234567",
      phoneSharedAt: expect.any(Date),
    });
    expect(repo.patchChat).not.toHaveBeenCalledWith(
      5,
      expect.objectContaining({ userId: expect.anything() }),
    );
  });

  it("never saves a phone from a contact card of someone else", async () => {
    const { service, repo } = build();
    await service.process({
      update_id: 4,
      message: {
        message_id: 1,
        chat: private5,
        from,
        contact: { phone_number: "201001234567", user_id: 77 },
      },
    });
    expect(repo.patchChat).not.toHaveBeenCalledWith(
      5,
      expect.objectContaining({ phone: expect.anything() }),
    );
  });
});

describe("TelegramAdsService", () => {
  const offer = {
    text: "ad\n\ndiscount",
    link: "https://wasfa.online/a/t",
    creativeId: "c",
    confirmSent: vi.fn(async () => undefined),
  };
  const build = (adsEnabled: boolean, found: typeof offer | null) => {
    const ads = { maybeTelegramAd: vi.fn(async () => found) };
    const service = new TelegramAdsService(
      ads as never,
      { get: vi.fn(async () => ({ adsEnabled })) } as never,
      logger as never,
    );
    return { service, ads, api: fakeApi() };
  };

  it("sends one separate message with a link button, then records it", async () => {
    offer.confirmSent.mockClear();
    const { service, api } = build(true, offer);
    await service.sendAfterDelivery(asApi(api), { chatId: 5, userId: null }, "ar");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(api.sendMessage.mock.calls[0])).toContain("https://wasfa.online/a/t");
    expect(offer.confirmSent).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when switched off for Telegram or when the rules offer no ad", async () => {
    const off = build(false, offer);
    await off.service.sendAfterDelivery(asApi(off.api), { chatId: 5, userId: null }, "ar");
    expect(off.ads.maybeTelegramAd).not.toHaveBeenCalled();
    const none = build(true, null);
    await none.service.sendAfterDelivery(asApi(none.api), { chatId: 5, userId: null }, "ar");
    expect(none.api.sendMessage).not.toHaveBeenCalled();
  });
});
