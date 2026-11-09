// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { telegramAdsSettingsSchema } from "@wasfa/shared/telegram-ads";
import { ToastProvider } from "@wasfa/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TelegramAdCreativeForm } from "../src/components/admin/telegram-ad-creative-form";
import { TelegramAdPreview } from "../src/components/admin/telegram-ad-preview";
import { TelegramAdsAnalyticsView } from "../src/components/admin/telegram-ads-analytics-view";
import { TelegramAdsCampaignDialog } from "../src/components/admin/telegram-ads-campaign-dialog";
import { TelegramAdsSettingsForm } from "../src/components/admin/telegram-ads-settings-view";
import { niceMax } from "../src/components/admin/telegram-ads-trend-chart";
import { formatNumber } from "../src/lib/admin-format";
import { ReauthProvider } from "../src/lib/reauth";
import {
  heroCaptionLength,
  percentText,
  policySentence,
  presetRange,
  sortRows,
} from "../src/lib/telegram-ads-admin";

import type { TelegramAdCampaign } from "@wasfa/shared/schemas/admin-telegram-ads";
import type { TelegramAdsSettings } from "@wasfa/shared/telegram-ads";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/telegram/ads",
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));

// The real picker lists the media library; the form only needs "an image was chosen".
vi.mock("../src/components/admin/media-picker-dialog", () => ({
  MediaPickerDialog: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (asset: { id: string; variants: never[] }) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => {
          onSelect({ id: "11111111-1111-4111-8111-111111111111", variants: [] });
        }}
      >
        choose-asset
      </button>
    ) : null,
}));

const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const writes = () => fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET");
const bodyOf = (index = 0) =>
  JSON.parse(String(writes()[index]?.[1]?.body)) as Record<string, unknown>;

const defaults: TelegramAdsSettings = telegramAdsSettingsSchema.parse({});

const campaign: TelegramAdCampaign = {
  id: CAMPAIGN_ID,
  name: "Ramadan",
  advertiser: "",
  status: "active",
  startsAt: null,
  endsAt: null,
  dailyImpressionCap: null,
  totalImpressionCap: null,
  notes: "",
  creativeCount: 2,
  impressions: 10,
  clicks: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((input) =>
    Promise.resolve(
      String(input).includes("/telegram/ads/settings") ? json(defaults) : json({}, 404),
    ),
  );
});

const wrap = (node: React.ReactNode) =>
  render(
    <ReauthProvider>
      <ToastProvider>{node}</ToastProvider>
    </ReauthProvider>,
  );

const control = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`[name="${name}"]`);

describe("telegram ads helpers", () => {
  it("states the effective policy in one sentence", () => {
    expect(policySentence(defaults)).toBe(t("admin.tgAds.policy.unlimited"));
    expect(policySentence({ ...defaults, enabled: false })).toBe(t("admin.tgAds.policy.disabled"));
    expect(policySentence({ ...defaults, triggers: [] })).toBe(t("admin.tgAds.policy.noTriggers"));
    const limited = policySentence({
      ...defaults,
      maxPerChatPerDay: { enabled: true, value: 2 },
    });
    expect(limited).toContain("2");
    expect(limited).not.toBe(t("admin.tgAds.policy.unlimited"));
  });

  it("computes ranges, percents, caption length, sorting and chart scale", () => {
    expect(presetRange(7, new Date("2026-03-10T12:00:00Z"))).toEqual({
      from: "2026-03-04",
      to: "2026-03-10",
    });
    expect(percentText(0.0333)).toBe("3.33%");
    expect(percentText(Number.NaN)).toBe("0%");
    expect(heroCaptionLength("abc", "", "en")).toBe(
      t("admin.tgAds.preview.label", undefined, "en").length + 1 + 3,
    );
    expect(
      sortRows([{ n: 1 }, { n: 3 }, { n: 2 }], (row) => row.n, "desc").map((r) => r.n),
    ).toEqual([3, 2, 1]);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(130)).toBe(200);
    expect(niceMax(1000)).toBe(1000);
  });
});

describe("TelegramAdPreview", () => {
  const base = {
    headline: "Big sale",
    body: "Come today",
    imageUrl: "https://cdn.example/x.jpg",
    buttons: [{ label: "Open", url: "https://example.com" }],
    buttonsPerRow: 1 as const,
    allowReactions: true,
    allowHide: true,
  };

  it("renders the hero layout: image, label, bold headline, body, link and reaction row", () => {
    const { container } = render(<TelegramAdPreview {...base} layout="hero" />);
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.getByTestId("tg-label").textContent).toBe("📢 إعلان");
    expect(screen.getByTestId("tg-headline").textContent).toBe("Big sale");
    expect(screen.getByTestId("tg-body").textContent).toBe("Come today");
    expect(screen.getAllByTestId("tg-link-button")).toHaveLength(1);
    const row = screen.getByTestId("tg-reactions");
    expect(row.textContent).toContain("👍 مهتم");
    expect(row.textContent).toContain("🙈 إخفاء الإعلانات");
  });

  it("renders card as a text bubble and compact as one line, without an image", () => {
    const card = render(<TelegramAdPreview {...base} layout="card" />);
    expect(card.container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("tg-body")).toBeTruthy();
    card.unmount();
    render(<TelegramAdPreview {...base} layout="compact" />);
    expect(screen.getByTestId("tg-line").textContent).toContain("Big sale");
    expect(screen.queryByTestId("tg-body")).toBeNull();
  });

  it("hides the reaction row parts that the settings turn off", () => {
    render(<TelegramAdPreview {...base} layout="card" allowReactions={false} allowHide={false} />);
    expect(screen.queryByTestId("tg-reactions")).toBeNull();
  });

  it("switches the preview to English (ltr) and to the dark chat", async () => {
    const user = userEvent.setup();
    render(<TelegramAdPreview {...base} layout="card" />);
    expect(screen.getByTestId("tg-bubble").getAttribute("dir")).toBe("rtl");
    await user.click(screen.getByRole("button", { name: t("admin.tgAds.preview.langEn") }));
    expect(screen.getByTestId("tg-bubble").getAttribute("dir")).toBe("ltr");
    expect(screen.getByTestId("tg-label").textContent).toBe("📢 Ad");
    expect(screen.getByTestId("tg-reactions").textContent).toContain("👍 Interested");
    await user.click(screen.getByRole("button", { name: t("admin.tgAds.preview.dark") }));
    expect(
      screen
        .getByRole("button", { name: t("admin.tgAds.preview.dark") })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("warns when the hero caption is over 1024 characters, and only for hero", () => {
    const long = "x".repeat(1_100);
    const hero = render(<TelegramAdPreview {...base} layout="hero" body={long} />);
    expect(screen.getByRole("alert").textContent).toContain("1024");
    hero.unmount();
    render(<TelegramAdPreview {...base} layout="card" body={long} />);
    expect(screen.queryByTestId("tg-caption-count")).toBeNull();
  });
});

describe("TelegramAdsSettingsForm", () => {
  it("disables and mutes the number while the limit is off, and enables it when switched on", async () => {
    const user = userEvent.setup();
    const { container } = wrap(
      <TelegramAdsSettingsForm initial={defaults} canWrite onSaved={() => undefined} />,
    );
    const number = control(container, "maxPerChatPerDay-value");
    expect(number?.disabled).toBe(true);
    expect(number?.className).toContain("opacity-50");
    expect(number?.getAttribute("placeholder")).toBe(t("admin.tgAds.limit.offLabel"));
    expect(screen.getByTestId("tg-policy").textContent).toContain(
      t("admin.tgAds.policy.unlimited"),
    );

    await user.click(within(screen.getByTestId("limit-maxPerChatPerDay")).getByRole("switch"));
    expect(control(container, "maxPerChatPerDay-value")?.disabled).toBe(false);
    expect(control(container, "maxPerChatPerDay-value")?.value).toBe("3");
    expect(screen.getByTestId("tg-policy").textContent).not.toContain(
      t("admin.tgAds.policy.unlimited"),
    );
  });

  it("saves with the switches as they are: enabled false when off, true when on", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(init?.method === "PUT" ? json(defaults) : json({}, 404)),
    );
    const { container } = wrap(
      <TelegramAdsSettingsForm initial={defaults} canWrite onSaved={() => undefined} />,
    );
    await user.click(within(screen.getByTestId("limit-globalDailyLimit")).getByRole("switch"));
    fireEvent.change(control(container, "globalDailyLimit-value") as HTMLInputElement, {
      target: { value: "800" },
    });
    await user.click(screen.getByRole("button", { name: t("admin.tgAds.settings.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const body = bodyOf() as unknown as TelegramAdsSettings;
    expect(body.probability.enabled).toBe(false);
    expect(body.maxPerChatPerDay.enabled).toBe(false);
    expect(body.globalDailyLimit).toEqual({ enabled: true, value: 800 });
    expect(String(writes()[0]?.[0])).toContain("/admin/telegram/ads/settings");
  });

  it("stores the probability as 0-1 while showing a percent", async () => {
    const user = userEvent.setup();
    const { container } = wrap(
      <TelegramAdsSettingsForm initial={defaults} canWrite onSaved={() => undefined} />,
    );
    await user.click(within(screen.getByTestId("limit-probability")).getByRole("switch"));
    expect(control(container, "probability-value")?.value).toBe("70");
  });

  it("is read-only without ads.write", () => {
    const { container } = wrap(
      <TelegramAdsSettingsForm initial={defaults} canWrite={false} onSaved={() => undefined} />,
    );
    expect(screen.queryByRole("button", { name: t("admin.tgAds.settings.save") })).toBeNull();
    expect(control(container, "ads-enabled")?.disabled).toBe(true);
  });
});

describe("TelegramAdCreativeForm", () => {
  const mount = () =>
    wrap(
      <TelegramAdCreativeForm
        creative={null}
        defaultCampaignId=""
        campaigns={[campaign]}
        onSaved={() => undefined}
        onClose={() => undefined}
      />,
    );

  const fillBasics = async (user: ReturnType<typeof userEvent.setup>, container: HTMLElement) => {
    await user.type(control(container, "name") as HTMLElement, "Spring");
    await user.type(control(container, "headline") as HTMLElement, "Hello");
  };

  it("requires an image for the hero layout and does not post", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await fillBasics(user, container);
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.tgAds.invalid.heroNeedsImage"))).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("accepts a hero once an image is chosen and posts without a status", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(init?.method === "POST" ? json({}, 500) : json(defaults)),
    );
    const { container } = mount();
    await fillBasics(user, container);
    await user.click(screen.getByRole("button", { name: t("admin.tgAds.creative.imagePick") }));
    await user.click(screen.getByRole("button", { name: "choose-asset" }));
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    const body = bodyOf();
    expect(body["imageMediaId"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(body["layout"]).toBe("hero");
    expect(body["campaignId"]).toBe(CAMPAIGN_ID);
    expect(body).not.toHaveProperty("status");
  });

  it("allows a card without an image", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input, init) =>
      Promise.resolve(init?.method === "POST" ? json({}, 500) : json(defaults)),
    );
    const { container } = mount();
    await fillBasics(user, container);
    await user.click(screen.getByRole("radio", { name: new RegExp(t("admin.tgAds.layout.card")) }));
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(bodyOf()["layout"]).toBe("card");
    expect(bodyOf()["imageMediaId"]).toBeNull();
  });

  it("rejects non-https button links", async () => {
    const user = userEvent.setup();
    const { container } = mount();
    await fillBasics(user, container);
    await user.click(screen.getByRole("radio", { name: new RegExp(t("admin.tgAds.layout.card")) }));
    await user.click(screen.getByRole("button", { name: t("admin.tgAds.creative.buttonAdd") }));
    await user.type(control(container, "button-label-0") as HTMLElement, "Go");
    const url = control(container, "button-url-0") as HTMLInputElement;
    await user.clear(url);
    await user.type(url, "http://example.com");
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.tgAds.invalid.buttonHttps"))).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("stops adding buttons at four and shows them in the live preview", async () => {
    const user = userEvent.setup();
    mount();
    const add = screen.getByRole("button", { name: t("admin.tgAds.creative.buttonAdd") });
    for (let index = 0; index < 4; index += 1) await user.click(add);
    expect(add.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByTestId("tg-link-button")).toHaveLength(4);
  });

  it("shows the medicine warning", () => {
    mount();
    expect(screen.getByTestId("tg-medicine-warning").textContent).toContain(
      t("admin.tgAds.creative.medicineWarning"),
    );
  });
});

describe("TelegramAdsCampaignDialog", () => {
  const mount = (existing: TelegramAdCampaign | null = null) =>
    wrap(
      <TelegramAdsCampaignDialog
        open
        campaign={existing}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

  it("sends null caps while 'no limit' is on, and the number once it is off", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(() => Promise.resolve(json({}, 500)));
    const { container } = mount();
    await user.type(control(container, "name") as HTMLElement, "Eid");
    expect(control(container, "dailyImpressionCap")?.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(bodyOf()["dailyImpressionCap"]).toBeNull();
    expect(bodyOf()["totalImpressionCap"]).toBeNull();

    await user.click(control(container, "dailyImpressionCap-unlimited") as HTMLElement);
    const daily = control(container, "dailyImpressionCap") as HTMLInputElement;
    expect(daily.disabled).toBe(false);
    fireEvent.change(daily, { target: { value: "500" } });
    await user.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(writes()).toHaveLength(2);
    });
    expect(bodyOf(1)["dailyImpressionCap"]).toBe(500);
    expect(bodyOf(1)["totalImpressionCap"]).toBeNull();
  });

  it("starts an existing capped campaign with its switch off and an unlimited one with it on", () => {
    const capped = mount({ ...campaign, dailyImpressionCap: 100 });
    expect(control(capped.container, "dailyImpressionCap-unlimited")?.checked).toBe(false);
    expect(control(capped.container, "dailyImpressionCap")?.value).toBe("100");
    expect(control(capped.container, "totalImpressionCap-unlimited")?.checked).toBe(true);
  });
});

describe("TelegramAdsAnalyticsView", () => {
  const metrics = {
    impressions: 1_200,
    clicks: 40,
    reactions: 7,
    hides: 3,
    reach: 300,
    ctr: 40 / 1_200,
    engagementRate: 47 / 1_200,
  };
  const stats = (empty: boolean) => ({
    from: "2026-02-01",
    to: "2026-03-02",
    totals: empty
      ? { impressions: 0, clicks: 0, reactions: 0, hides: 0, reach: 0, ctr: 0, engagementRate: 0 }
      : metrics,
    byDay: empty
      ? []
      : [
          { day: "2026-03-01", ...metrics },
          { day: "2026-03-02", ...metrics, impressions: 600 },
        ],
    byCampaign: empty ? [] : [{ campaignId: CAMPAIGN_ID, name: "Ramadan", ...metrics }],
    byCreative: empty
      ? []
      : [
          {
            creativeId: "33333333-3333-4333-8333-333333333333",
            name: "Hero A",
            campaignId: CAMPAIGN_ID,
            ...metrics,
          },
        ],
    byTrigger: empty ? [] : [{ trigger: "after_rx_done", ...metrics }],
  });

  const serve = (empty: boolean) => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/telegram/ads/stats")) return Promise.resolve(json(stats(empty)));
      if (url.includes("/telegram/ads/campaigns"))
        return Promise.resolve(json({ items: [campaign] }));
      return Promise.resolve(json({}, 404));
    });
  };

  it("renders KPI totals, the trend, the tables and the export link", async () => {
    serve(false);
    render(<TelegramAdsAnalyticsView />);
    expect((await screen.findByTestId("kpi-impressions")).textContent).toBe(formatNumber(1_200));
    expect(screen.getByTestId("kpi-clicks").textContent).toBe("40");
    expect(screen.getByTestId("kpi-ctr").textContent).toBe(percentText(40 / 1_200));
    expect(screen.getByTestId("kpi-reactions").textContent).toBe("7");
    expect(screen.getByTestId("kpi-hides").textContent).toBe("3");
    expect(screen.getByTestId("kpi-reach").textContent).toBe("300");
    expect(screen.getByTestId("kpi-engagement").textContent).toBe(percentText(47 / 1_200));
    expect(screen.getByTestId("tg-trend-impressions")).toBeTruthy();
    expect(screen.getByTestId("tg-trend-clicks")).toBeTruthy();
    expect(screen.getAllByText("Ramadan").length).toBeGreaterThan(1);
    expect(screen.getByText("Hero A")).toBeTruthy();
    expect(screen.getByText(t("admin.tgAds.trigger.after_rx_done"))).toBeTruthy();
    const link = screen.getByRole("link", { name: t("admin.tgAds.export") });
    expect(link.getAttribute("href")).toContain("/admin/telegram/ads/stats/export?from=");
    // The default range is the last 30 days.
    expect(
      String(fetchMock.mock.calls.find(([u]) => String(u).includes("/stats?"))?.[0]),
    ).toContain("from=");
  });

  it("shows the empty state when there is no data", async () => {
    serve(true);
    render(<TelegramAdsAnalyticsView />);
    expect(await screen.findByTestId("tg-stats-empty")).toBeTruthy();
    expect(screen.getByTestId("tg-trend-empty")).toBeTruthy();
    expect(screen.getAllByTestId("tg-table-empty")).toHaveLength(3);
  });

  it("refetches with the campaign filter and sorts a table by a column", async () => {
    const user = userEvent.setup();
    serve(false);
    render(<TelegramAdsAnalyticsView />);
    await screen.findByTestId("kpi-impressions");
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("admin.tgAds.filter.campaign") }),
      CAMPAIGN_ID,
    );
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes(`campaignId=${CAMPAIGN_ID}`)),
      ).toBe(true);
    });
    const table = screen.getByRole("region", { name: t("admin.tgAds.table.byCampaign") });
    const header = within(table).getByRole("columnheader", { name: t("admin.tgAds.kpi.clicks") });
    expect(header.getAttribute("aria-sort")).toBe("none");
    await user.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).toBe("descending");
  });
});
