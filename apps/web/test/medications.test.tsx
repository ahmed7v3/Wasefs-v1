// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MedicationDetailView } from "../src/components/medications/medication-detail";
import { MedicationSearch } from "../src/components/medications/medication-search";

import type {
  MedicationDetailResponse,
  MedicationSummary,
} from "@wasfa/shared/schemas/medications";

let search = "";
const replace = vi.fn((href: string) => {
  search = href.includes("?") ? (href.split("?")[1] ?? "") : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/medications",
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  search = "";
  replace.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ID_1 = "11111111-1111-4111-8111-111111111111";
const ID_2 = "22222222-2222-4222-8222-222222222222";

function summary(id: string, brandEn: string, overrides: Partial<MedicationSummary> = {}) {
  return {
    id,
    brandEn,
    brandAr: null,
    brandKey: brandEn.toLowerCase(),
    form: "tablet",
    strengthText: "500 mg",
    packText: "20 tablets",
    category: "analgesic",
    manufacturer: "EIPICO",
    ingredients: ["paracetamol"],
    priceMinor: 4500,
    currency: "EGP",
    priceUpdatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } satisfies MedicationSummary;
}

describe("MedicationSearch", () => {
  it("shows the hint with examples before anything is typed", () => {
    render(<MedicationSearch />);
    expect(screen.getByText(t("medications.hint.title"))).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders results from the URL query, with brand, ingredients and price", async () => {
    search = "q=panadol";
    fetchMock.mockResolvedValue(
      json({ items: [summary(ID_1, "Panadol", { brandAr: "بانادول" })], nextCursor: null }),
    );
    render(<MedicationSearch />);
    const card = await screen.findByRole("link", { name: /Panadol/ });
    expect(card.getAttribute("href")).toBe(`/medications/${ID_1}`);
    expect(screen.getByText("paracetamol")).toBeTruthy();
    expect(screen.getByText(/≈/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t("medications.loadMore") })).toBeNull();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/medications/search?q=panadol");
  });

  it("appends the next page with the cursor on Load more", async () => {
    search = "q=para";
    fetchMock
      .mockResolvedValueOnce(json({ items: [summary(ID_1, "Panadol")], nextCursor: "c1" }))
      .mockResolvedValueOnce(json({ items: [summary(ID_2, "Cetal")], nextCursor: null }));
    const user = userEvent.setup();
    render(<MedicationSearch />);
    await screen.findByRole("link", { name: /Panadol/ });
    await user.click(screen.getByRole("button", { name: t("medications.loadMore") }));
    await screen.findByRole("link", { name: /Cetal/ });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("cursor=c1");
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: t("medications.loadMore") })).toBeNull();
  });

  it("hides the price when the API sends null", async () => {
    search = "q=panadol";
    fetchMock.mockResolvedValue(
      json({
        items: [summary(ID_1, "Panadol", { priceMinor: null, priceUpdatedAt: null })],
        nextCursor: null,
      }),
    );
    render(<MedicationSearch />);
    await screen.findByRole("link", { name: /Panadol/ });
    expect(screen.queryByText(/≈/)).toBeNull();
  });

  it("explains an empty result", async () => {
    search = "q=zzzz";
    fetchMock.mockResolvedValue(json({ items: [], nextCursor: null }));
    render(<MedicationSearch />);
    expect(await screen.findByText(t("medications.noResults.title"))).toBeTruthy();
  });

  it("shows a friendly message when the admin switched the search off", async () => {
    search = "q=panadol";
    fetchMock.mockResolvedValue(
      json({ code: "NOT_FOUND", message: "x", details: { reason: "feature_off" } }, 404),
    );
    render(<MedicationSearch />);
    expect(await screen.findByText(t("medications.featureOff.title"))).toBeTruthy();
  });

  it("tells the person to wait when rate limited", async () => {
    search = "q=panadol";
    fetchMock.mockResolvedValue(json({ code: "RATE_LIMITED", message: "x" }, 429));
    render(<MedicationSearch />);
    expect(await screen.findByText(t("medications.rateLimited"))).toBeTruthy();
  });

  it("shows a retryable error for other failures", async () => {
    search = "q=panadol";
    fetchMock.mockResolvedValue(json({ code: "INTERNAL", message: "x" }, 500));
    render(<MedicationSearch />);
    expect(await screen.findByRole("button", { name: t("common.retry") })).toBeTruthy();
  });

  it("debounces typing into the URL and shows the barcode hint for digits", async () => {
    fetchMock.mockResolvedValue(json({ items: [], nextCursor: null }));
    const user = userEvent.setup();
    render(<MedicationSearch />);
    await user.type(screen.getByRole("searchbox"), "6221031");
    expect(screen.getByText(t("medications.hint.barcode"))).toBeTruthy();
    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/medications?q=6221031", { scroll: false });
    });
  });

  it("does not search for a single character", async () => {
    const user = userEvent.setup();
    render(<MedicationSearch />);
    await user.type(screen.getByRole("searchbox"), "p");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MedicationDetailView", () => {
  const detail: MedicationDetailResponse = {
    medication: {
      ...summary(ID_1, "Panadol", { brandAr: "بانادول" }),
      oldPriceMinor: 4000,
      unitsCount: 20,
      barcode: "6221031000011",
      status: "active",
      ingredientStrengths: [{ name: "paracetamol", strength: "500 mg" }],
    },
    alternatives: [summary(ID_2, "Cetal", { priceMinor: 3000 })],
  };

  it("shows the facts, the previous price, alternatives and next steps", () => {
    render(<MedicationDetailView detail={detail} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Panadol");
    expect(screen.getByText("paracetamol 500 mg")).toBeTruthy();
    expect(screen.getByText("6221031000011")).toBeTruthy();
    expect(screen.getByText(/سعر تقريبي|Approximate price/)).toBeTruthy();
    const section = screen.getByRole("region", {
      name: t("medications.detail.alternatives.title"),
    });
    expect(within(section).getByRole("link", { name: /Cetal/ }).getAttribute("href")).toBe(
      `/medications/${ID_2}`,
    );
    expect(
      screen.getByRole("link", { name: t("medications.detail.analyze") }).getAttribute("href"),
    ).toBe("/analyze");
    expect(
      screen.getByRole("link", { name: t("medications.detail.ask") }).getAttribute("href"),
    ).toBe("/ai");
    expect(screen.getByText(t("medications.detail.disclaimer"))).toBeTruthy();
  });

  it("omits prices when hidden and says so when there are no alternatives", () => {
    render(
      <MedicationDetailView
        detail={{
          medication: {
            ...detail.medication,
            priceMinor: null,
            oldPriceMinor: null,
            priceUpdatedAt: null,
          },
          alternatives: [],
        }}
      />,
    );
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.getByText(t("medications.detail.alternatives.empty"))).toBeTruthy();
  });
});
