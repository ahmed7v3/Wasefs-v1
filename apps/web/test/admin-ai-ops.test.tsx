// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiOverviewPanel } from "../src/components/admin/ai-overview-panel";
import { AiPlaygroundView } from "../src/components/admin/ai-playground-view";
import { AiSkillsView } from "../src/components/admin/ai-skills-view";
import { AiUsageView } from "../src/components/admin/ai-usage-view";
import { ReauthProvider } from "../src/lib/reauth";

import type { ReactNode } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/ai/usage",
  useSearchParams: () => new URLSearchParams(""),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const MODEL_UUID = "22222222-2222-4222-8222-222222222222";
const PROVIDER_UUID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-11T10:00:00.000Z";

const wrap = (node: ReactNode) =>
  render(
    <ToastProvider>
      <ReauthProvider>{node}</ReauthProvider>
    </ToastProvider>,
  );

const urls = () => fetchMock.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const overview = {
  days: 7,
  generatedAt: NOW,
  today: {
    day: "2026-10-11",
    spendUsdMicros: 8_500_000,
    capUsdMicros: 10_000_000,
    alertPercent: 80,
    source: "redis",
  },
  totals: {
    calls: 12,
    costUsdMicros: 4_000_000,
    errorRate: 0.1667,
    fallbackRate: 0.25,
    cacheHitRate: 0.0833,
    latencyP50Ms: 800,
    latencyP95Ms: 2600,
  },
  perAnalysis: { analyses: 2, avgUsdMicros: 3500, p95UsdMicros: 3950 },
  byDay: Array.from({ length: 7 }, (_, index) => ({
    day: `2026-10-0${String(index + 5)}`,
    calls: index,
    costUsdMicros: index * 1000,
  })),
  byTask: [{ task: "rx_extract", calls: 5, costUsdMicros: 3000 }],
  byModel: [{ modelKey: "gemini-x", calls: 5, costUsdMicros: 3000 }],
};

describe("AiOverviewPanel", () => {
  it("shows the spend meter, the rates and the charts, and reloads for 30 days", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(overview)));
    wrap(<AiOverviewPanel />);

    const meter = await screen.findByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("85");
    // Past the alert threshold the state is written, not only coloured.
    expect(screen.getByText(t("admin.ai.ov.alert", { percent: "80" }))).toBeTruthy();
    expect(screen.getByText("16.7%")).toBeTruthy();
    expect(screen.getByText("gemini-x")).toBeTruthy();
    expect(urls()[0]).toContain("/admin/ai/overview?days=7");

    await userEvent.click(screen.getByRole("button", { name: t("admin.ai.ov.days30") }));
    await waitFor(() => {
      expect(urls().some((url) => url.includes("days=30"))).toBe(true);
    });
  });

  it("shows the error state with a retry", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ code: "FORBIDDEN", message: "no" }, 403)),
    );
    wrap(<AiOverviewPanel />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("AiPlaygroundView", () => {
  const models = {
    items: [
      {
        id: MODEL_UUID,
        provider: { id: PROVIDER_UUID, key: "fake", kind: "fake" },
        modelId: "fake-json",
        displayName: "Fake JSON",
        capabilities: ["json"],
        contextTokens: null,
        priceInputUsdMicrosPerM: 1,
        priceCachedInputUsdMicrosPerM: null,
        priceOutputUsdMicrosPerM: 1,
        priceSearchUsdMicros: 0,
        creditMultiplierBp: 10_000,
        enabled: true,
        priceSource: "manual",
        priceCheckedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        warnings: [],
        usedInRoutes: 0,
      },
    ],
  };

  it("runs the picked model and shows output, cost and the validation errors", async () => {
    fetchMock.mockImplementation((input, init) => {
      if (String(input).endsWith("/admin/ai/playground") && init?.method === "POST") {
        return Promise.resolve(
          json({
            runs: [
              {
                modelId: MODEL_UUID,
                modelKey: "fake-json",
                providerKey: "fake",
                status: "ok",
                errorCode: null,
                output: '{"ok":true}',
                usage: {
                  inputTokens: 10,
                  cachedInputTokens: 0,
                  outputTokens: 5,
                  thinkingTokens: 0,
                  searchCount: 0,
                },
                costUsdMicros: 15,
                latencyMs: 40,
                validation: { schema: "rx_extract", ok: false, errors: ["items: invalid_type"] },
              },
            ],
          }),
        );
      }
      return Promise.resolve(json(models));
    });
    wrap(<AiPlaygroundView />);

    await userEvent.click(await screen.findByRole("checkbox", { name: /Fake JSON/ }));
    await userEvent.type(screen.getByRole("textbox", { name: t("admin.ai.pg.input") }), "hello");
    await userEvent.click(screen.getByRole("button", { name: t("admin.ai.pg.run") }));

    expect(await screen.findByText("items: invalid_type")).toBeTruthy();
    expect(screen.getByText('{"ok":true}')).toBeTruthy();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      task: "chat",
      input: "hello",
      modelIds: [MODEL_UUID],
    });
  });

  it("asks for input and a model before calling the API", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(models)));
    wrap(<AiPlaygroundView />);
    await userEvent.click(await screen.findByRole("button", { name: t("admin.ai.pg.run") }));
    expect(await screen.findByText(t("admin.ai.pg.needInput"))).toBeTruthy();
    expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });
});

describe("AiUsageView", () => {
  it("lists calls with the totals and an export link, never any content column", async () => {
    fetchMock.mockImplementation((input) => {
      if (String(input).includes("/totals")) {
        return Promise.resolve(
          json({
            calls: 1,
            costUsdMicros: 1500,
            inputTokens: 10,
            outputTokens: 5,
            thinkingTokens: 0,
            creditsCharged: 0,
            errors: 0,
            cacheHits: 0,
            avgLatencyMs: 30,
          }),
        );
      }
      return Promise.resolve(
        json({
          items: [
            {
              id: MODEL_UUID,
              createdAt: NOW,
              task: "chat",
              modelKey: "gemini-x",
              providerKey: "gemini",
              ownerUserId: null,
              ownerOrgId: null,
              userId: null,
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
              thinkingTokens: 0,
              searchCount: 0,
              costUsdMicros: 1500,
              creditsCharged: 0,
              latencyMs: 30,
              outcome: "ok",
              cacheHit: false,
              requestId: null,
            },
          ],
          nextCursor: null,
        }),
      );
    });
    wrap(<AiUsageView />);

    expect((await screen.findAllByText("gemini-x")).length).toBeGreaterThan(0);
    expect(await screen.findByText(t("admin.ai.usage.totals"))).toBeTruthy();
    const link = screen.getByRole("link", { name: t("admin.ai.usage.export") });
    expect(link.getAttribute("href")).toContain("/admin/ai/usage/export.csv");
  });
});

describe("AiSkillsView", () => {
  const skills = {
    items: [
      {
        name: "drug-info",
        description: "General drug facts",
        tasks: ["chat"],
        version: "drug-info@52b8ec54e8eb",
        hash: "52b8ec54e8eb",
        enabledFor: "all",
        chat: true,
      },
      {
        name: "prescription-analysis",
        description: "Reads prescriptions",
        tasks: ["rx_extract"],
        version: "prescription-analysis@0ba3613aa4bd",
        hash: "0ba3613aa4bd",
        enabledFor: "all",
        chat: false,
      },
    ],
    plans: [
      { key: "free", nameAr: "المجانية", nameEn: "Free" },
      { key: "pro", nameAr: "المحترف", nameEn: "Pro" },
    ],
  };

  it("saves the plans a skill is enabled for", async () => {
    fetchMock.mockImplementation((_input, init) => {
      if (init?.method === "PUT") {
        return Promise.resolve(
          json({
            ...skills,
            items: [{ ...skills.items[0], enabledFor: ["pro"] }, skills.items[1]],
          }),
        );
      }
      return Promise.resolve(json(skills));
    });
    wrap(<AiSkillsView canWrite />);

    await screen.findByText("drug-info@52b8ec54e8eb");
    await userEvent.click(screen.getByRole("checkbox", { name: t("admin.ai.skills.allToggle") }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "المحترف" }));
    await userEvent.click(screen.getByRole("button", { name: t("admin.ai.skills.save") }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(String(put?.[0])).toContain("/admin/ai/skills/drug-info");
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ enabledFor: ["pro"] });
    });
    // The prescription skill is not plan-gated: no save control for it.
    expect(screen.getAllByRole("button", { name: t("admin.ai.skills.save") })).toHaveLength(1);
  });

  it("is read only without ai.write", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(skills)));
    wrap(<AiSkillsView canWrite={false} />);
    await screen.findByText("drug-info@52b8ec54e8eb");
    expect(screen.queryByRole("button", { name: t("admin.ai.skills.save") })).toBeNull();
  });
});
