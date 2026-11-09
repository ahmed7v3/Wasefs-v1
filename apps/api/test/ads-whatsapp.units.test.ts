import { adsSettingsSchema, type AdsSettings } from "@wasfa/shared/ads";
import { describe, expect, it } from "vitest";

import { eligibleWhatsAppCreatives } from "../src/ads/ads-selection.js";
import { verifyAdToken } from "../src/ads/ads-token.js";
import {
  AdsWhatsappService,
  inQuietHours,
  type WhatsAppAdContext,
} from "../src/ads/ads-whatsapp.service.js";

import type { AdCreativeRow, WaConversation } from "@wasfa/db";

const NOW = new Date("2026-11-08T12:00:00Z"); // 14:00 in Cairo
const SECRET = "test-secret-test-secret-test-secret-0";
const MEDIA = "https://media.wasfa.online";

class Redis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  get = (key: string) => Promise.resolve(this.values.get(key) ?? null);
  exists = (key: string) => Promise.resolve(this.values.has(key) ? 1 : 0);
  pipeline() {
    const ops: Array<() => void> = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => this.values.set(key, String(Number(this.values.get(key) ?? 0) + 1)));
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => this.ttls.set(key, seconds));
        return chain;
      },
      set: (key: string, value: string, _ex: string, seconds: number) => {
        ops.push(() => {
          this.values.set(key, value);
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

let counter = 0;
const creative = (patch: Partial<AdCreativeRow> = {}): AdCreativeRow => {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    advertiserId: null,
    title: "Offer",
    imageMediaId: null,
    alt: "Offer",
    targetUrl: "https://example.com",
    category: "house",
    status: "approved",
    startsAt: null,
    endsAt: null,
    weight: 100,
    targeting: { placements: [], pageClasses: [], devices: [], locales: [], countries: [] },
    channels: ["whatsapp"],
    waText: "خصم على التوصيل من صيدليتنا",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
};

const candidate = (row: AdCreativeRow, media: unknown = null) => ({
  creative: row,
  advertiserName: null,
  advertiserActive: true,
  media,
});

const conversation = (patch: Partial<WaConversation> = {}): WaConversation => ({
  id: "018f0000-0000-7000-8000-0000000000c1",
  jid: "201012345678@s.whatsapp.net",
  phone: "+201012345678",
  userId: "018f0000-0000-7000-8000-0000000000a1",
  status: "active",
  pausedUntil: null,
  lastInboundAt: null,
  lastOutboundAt: null,
  summary: null,
  adsOptOut: false,
  createdAt: NOW,
  updatedAt: NOW,
  ...patch,
});

function setup(
  options: {
    whatsapp?: Partial<AdsSettings["whatsapp"]>;
    creatives?: ReturnType<typeof candidate>[];
    adsFree?: boolean;
    rng?: () => number;
  } = {},
) {
  const redis = new Redis();
  const settings = adsSettingsSchema.parse({
    enabled: true,
    whatsapp: { enabled: true, ...options.whatsapp },
  });
  const service = new AdsWhatsappService(
    {
      approvedCreatives: () => Promise.resolve(options.creatives ?? [candidate(creative())]),
    } as never,
    { isAdsFree: () => Promise.resolve(options.adsFree ?? false) } as never,
    { get: () => Promise.resolve(settings) } as never,
    redis as never,
    {
      BETTER_AUTH_SECRET: SECRET,
      MEDIA_PUBLIC_ORIGIN: MEDIA,
      WEB_ORIGIN: ["https://wasfa.online"],
    } as never,
  );
  // 0.5 passes the default 0.7 probability; the picker gets the same draw.
  service.rng = options.rng ?? (() => 0.5);
  return { service, redis };
}

const delivered: WhatsAppAdContext = { moment: "delivered", now: NOW };

describe("maybeWhatsAppAd gates", () => {
  it("sends nothing while the switch is off", async () => {
    const { service } = setup({ whatsapp: { enabled: false } });
    expect(await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered)).toBeNull();
  });

  it("sends nothing when the trigger is not enabled", async () => {
    const { service } = setup({ whatsapp: { triggers: ["after_command:help"] } });
    expect(await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered)).toBeNull();
  });

  it("offers one ad when everything allows it", async () => {
    const { service } = setup();
    const offer = await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    expect(offer?.parts).toHaveLength(1);
  });

  it.each([
    ["a failure", { moment: "failure" as const }, conversation()],
    ["a payment message", { moment: "payment" as const }, conversation()],
    [
      "a paused chat",
      {},
      conversation({ status: "paused", pausedUntil: new Date(NOW.getTime() + 60_000) }),
    ],
    ["a blocked chat", {}, conversation({ status: "blocked" })],
    ["an opted-out chat", {}, conversation({ adsOptOut: true })],
  ])("never after %s", async (_name, ctx, chat) => {
    const { service } = setup();
    expect(
      await service.maybeWhatsAppAd(chat, "after_rx_done", { ...delivered, ...ctx }),
    ).toBeNull();
  });

  it("an expired pause no longer blocks", async () => {
    const { service } = setup();
    const chat = conversation({ status: "paused", pausedUntil: new Date(NOW.getTime() - 1) });
    expect(await service.maybeWhatsAppAd(chat, "after_rx_done", delivered)).not.toBeNull();
  });

  it("never to a user on an ads-free plan", async () => {
    const { service } = setup({ adsFree: true });
    expect(await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered)).toBeNull();
  });
});

describe("quiet hours (Africa/Cairo)", () => {
  it("wraps midnight", () => {
    expect(inQuietHours(23 * 60 + 30, "23:00", "08:00")).toBe(true);
    expect(inQuietHours(7 * 60 + 59, "23:00", "08:00")).toBe(true);
    expect(inQuietHours(8 * 60, "23:00", "08:00")).toBe(false);
    expect(inQuietHours(14 * 60, "23:00", "08:00")).toBe(false);
    expect(inQuietHours(12 * 60, "13:00", "13:00")).toBe(false);
  });

  it("sends nothing at 23:30 or 07:00 in Cairo, but does at 08:00", async () => {
    const { service } = setup();
    const at = (iso: string) =>
      service.maybeWhatsAppAd(conversation(), "after_rx_done", {
        moment: "delivered",
        now: new Date(iso),
      });
    expect(await at("2026-11-08T21:30:00Z")).toBeNull();
    expect(await at("2026-11-08T05:00:00Z")).toBeNull();
    expect(await at("2026-11-08T06:00:00Z")).not.toBeNull();
  });
});

describe("caps and the draw", () => {
  it("stops at the per-user daily maximum", async () => {
    const { service } = setup({ whatsapp: { maxPerUserPerDay: 2, minGapHours: 0 } });
    const chat = conversation();
    for (let sent = 0; sent < 2; sent += 1) {
      const offer = await service.maybeWhatsAppAd(chat, "after_rx_done", delivered);
      expect(offer).not.toBeNull();
      await offer?.confirmSent();
    }
    expect(await service.maybeWhatsAppAd(chat, "after_rx_done", delivered)).toBeNull();
    // Another chat is unaffected, and so is the same chat the next Cairo day.
    expect(
      await service.maybeWhatsAppAd(conversation({ id: "x" }), "after_rx_done", delivered),
    ).not.toBeNull();
    const tomorrow = { moment: "delivered" as const, now: new Date(NOW.getTime() + 24 * 3600_000) };
    expect(await service.maybeWhatsAppAd(chat, "after_rx_done", tomorrow)).not.toBeNull();
  });

  it("keeps the minimum gap between two ads to one user", async () => {
    const { service, redis } = setup({ whatsapp: { minGapHours: 6 } });
    const chat = conversation();
    await (await service.maybeWhatsAppAd(chat, "after_rx_done", delivered))?.confirmSent();
    expect(await service.maybeWhatsAppAd(chat, "after_rx_done", delivered)).toBeNull();
    expect([...redis.ttls.entries()].find(([key]) => key.includes(":gap:"))?.[1]).toBe(6 * 3600);
    redis.values.delete(`ads:wa:gap:${chat.id}`);
    expect(await service.maybeWhatsAppAd(chat, "after_rx_done", delivered)).not.toBeNull();
  });

  it("stops for the day at the global limit of the number", async () => {
    const { service } = setup({
      whatsapp: { globalDailyLimit: 2, minGapHours: 0, maxPerUserPerDay: 5 },
    });
    for (const id of ["a", "b"]) {
      await (
        await service.maybeWhatsAppAd(conversation({ id }), "after_rx_done", delivered)
      )?.confirmSent();
    }
    expect(
      await service.maybeWhatsAppAd(conversation({ id: "c" }), "after_rx_done", delivered),
    ).toBeNull();
  });

  it("draws against the probability with the injected generator", async () => {
    const low = setup({ whatsapp: { probability: 0.7 }, rng: () => 0.69 });
    expect(
      await low.service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered),
    ).not.toBeNull();
    const high = setup({ whatsapp: { probability: 0.7 }, rng: () => 0.7 });
    expect(
      await high.service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered),
    ).toBeNull();
    const never = setup({ whatsapp: { probability: 0 }, rng: () => 0 });
    expect(
      await never.service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered),
    ).toBeNull();
  });

  it("records the caps and the impression only when confirmed as sent", async () => {
    const { service, redis } = setup();
    const offer = await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    expect(redis.values.size).toBe(0);
    await offer?.confirmSent();
    const keys = [...redis.values.keys()];
    expect(keys.some((key) => key.startsWith("ads:wa:user:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("ads:wa:global:"))).toBe(true);
    expect(keys.some((key) => key.startsWith("ads:wa:gap:"))).toBe(true);
    expect(keys).toContain(
      `ads:c:${offer?.creativeId ?? ""}:whatsapp.after_rx_done:2026-11-08:whatsapp:i`,
    );
  });
});

describe("the message", () => {
  it("is a text part with the label, the text and a tracked link when there is no image", async () => {
    const { service } = setup();
    const offer = await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    const [part] = offer?.parts ?? [];
    expect(part?.kind).toBe("text");
    const text = part?.kind === "text" ? part.text : "";
    expect(
      text.startsWith("«إعلان»\n\nخصم على التوصيل من صيدليتنا\n\nhttps://wasfa.online/a/"),
    ).toBe(true);
    const token = text.split("/a/")[1] ?? "";
    expect(verifyAdToken(SECRET, token, NOW)).toMatchObject({
      creativeId: offer?.creativeId,
      placement: "whatsapp.after_rx_done",
      channel: "whatsapp",
    });
  });

  it("is an image with the same caption when the creative has a ready picture", async () => {
    const media = {
      status: "ready",
      width: 1200,
      height: 600,
      variants: [
        { format: "avif", width: 1200, key: "media/h/1200.avif", bytes: 1 },
        { format: "jpeg", width: 480, key: "media/h/480.jpeg", bytes: 1 },
        { format: "jpeg", width: 1200, key: "media/h/1200.jpeg", bytes: 1 },
      ],
    };
    const { service } = setup({ creatives: [candidate(creative(), media)] });
    const offer = await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    const [part] = offer?.parts ?? [];
    expect(part).toMatchObject({ kind: "image", url: `${MEDIA}/media/h/1200.jpeg` });
    expect(part?.kind === "image" ? part.caption : "").toContain("«إعلان»");
    expect(part?.kind === "image" ? part.caption : "").toContain("https://wasfa.online/a/");
  });

  it("the token outlives the 24 hours of a web token", async () => {
    const { service } = setup();
    const offer = await service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    const text = offer?.parts[0]?.kind === "text" ? offer.parts[0].text : "";
    const token = text.split("/a/")[1] ?? "";
    expect(
      verifyAdToken(SECRET, token, new Date(NOW.getTime() + 7 * 24 * 3600_000)),
    ).not.toBeNull();
  });
});

describe("creative selection", () => {
  it("takes only approved, scheduled, non-medicine WhatsApp creatives with a text", () => {
    const good = creative();
    const rows = [
      good,
      creative({ channels: ["web"] }),
      creative({ status: "draft" }),
      creative({ waText: null }),
      creative({ startsAt: new Date(NOW.getTime() + 1000) }),
      creative({ endsAt: new Date(NOW.getTime() - 1000) }),
      creative({ category: "medicine" }),
    ];
    expect(
      eligibleWhatsAppCreatives(
        rows.map((row) => candidate(row)),
        NOW,
      ),
    ).toEqual([good]);
  });

  it("is weighted by the creatives' weights", async () => {
    const light = creative({ weight: 100 });
    const heavy = creative({ weight: 300 });
    const creatives = [candidate(light), candidate(heavy)];
    const first = setup({ creatives, rng: () => 0.5 });
    // The probability draw (0.5) and the pick (0.5 * 400 = 200) land on the heavy creative.
    const offer = await first.service.maybeWhatsAppAd(conversation(), "after_rx_done", delivered);
    expect(offer?.creativeId).toBe(heavy.id);
  });

  it("cannot see message, prescription or analysis content: the signature has none", () => {
    // maybeWhatsAppAd(conversation, trigger, ctx): the context type is the moment, a locale and a clock.
    const ctx: Required<WhatsAppAdContext> = { moment: "delivered", locale: "ar", now: NOW };
    expect(Object.keys(ctx).sort()).toEqual(["locale", "moment", "now"]);
    expect(AdsWhatsappService.prototype.maybeWhatsAppAd.length).toBe(3);
    expect(eligibleWhatsAppCreatives.length).toBe(2);
  });
});

describe("maybeTelegramAd (same rules, a chat of its own)", () => {
  const chat = { chatId: 777, userId: "018f0000-0000-7000-8000-0000000000a1" };

  it("offers one labelled ad with a tracked link and records it only on confirm", async () => {
    const { service, redis } = setup();
    const offer = await service.maybeTelegramAd(chat, "after_rx_done", delivered);
    expect(offer?.text).toContain("خصم على التوصيل");
    expect(offer?.link).toMatch(/^https:\/\/wasfa\.online\/a\//);
    expect(redis.values.size).toBe(0);
    await offer?.confirmSent();
    expect(redis.values.get("ads:wa:user:tg:777:2026-11-08")).toBe("1");
  });

  it("never for ads-free plans, failures, a disabled switch, or after the daily cap", async () => {
    expect(
      await setup({ adsFree: true }).service.maybeTelegramAd(chat, "after_rx_done", delivered),
    ).toBeNull();
    expect(
      await setup().service.maybeTelegramAd(chat, "after_rx_done", {
        ...delivered,
        moment: "failure",
      }),
    ).toBeNull();
    expect(
      await setup({ whatsapp: { enabled: false } }).service.maybeTelegramAd(
        chat,
        "after_rx_done",
        delivered,
      ),
    ).toBeNull();
    const capped = setup({ whatsapp: { maxPerUserPerDay: 1, minGapHours: 0 } });
    const first = await capped.service.maybeTelegramAd(chat, "after_rx_done", delivered);
    await first?.confirmSent();
    expect(await capped.service.maybeTelegramAd(chat, "after_rx_done", delivered)).toBeNull();
  });
});
