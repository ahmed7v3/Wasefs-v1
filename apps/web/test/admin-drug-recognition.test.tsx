// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { settingDefault } from "@wasfa/shared/settings";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DrugRecognitionView } from "../src/components/admin/drug-recognition-view";
import { ReauthProvider } from "../src/lib/reauth";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/drugs/recognition",
  useSearchParams: () => new URLSearchParams(""),
}));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const DRUG_ID = "22222222-2222-4222-8222-222222222222";

const sandboxBody = (overrides: Record<string, unknown> = {}) => ({
  settings: { acceptScore: 0.85, reviewScore: 0.5, minMargin: 0.06, enabled: true, mode: "hybrid" },
  candidates: [
    {
      drugId: DRUG_ID,
      brandEn: "Flumox 500mg",
      brandAr: null,
      brandKey: "flumox",
      strengthText: "500 mg",
      form: "capsule",
      score: 0.93,
      explanation: { nameScore: 0.9, matchedOn: "brand", strength: "match", form: "unknown" },
    },
  ],
  decision: { matchClass: "accept", chosenDrugId: DRUG_ID, familyOnly: false, reason: "accepted" },
  ...overrides,
});

let sandbox = sandboxBody();

beforeEach(() => {
  fetchMock.mockReset();
  sandbox = sandboxBody();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation((url, init) => {
    const path = String(url);
    const method = init?.method ?? "GET";
    if (path.endsWith("/admin/settings")) {
      return Promise.resolve(
        json({
          items: [
            {
              key: "medications",
              visibility: "admin",
              value: settingDefault("medications"),
              updatedAt: null,
              updatedBy: null,
            },
          ],
        }),
      );
    }
    if (path.includes("/admin/drugs/sandbox")) return Promise.resolve(json(sandbox));
    if (path.endsWith("/admin/settings/medications") && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as { value: unknown };
      return Promise.resolve(
        json({
          key: "medications",
          visibility: "admin",
          value: body.value,
          updatedAt: "2026-10-12T08:00:00.000Z",
          updatedBy: null,
        }),
      );
    }
    return Promise.resolve(json({}));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderView(props: { canReadSettings?: boolean; canWriteSettings?: boolean } = {}) {
  return render(
    <ToastProvider>
      <ReauthProvider>
        <DrugRecognitionView
          canReadSettings={props.canReadSettings ?? true}
          canWriteSettings={props.canWriteSettings ?? true}
        />
      </ReauthProvider>
    </ToastProvider>,
  );
}

describe("DrugRecognitionView: settings", () => {
  it("renders only the medications key, with the two switches explained first", async () => {
    renderView();
    expect(
      await screen.findByRole("form", { name: t("admin.settings.medications.title") }),
    ).toBeTruthy();
    expect(screen.queryByRole("form", { name: t("admin.settings.rx.title") })).toBeNull();
    expect(screen.getByText(t("admin.settings.help.medications.enabled"))).toBeTruthy();
    expect(screen.getByText(t("admin.settings.help.medications.mode"))).toBeTruthy();
    expect(screen.getByText(t("admin.settings.help.medications.acceptScore"))).toBeTruthy();
  });

  it("saves a changed threshold to the medications key", async () => {
    renderView();
    const accept = await screen.findByLabelText(t("admin.settings.field.medications.acceptScore"));
    await userEvent.clear(accept);
    await userEvent.type(accept, "0.9");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter(
          ([url, init]) =>
            String(url).endsWith("/admin/settings/medications") && init?.method === "PUT",
        ),
      ).toHaveLength(1);
    });
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ value: { acceptScore: 0.9 } });
  });

  it("refuses a review score that is not under the accept score", async () => {
    renderView();
    const review = await screen.findByLabelText(t("admin.settings.field.medications.reviewScore"));
    await userEvent.clear(review);
    await userEvent.type(review, "0.95");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));
    expect(review.getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("hides the form but keeps the sandbox without settings.read", async () => {
    renderView({ canReadSettings: false });
    expect(await screen.findByText(t("admin.drugs.recognition.noSettings"))).toBeTruthy();
    expect(screen.getByRole("form", { name: t("admin.drugs.sandbox.title") })).toBeTruthy();
  });
});

describe("DrugRecognitionView: sandbox", () => {
  it("sends the name, strength, form and legibility, then shows candidates and the decision", async () => {
    renderView();
    const run = await screen.findByRole("button", { name: t("admin.drugs.sandbox.run") });
    expect(run).toHaveProperty("disabled", true);
    await userEvent.type(screen.getByLabelText(t("admin.drugs.sandbox.name")), "flumox");
    await userEvent.type(screen.getByLabelText(t("admin.drugs.filter.strength")), "500 mg");
    await userEvent.selectOptions(
      screen.getByLabelText(t("admin.drugs.sandbox.legibility")),
      "partial",
    );
    await userEvent.click(run);

    expect((await screen.findAllByText("Flumox 500mg")).length).toBeGreaterThan(0);
    const request =
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .find((url) => url.includes("/admin/drugs/sandbox")) ?? "";
    const params = new URLSearchParams(request.split("?")[1]);
    expect(Object.fromEntries(params)).toEqual({
      q: "flumox",
      strength: "500 mg",
      legibility: "partial",
    });
    expect(screen.getByText(t("admin.drugs.sandbox.class.accept"))).toBeTruthy();
    expect(screen.getByText(t("admin.drugs.sandbox.reason.accepted", { accept: 85 }))).toBeTruthy();
    expect(screen.getAllByText("93%").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("meter")[0]?.getAttribute("aria-valuenow")).toBe("93");
  });

  it("explains a verification in plain words and warns when the engine is off", async () => {
    sandbox = sandboxBody({
      settings: {
        acceptScore: 0.85,
        reviewScore: 0.5,
        minMargin: 0.06,
        enabled: false,
        mode: "ai_only",
      },
      decision: {
        matchClass: "verify",
        chosenDrugId: null,
        familyOnly: false,
        reason: "unclear_handwriting",
      },
    });
    renderView();
    await userEvent.type(await screen.findByLabelText(t("admin.drugs.sandbox.name")), "flumox");
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.sandbox.run") }));
    expect(
      await screen.findByText(t("admin.drugs.sandbox.reason.unclear_handwriting")),
    ).toBeTruthy();
    expect(screen.getByText(t("admin.drugs.sandbox.engineOff"))).toBeTruthy();
    expect(screen.getByText(t("admin.drugs.sandbox.class.verify"))).toBeTruthy();
  });

  it("says so when nothing is close", async () => {
    sandbox = sandboxBody({
      candidates: [],
      decision: {
        matchClass: "unmatched",
        chosenDrugId: null,
        familyOnly: false,
        reason: "no_candidates",
      },
    });
    renderView();
    await userEvent.type(await screen.findByLabelText(t("admin.drugs.sandbox.name")), "zzz");
    await userEvent.click(screen.getByRole("button", { name: t("admin.drugs.sandbox.run") }));
    expect(await screen.findByText(t("admin.drugs.sandbox.noCandidates"))).toBeTruthy();
    expect(screen.getByText(t("admin.drugs.sandbox.class.unmatched"))).toBeTruthy();
  });
});
