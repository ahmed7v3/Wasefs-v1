// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrugReviewView } from "../src/components/admin/drug-review-view";
import { ReauthProvider } from "../src/lib/reauth";

const DRUG_ID = "22222222-2222-4222-8222-222222222222";

let search = "";
const replace = vi.fn((href: string) => {
  search = href.includes("?") ? (href.split("?")[1] ?? "") : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/admin/drugs/review",
  useSearchParams: () => new URLSearchParams(search),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const drugView = {
  id: DRUG_ID,
  brandEn: "Flumox 500mg",
  brandAr: null,
  form: "capsule",
  strengthText: "500 mg",
  strengthValueMicro: 500_000_000,
  strengthUnit: "mg",
  manufacturer: null,
  country: null,
  status: "active",
  importBatchId: null,
  category: null,
  packText: null,
  unitsCount: null,
  barcode: null,
  priceMinor: null,
  oldPriceMinor: null,
  currency: "EGP",
  brandKey: "flumox",
  source: null,
  priceUpdatedAt: null,
  adminEditedAt: null,
  ingredients: [],
  aliases: [],
  createdAt: "2026-10-12T08:00:00.000Z",
  updatedAt: "2026-10-12T08:00:00.000Z",
};

const unmatched = {
  normalized: "flumoks 500",
  sample: "Flumoks 500",
  hits: 7,
  firstSeen: "2026-10-01T08:00:00.000Z",
  lastSeen: "2026-10-12T08:00:00.000Z",
  status: "open",
  mappedDrugId: null,
  mappedBrandEn: null,
};

const learned = {
  normalized: "flomox",
  drugId: DRUG_ID,
  brandEn: "Flumox 500mg",
  strengthText: "500 mg",
  form: "capsule",
  votes: 2,
  status: "pending",
  decidedAt: null,
};

beforeEach(() => {
  search = "";
  replace.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.includes("/admin/drugs/unmatched") && method === "GET") {
      return Promise.resolve(json({ items: [unmatched], nextCursor: null }));
    }
    if (path.includes("/admin/drugs/learned") && method === "GET") {
      return Promise.resolve(json({ items: [learned], nextCursor: null }));
    }
    if (method === "POST" && path.endsWith("/admin/drugs")) {
      return Promise.resolve(json(drugView, 201));
    }
    if (method === "POST") return Promise.resolve(json({ ok: true }));
    if (path.includes("/admin/drugs?")) {
      return Promise.resolve(json({ items: [{ ...drugView, match: null }], nextCursor: null }));
    }
    return Promise.resolve(json({}));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const callsTo = (method: string, suffix: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith(suffix) && (init?.method ?? "GET") === method,
  );

function renderReview(canWrite = true) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <DrugReviewView canWrite={canWrite} />
      </ReauthProvider>
    </ToastProvider>,
  );
}

describe("DrugReviewView: unmatched names", () => {
  it("lists the open names with how often they were seen", async () => {
    renderReview();
    expect((await screen.findAllByText("Flumoks 500")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/admin/drugs/unmatched?status=open"),
      ),
    ).toBe(true);
  });

  it("ignores a name through its URL-encoded path", async () => {
    renderReview();
    const [button] = await screen.findAllByRole("button", {
      name: t("admin.drugs.review.ignoreFor", { name: "Flumoks 500" }),
    });
    if (!button) throw new Error("no ignore button");
    await userEvent.click(button);
    await waitFor(() => {
      expect(
        callsTo("POST", `/admin/drugs/unmatched/${encodeURIComponent("flumoks 500")}/ignore`),
      ).toHaveLength(1);
    });
  });

  it("maps a name to a drug picked from the search", async () => {
    renderReview();
    const [button] = await screen.findAllByRole("button", {
      name: t("admin.drugs.review.mapFor", { name: "Flumoks 500" }),
    });
    if (!button) throw new Error("no map button");
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: t("admin.drugs.review.mapTitle", { name: "Flumoks 500" }),
    });
    const confirm = within(dialog).getByRole("button", {
      name: t("admin.drugs.review.mapConfirm"),
    });
    expect(confirm).toHaveProperty("disabled", true);
    await userEvent.click(await within(dialog).findByRole("radio"));
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(
        callsTo("POST", `/admin/drugs/unmatched/${encodeURIComponent("flumoks 500")}/map`),
      ).toHaveLength(1);
    });
    expect(
      JSON.parse(
        String(
          callsTo("POST", `/admin/drugs/unmatched/${encodeURIComponent("flumoks 500")}/map`)[0]?.[1]
            ?.body,
        ),
      ),
    ).toEqual({ drugId: DRUG_ID });
  });

  it("creates a drug prefilled with the sample, then links the name to it", async () => {
    renderReview();
    const [button] = await screen.findAllByRole("button", {
      name: t("admin.drugs.review.createFor", { name: "Flumoks 500" }),
    });
    if (!button) throw new Error("no create button");
    await userEvent.click(button);
    const brand = await screen.findByLabelText<HTMLInputElement>(t("admin.drugs.field.brandEn"));
    expect(brand.value).toBe("Flumoks 500");
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.create.save") }));
    await waitFor(() => {
      expect(
        callsTo("POST", `/admin/drugs/unmatched/${encodeURIComponent("flumoks 500")}/map`),
      ).toHaveLength(1);
    });
    expect(JSON.parse(String(callsTo("POST", "/admin/drugs")[0]?.[1]?.body))).toEqual({
      brandEn: "Flumoks 500",
      currency: "EGP",
    });
  });

  it("shows no action buttons without drugs.write", async () => {
    renderReview(false);
    await screen.findAllByText("Flumoks 500");
    expect(
      screen.queryByRole("button", {
        name: t("admin.drugs.review.mapFor", { name: "Flumoks 500" }),
      }),
    ).toBeNull();
  });
});

describe("DrugReviewView: learned names", () => {
  it("lists pending pairs with their votes and approves one", async () => {
    search = "tab=learned";
    renderReview();
    expect((await screen.findAllByText("flomox")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Flumox 500mg").length).toBeGreaterThan(0);
    const [button] = await screen.findAllByRole("button", {
      name: t("admin.drugs.review.approveFor", { name: "flomox" }),
    });
    if (!button) throw new Error("no approve button");
    await userEvent.click(button);
    await waitFor(() => {
      expect(callsTo("POST", "/admin/drugs/learned/approve")).toHaveLength(1);
    });
    expect(
      JSON.parse(String(callsTo("POST", "/admin/drugs/learned/approve")[0]?.[1]?.body)),
    ).toEqual({ normalized: "flomox", drugId: DRUG_ID });
  });

  it("rejects a pair", async () => {
    search = "tab=learned";
    renderReview();
    const [button] = await screen.findAllByRole("button", {
      name: t("admin.drugs.review.rejectFor", { name: "flomox" }),
    });
    if (!button) throw new Error("no reject button");
    await userEvent.click(button);
    await waitFor(() => {
      expect(callsTo("POST", "/admin/drugs/learned/reject")).toHaveLength(1);
    });
  });
});
