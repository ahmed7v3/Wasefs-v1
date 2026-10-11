// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KillSwitchCard } from "../src/components/admin/ai-kill-switch";
import { ModelForm } from "../src/components/admin/ai-model-form";
import { PriceSyncDialog } from "../src/components/admin/ai-price-sync-dialog";
import { ProviderForm } from "../src/components/admin/ai-provider-form";
import {
  bpToMultiplierText,
  formatMultiplier,
  formatUsd,
  multiplierToBp,
  parseUsd,
} from "../src/lib/ai-admin";
import { ReauthProvider } from "../src/lib/reauth";

import type { ModelView, ProviderView } from "@wasfa/shared/schemas/admin-ai";
import type { ReactNode } from "react";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const NOW = "2026-10-11T10:00:00.000Z";
const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const MODEL_ID = "22222222-2222-4222-8222-222222222222";

function provider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: PROVIDER_ID,
    key: "openrouter_main",
    kind: "openrouter",
    baseUrl: null,
    enabled: true,
    priority: 100,
    dataPolicy: "paid_no_training",
    hasKey: true,
    keyHint: "••••abcd",
    lastTestAt: null,
    lastTestOk: null,
    lastTestError: null,
    modelCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function model(overrides: Partial<ModelView> = {}): ModelView {
  return {
    id: MODEL_ID,
    provider: { id: PROVIDER_ID, key: "openrouter_main", kind: "openrouter" },
    modelId: "vendor/model-x",
    displayName: "Model X",
    capabilities: ["vision"],
    contextTokens: 128_000,
    priceInputUsdMicrosPerM: 750_000,
    priceCachedInputUsdMicrosPerM: null,
    priceOutputUsdMicrosPerM: 3_750_000,
    priceSearchUsdMicros: 0,
    creditMultiplierBp: 10_000,
    enabled: true,
    priceSource: "manual",
    priceCheckedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    warnings: [],
    usedInRoutes: 0,
    ...overrides,
  };
}

const writes = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
const bodyOf = (call: (typeof fetchMock.mock.calls)[number] | undefined): Record<string, unknown> =>
  JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>;
const control = (name: string): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!element) throw new Error(`no control named ${name}`);
  return element;
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  return render(
    <ToastProvider>
      <ReauthProvider>{ui}</ReauthProvider>
    </ToastProvider>,
  );
}

describe("money and multiplier text", () => {
  it("converts the multiplier exactly, in both directions", () => {
    expect(multiplierToBp("1")).toBe(10_000);
    expect(multiplierToBp("1.5")).toBe(15_000);
    expect(multiplierToBp("0.0001")).toBe(1);
    expect(multiplierToBp("100")).toBe(1_000_000);
    expect(multiplierToBp("100.0001")).toBeNull();
    expect(multiplierToBp("0")).toBeNull();
    expect(multiplierToBp("1.23456")).toBeNull();
    expect(multiplierToBp("abc")).toBeNull();
    expect(bpToMultiplierText(15_000)).toBe("1.5");
    expect(bpToMultiplierText(10_000)).toBe("1");
    expect(bpToMultiplierText(12_345)).toBe("1.2345");
    expect(formatMultiplier(15_000)).toBe(t("admin.ai.multiplier", { value: "1.50" }));
    expect(formatMultiplier(10_000)).toBe(t("admin.ai.multiplier", { value: "1.00" }));
  });

  it("parses USD input exactly and shows at least two decimals", () => {
    expect(parseUsd("0.75", false)).toEqual({ ok: true, value: 750_000 });
    expect(parseUsd("", true)).toEqual({ ok: true, value: null });
    expect(parseUsd("", false)).toEqual({ ok: false, reason: "required" });
    expect(parseUsd("0.1234567", false)).toEqual({ ok: false, reason: "invalid" });
    expect(parseUsd("-1", false)).toEqual({ ok: false, reason: "invalid" });
    expect(formatUsd(750_000)).toBe("$0.75");
    expect(formatUsd(1_000_000)).toBe("$1.00");
    expect(formatUsd(125)).toBe("$0.000125");
  });
});

describe("ModelForm (add)", () => {
  function setup(discover: () => Response) {
    fetchMock.mockImplementation((url, init) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/discover")) return Promise.resolve(discover());
      if (path.endsWith("/admin/ai/models") && method === "POST") {
        return Promise.resolve(json(model(), 201));
      }
      return Promise.resolve(json({}, 404));
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    wrap(
      <ModelForm
        model={null}
        providers={[provider()]}
        defaultProviderId={PROVIDER_ID}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );
    return { onSaved, onClose };
  }

  it("accepts a free-text id when discovery fails, and sends exact micros", async () => {
    const { onSaved } = setup(() => json({ code: "UPSTREAM_UNAVAILABLE", message: "x" }, 502));
    expect(await screen.findByText(t("admin.ai.models.discover.failed"))).toBeTruthy();

    await userEvent.type(control("modelId"), "vendor/custom-model:free");
    await userEvent.type(control("displayName"), "Custom");
    await userEvent.type(control("priceInput"), "0.75");
    await userEvent.type(control("priceOutput"), "3.75");
    await userEvent.clear(control("multiplier"));
    await userEvent.type(control("multiplier"), "1.5");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    const body = bodyOf(writes("POST")[0]);
    expect(body).toMatchObject({
      providerId: PROVIDER_ID,
      modelId: "vendor/custom-model:free",
      displayName: "Custom",
      priceInputUsdMicrosPerM: 750_000,
      priceOutputUsdMicrosPerM: 3_750_000,
      priceCachedInputUsdMicrosPerM: null,
      priceSearchUsdMicros: null,
      creditMultiplierBp: 15_000,
      enabled: true,
    });
  });

  it("pre-fills name, capabilities and prices (as 0.75) from a discovered id", async () => {
    setup(() =>
      json({
        items: [
          {
            id: "google/gemini-x",
            displayName: "Gemini X",
            contextTokens: 1_000_000,
            capabilities: ["vision", "json"],
            pricing: {
              inputUsdMicrosPerM: 750_000,
              cachedInputUsdMicrosPerM: 75_000,
              outputUsdMicrosPerM: 3_000_000,
              searchUsdMicros: null,
            },
            alreadyAdded: false,
          },
          {
            id: "google/gemini-old",
            displayName: "Old",
            contextTokens: null,
            capabilities: [],
            pricing: null,
            alreadyAdded: true,
          },
        ],
        fetchedAt: NOW,
        cached: false,
      }),
    );
    expect(await screen.findByText(t("admin.ai.models.discover.ready", { count: 2 }))).toBeTruthy();

    await userEvent.type(control("modelId"), "google/gemini-x");
    expect(control("displayName").value).toBe("Gemini X");
    expect(control("contextTokens").value).toBe("1000000");
    expect(control("priceInput").value).toBe("0.75");
    expect(control("priceCached").value).toBe("0.075");
    expect(control("priceOutput").value).toBe("3");
    expect(control("priceSearch").value).toBe("");
    expect(control("capability.vision").checked).toBe(true);
    expect(control("capability.json").checked).toBe(true);
    expect(control("capability.bbox").checked).toBe(false);

    // The datalist offers every discovered id, and marks the one already added.
    const options = [...document.querySelectorAll("datalist option")].map((option) =>
      option.getAttribute("value"),
    );
    expect(options).toEqual(["google/gemini-x", "google/gemini-old"]);
    expect(document.querySelector('datalist option[value="google/gemini-old"]')?.textContent).toBe(
      t("admin.ai.models.discover.added"),
    );
  });

  it("shows an error under an invalid price and does not submit", async () => {
    setup(() => json({ items: [], fetchedAt: NOW, cached: false }));
    await userEvent.type(control("modelId"), "vendor/m");
    await userEvent.type(control("displayName"), "M");
    await userEvent.type(control("priceInput"), "0.1234567");
    await userEvent.type(control("priceOutput"), "3");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    expect(await screen.findByText(t("admin.ai.error.usd"))).toBeTruthy();
    expect(control("priceInput").getAttribute("aria-invalid")).toBe("true");
    expect(writes("POST")).toHaveLength(0);
  });
});

describe("ProviderForm (edit)", () => {
  function setup() {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve((init?.method ?? "GET") === "PATCH" ? json(provider()) : json({}, 404)),
    );
    const onSaved = vi.fn();
    wrap(
      <ProviderForm
        provider={provider()}
        onClose={vi.fn()}
        onSaved={onSaved}
        onRemoveKey={vi.fn()}
      />,
    );
    return onSaved;
  }

  it("never renders the stored key and sends no apiKey when none is typed", async () => {
    const onSaved = setup();
    const field = control("apiKey");
    expect(field.value).toBe("");
    expect(field.getAttribute("placeholder")).toBe(t("admin.ai.providers.field.apiKeyReplace"));
    expect(field.type).toBe("password");
    // The stored key (even masked) is a hint under the field, never a value.
    expect(screen.queryByDisplayValue("••••abcd")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(Object.hasOwn(bodyOf(writes("PATCH")[0]), "apiKey")).toBe(false);
  });

  it("sends apiKey when a new one is typed", async () => {
    const onSaved = setup();
    await userEvent.type(control("apiKey"), "sk-new-secret-key");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(bodyOf(writes("PATCH")[0])["apiKey"]).toBe("sk-new-secret-key");
  });

  it("offers to remove the stored key", async () => {
    setup();
    expect(screen.getByRole("button", { name: t("admin.ai.providers.removeKey") })).toBeTruthy();
  });
});

describe("ProviderForm (add, OpenAI-compatible)", () => {
  it("requires a base URL and blocks the request without one", async () => {
    fetchMock.mockResolvedValue(json({}, 404));
    wrap(<ProviderForm provider={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(control("key"), "my_gateway");
    await userEvent.selectOptions(control("kind"), "openai_compatible");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(await screen.findByText(t("form.required"))).toBeTruthy();
    expect(control("baseUrl").getAttribute("aria-invalid")).toBe("true");
    expect(writes("POST")).toHaveLength(0);
  });
});

describe("KillSwitchCard", () => {
  const off = { all: false, rx: false, chat: false, search: false };

  it("turning a switch on needs the typed word", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    wrap(<KillSwitchCard value={off} canChange onChange={onChange} />);

    await userEvent.click(screen.getByRole("checkbox", { name: t("admin.ai.kill.label.chat") }));
    // Nothing changes on the click itself.
    expect(onChange).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: t("admin.ai.kill.confirmOn") });
    await userEvent.click(confirm);
    expect(
      await screen.findByText(t("admin.ai.kill.typeError", { word: t("admin.ai.kill.word") })),
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(control("confirmWord"), t("admin.ai.kill.word"));
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange.mock.calls[0]?.[0]).toEqual({ ...off, chat: true });
  });

  it("turning a switch off asks for a plain confirmation", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    wrap(<KillSwitchCard value={{ ...off, all: true }} canChange onChange={onChange} />);

    await userEvent.click(screen.getByRole("checkbox", { name: t("admin.ai.kill.label.all") }));
    await userEvent.click(screen.getByRole("button", { name: t("admin.ai.kill.confirmOff") }));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange.mock.calls[0]?.[0]).toEqual(off);
  });

  it("is read-only without the kill-switch permission", () => {
    wrap(<KillSwitchCard value={off} canChange={false} onChange={vi.fn()} />);
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText(t("admin.ai.kill.noPermission"))).toBeTruthy();
  });
});

describe("PriceSyncDialog", () => {
  const change = (field: string, before: number | null, after: number) => ({
    modelId: MODEL_ID,
    providerKey: "openrouter_main",
    model: "vendor/model-x",
    field,
    before,
    after,
  });

  it("shows the diff in USD and applies only the selected models", async () => {
    fetchMock.mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith("/price-sync/preview")) {
        return Promise.resolve(
          json({
            token: "a".repeat(32),
            changes: [change("priceInputUsdMicrosPerM", 750_000, 800_000)],
            unmatched: 0,
          }),
        );
      }
      if (path.endsWith("/price-sync/apply")) {
        return Promise.resolve(json({ models: 1, changes: 1 }));
      }
      return Promise.resolve(json({}, 404));
    });
    const onApplied = vi.fn();
    wrap(<PriceSyncDialog open onClose={vi.fn()} onApplied={onApplied} />);

    expect(await screen.findByText("$0.75")).toBeTruthy();
    expect(screen.getByText("$0.80")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: t("admin.ai.sync.apply", { count: 1 }) }),
    );
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalled();
    });
    expect(bodyOf(writes("POST")[1])).toEqual({ token: "a".repeat(32), modelIds: [MODEL_ID] });
  });

  it("explains a missing price source", async () => {
    fetchMock.mockResolvedValue(
      json({ code: "CONFLICT", message: "x", details: { reason: "no_price_source" } }, 409),
    );
    wrap(<PriceSyncDialog open onClose={vi.fn()} onApplied={vi.fn()} />);
    expect(await screen.findByText(t("admin.ai.reason.no_price_source"))).toBeTruthy();
  });
});
