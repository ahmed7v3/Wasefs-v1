// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AI_TASKS } from "@wasfa/shared/ai";
import { t } from "@wasfa/shared/i18n";
import { type ModelView, type RouteView } from "@wasfa/shared/schemas/admin-ai";
import { type PlanView } from "@wasfa/shared/schemas/plans";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdjustCreditsDialog } from "../src/components/admin/adjust-credits-dialog";
import { EntitlementsEditor } from "../src/components/admin/entitlements-editor";
import { RouteEditor } from "../src/components/admin/route-editor";
import { taskLabel } from "../src/lib/admin-billing";
import { ReauthProvider } from "../src/lib/reauth";

const MODEL_A = "11111111-1111-4111-8111-111111111111";
const MODEL_B = "22222222-2222-4222-8222-222222222222";
const ROUTE_ID = "33333333-3333-4333-8333-333333333333";
const PLAN_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const callsTo = (method: string, path: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith(path) && (init?.method ?? "GET") === method,
  );

const bodyOf = (call: Parameters<typeof fetch> | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;

function model(id: string, displayName: string, overrides: Partial<ModelView> = {}): ModelView {
  return {
    id,
    provider: { id: "66666666-6666-4666-8666-666666666666", key: "gemini", kind: "gemini" },
    modelId: displayName.toLowerCase().replaceAll(" ", "-"),
    displayName,
    capabilities: ["vision", "json"],
    contextTokens: 1_000_000,
    priceInputUsdMicrosPerM: 750_000,
    priceCachedInputUsdMicrosPerM: null,
    priceOutputUsdMicrosPerM: 3_750_000,
    priceSearchUsdMicros: 0,
    creditMultiplierBp: 10_000,
    enabled: true,
    priceSource: "manual",
    priceCheckedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    warnings: [],
    usedInRoutes: 1,
    ...overrides,
  };
}

function routeView(): RouteView {
  const detail = (id: string, name: string) => ({
    modelId: id,
    params: {},
    model: {
      modelId: name,
      displayName: name,
      providerKey: "gemini",
      enabled: true,
      capabilities: ["vision" as const],
      priceInput: 750_000,
      priceOutput: 3_750_000,
    },
  });
  return {
    id: ROUTE_ID,
    task: "chat",
    planId: null,
    planKey: null,
    mode: "fast",
    version: 3,
    models: [detail(MODEL_A, "Model A"), detail(MODEL_B, "Model B")],
    warnings: [],
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function renderEditor(onDone = vi.fn(), onStale = vi.fn()) {
  fetchMock.mockImplementation((url, init) => {
    if (String(url).endsWith("/admin/ai/models") && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(
        json({ items: [model(MODEL_A, "Model A"), model(MODEL_B, "Model B")] }),
      );
    }
    return Promise.resolve(json(routeView()));
  });
  render(
    <ToastProvider>
      <ReauthProvider>
        <RouteEditor
          task="chat"
          mode="fast"
          planId={null}
          route={routeView()}
          seed={null}
          canWrite
          onDone={onDone}
          onStale={onStale}
        />
      </ReauthProvider>
    </ToastProvider>,
  );
  return { onDone, onStale };
}

describe("RouteEditor", () => {
  it("labels the primary and the fallbacks and shows each model's price per 1M", async () => {
    renderEditor();
    const primary = await screen.findByRole("group", { name: t("admin.routes.primary") });
    expect(within(primary).getByText("$0.75 / $3.75")).toBeTruthy();
    expect(screen.getByRole("group", { name: t("admin.routes.fallback", { n: 1 }) })).toBeTruthy();
  });

  it("moves a model down, announces it and saves the new order with expectedVersion", async () => {
    const { onDone } = renderEditor();
    const primary = await screen.findByRole("group", { name: t("admin.routes.primary") });
    await userEvent.click(
      within(primary).getByRole("button", { name: t("admin.routes.moveDown") }),
    );

    expect(
      screen.getByText(t("admin.routes.moved", { name: "Model A", position: 2, total: 2 })),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    const puts = callsTo("PUT", "/admin/ai/routes");
    expect(puts).toHaveLength(1);
    const body = bodyOf(puts[0]);
    expect((body["models"] as { modelId: string }[]).map((entry) => entry.modelId)).toEqual([
      MODEL_B,
      MODEL_A,
    ]);
    expect(body).toMatchObject({ task: "chat", mode: "fast", planId: null, expectedVersion: 3 });
  });

  it("puts a server error that names an item on that item", async () => {
    renderEditor();
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith("/admin/ai/models")) {
        return Promise.resolve(
          json({ items: [model(MODEL_A, "Model A"), model(MODEL_B, "Model B")] }),
        );
      }
      if ((init?.method ?? "GET") === "PUT") {
        return Promise.resolve(
          json(
            {
              code: "VALIDATION_FAILED",
              message: "x",
              details: { reason: "missing_capability", index: 1, fields: ["models"] },
            },
            400,
          ),
        );
      }
      return Promise.resolve(json({}, 404));
    });

    await screen.findByRole("group", { name: t("admin.routes.primary") });
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    const fallback = await screen.findByRole("group", {
      name: t("admin.routes.fallback", { n: 1 }),
    });
    expect(
      await within(fallback).findByText(t("admin.routes.reason.missing_capability")),
    ).toBeTruthy();
    const primary = screen.getByRole("group", { name: t("admin.routes.primary") });
    expect(within(primary).queryByText(t("admin.routes.reason.missing_capability"))).toBeNull();
  });

  it("reloads and says so when someone else saved first", async () => {
    const { onStale, onDone } = renderEditor();
    fetchMock.mockImplementation((url, init) => {
      if (String(url).endsWith("/admin/ai/models")) {
        return Promise.resolve(
          json({ items: [model(MODEL_A, "Model A"), model(MODEL_B, "Model B")] }),
        );
      }
      if ((init?.method ?? "GET") === "PUT") {
        return Promise.resolve(
          json({ code: "CONFLICT", message: "x", details: { reason: "stale_version" } }, 409),
        );
      }
      return Promise.resolve(json({}, 404));
    });
    await screen.findByRole("group", { name: t("admin.routes.primary") });
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onStale).toHaveBeenCalledTimes(1);
    });
    expect(onDone).not.toHaveBeenCalled();
    expect(await screen.findByText(t("admin.routes.stale"))).toBeTruthy();
  });
});

function planView(): PlanView {
  return {
    id: PLAN_ID,
    key: "free",
    nameAr: "المجانية",
    nameEn: "Free",
    audience: "any",
    isDefault: true,
    monthlyCredits: 20,
    visibility: "public",
    sort: 0,
    badgeAr: null,
    badgeEn: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    entitlements: [
      {
        task: "chat",
        allowed: true,
        modes: ["fast", "balanced"],
        dailyCap: 20,
        monthlyCap: null,
        maxPagesPerRx: 4,
        webSearch: false,
      },
    ],
  };
}

describe("EntitlementsEditor", () => {
  const renderPlan = (onSaved = vi.fn()) => {
    fetchMock.mockImplementation(() => Promise.resolve(json(planView())));
    render(
      <ToastProvider>
        <ReauthProvider>
          <EntitlementsEditor plan={planView()} canWrite onSaved={onSaved} />
        </ReauthProvider>
      </ToastProvider>,
    );
    return onSaved;
  };

  it("sends the full set: every task, with the edited row and the untouched ones", async () => {
    const onSaved = renderPlan();
    const rx = taskLabel("rx_extract");
    await userEvent.click(
      screen.getByRole("checkbox", { name: t("admin.plans.ent.allowedFor", { task: rx }) }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: t("admin.plans.ent.modeFor", { task: rx, mode: t("admin.ai.mode.fast") }),
      }),
    );
    await userEvent.type(
      screen.getByLabelText(t("admin.plans.ent.dailyCapFor", { task: rx })),
      "5",
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    const puts = callsTo("PUT", `/admin/plans/${PLAN_ID}/entitlements`);
    expect(puts).toHaveLength(1);
    const rows = JSON.parse(String(puts[0]?.[1]?.body)) as Record<string, unknown>[];
    expect(rows.map((row) => row["task"])).toEqual([...AI_TASKS]);
    expect(rows[0]).toMatchObject({
      task: "rx_extract",
      allowed: true,
      modes: ["fast"],
      dailyCap: 5,
      monthlyCap: null,
      maxPagesPerRx: null,
    });
    expect(rows[2]).toMatchObject({
      task: "chat",
      allowed: true,
      modes: ["fast", "balanced"],
      dailyCap: 20,
      monthlyCap: null,
      maxPagesPerRx: null,
      webSearch: false,
    });
    expect(rows[3]).toMatchObject({ task: "deep_think", allowed: false, modes: [] });
  });

  it("does not send an allowed task with no mode, and says why", async () => {
    renderPlan();
    const verify = taskLabel("rx_verify");
    await userEvent.click(
      screen.getByRole("checkbox", { name: t("admin.plans.ent.allowedFor", { task: verify }) }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("admin.plans.error.needMode"))).toBeTruthy();
    expect(callsTo("PUT", `/admin/plans/${PLAN_ID}/entitlements`)).toHaveLength(0);
  });
});

describe("AdjustCreditsDialog", () => {
  const target = {
    owner: { type: "user" as const, id: OWNER_ID },
    label: "Sara",
    balance: 10,
  };

  it("previews the resulting balance and reuses one idempotency key across submits", async () => {
    let attempts = 0;
    fetchMock.mockImplementation(() => {
      attempts += 1;
      if (attempts === 1) return Promise.resolve(json({ code: "INTERNAL", message: "x" }, 500));
      return Promise.resolve(
        json({
          wallet: {
            owner: target.owner,
            balance: 7,
            plan: {
              id: PLAN_ID,
              key: "free",
              nameAr: "المجانية",
              nameEn: "Free",
            },
            updatedAt: "2026-10-01T00:00:00.000Z",
          },
          entry: {
            id: ROUTE_ID,
            kind: "admin_adjust",
            amount: -3,
            balanceAfter: 7,
            reason: "تصحيح",
            actorId: null,
            reservationId: null,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        }),
      );
    });
    const onAdjusted = vi.fn();
    render(
      <ToastProvider>
        <ReauthProvider>
          <AdjustCreditsDialog
            open
            target={target}
            knownWallets={[]}
            onClose={vi.fn()}
            onAdjusted={onAdjusted}
          />
        </ReauthProvider>
      </ToastProvider>,
    );

    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.credits.adjust.delta"))), "-3");
    const preview = screen.getByText(t("admin.credits.adjust.after"), { exact: false });
    expect(preview.textContent).toContain("7");

    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.reason.label"))), "تصحيح رصيد");
    const apply = screen.getByRole("button", { name: t("admin.credits.adjust.submit") });

    await userEvent.click(apply);
    await waitFor(() => {
      expect(callsTo("POST", "/admin/credits/adjust")).toHaveLength(1);
    });
    expect(onAdjusted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: t("admin.credits.adjust.submit") }));
    await waitFor(() => {
      expect(onAdjusted).toHaveBeenCalledTimes(1);
    });

    const posts = callsTo("POST", "/admin/credits/adjust");
    expect(posts).toHaveLength(2);
    const first = bodyOf(posts[0]);
    const second = bodyOf(posts[1]);
    expect(first["idempotencyKey"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second["idempotencyKey"]).toBe(first["idempotencyKey"]);
    expect(second).toMatchObject({ owner: target.owner, delta: -3, reason: "تصحيح رصيد" });
  });

  it("warns when a deduction would go below zero", async () => {
    render(
      <ToastProvider>
        <ReauthProvider>
          <AdjustCreditsDialog
            open
            target={target}
            knownWallets={[]}
            onClose={vi.fn()}
            onAdjusted={vi.fn()}
          />
        </ReauthProvider>
      </ToastProvider>,
    );
    await userEvent.type(screen.getByLabelText(new RegExp(t("admin.credits.adjust.delta"))), "-15");
    expect(
      screen.getByText(t("admin.credits.adjust.wouldBeNegative"), { exact: false }),
    ).toBeTruthy();
  });
});
