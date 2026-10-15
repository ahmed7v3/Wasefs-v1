// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "@wasfa/shared/i18n";
import { ToastProvider } from "@wasfa/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvalsSharedPanel } from "../src/components/admin/evals-shared-panel";
import { ReauthProvider } from "../src/lib/reauth";

const ANALYSIS = "11111111-1111-4111-8111-111111111111";
const SET = "33333333-3333-4333-8333-333333333333";

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

const reading = {
  schemaVersion: 1,
  matching: "model",
  items: [
    {
      rawText: "Dostenix",
      name: "Dostinex",
      matchedDrugId: null,
      matchScore: null,
      activeIngredients: [],
      strength: "0.5 mg",
      form: "tablet",
      dose: null,
      frequency: "weekly",
      duration: null,
      route: null,
      notes: null,
      confidence: 0.9,
      badge: "high",
      verified: "not_needed",
      box_2d: null,
      page: 0,
    },
  ],
  date: null,
  prescriberLegible: true,
  findings: [],
  unreadableRegions: [],
};

function serve() {
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/evals/shared") && method === "GET") {
      return Promise.resolve(
        json({
          items: [
            {
              analysisId: ANALYSIS,
              rating: "good",
              note: "ممتاز",
              itemCount: 1,
              itemNames: ["Dostinex"],
              imageAvailable: true,
              ratedAt: "2026-10-15T10:00:00.000Z",
            },
          ],
        }),
      );
    }
    if (url.endsWith(`/evals/shared/${ANALYSIS}`)) {
      return Promise.resolve(
        json({
          analysisId: ANALYSIS,
          rating: "good",
          note: "ممتاز",
          ratedAt: "2026-10-15T10:00:00.000Z",
          result: reading,
          images: [{ pageNo: 1, url: "https://storage.test/page-1" }],
        }),
      );
    }
    if (url.endsWith("/evals/sets")) {
      return Promise.resolve(
        json({
          items: [
            {
              id: SET,
              key: "owner-set",
              name: "Owner set",
              description: null,
              items: 1,
              printed: 1,
              handwritten: 0,
              withoutImage: 0,
              createdAt: "2026-10-14T10:00:00.000Z",
            },
          ],
        }),
      );
    }
    if (url.endsWith("/approve")) {
      return Promise.resolve(json({ itemId: SET, imageCopied: true }));
    }
    return Promise.resolve(new Response(null, { status: 204 }));
  });
}

const wrap = () =>
  render(
    <ToastProvider>
      <ReauthProvider>
        <EvalsSharedPanel />
      </ReauthProvider>
    </ToastProvider>,
  );

describe("EvalsSharedPanel", () => {
  it("lists the shared analysis, shows the picture beside the reading, and adds it to a set", async () => {
    serve();
    const user = userEvent.setup();
    wrap();
    expect(await screen.findByText("Dostinex")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t("admin.evals.shared.open") }));
    const dialog = await screen.findByRole("dialog");
    const image = await within(dialog).findByRole("img");
    expect(image.getAttribute("src")).toBe("https://storage.test/page-1");
    await user.click(
      await within(dialog).findByRole("button", { name: t("admin.evals.review.approve") }),
    );
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/approve"));
      expect(String(call?.[0])).toContain(`/evals/shared/${ANALYSIS}/approve`);
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ setId: SET, kind: "handwritten" });
    });
  });

  it("dismisses by withdrawing the sharing", async () => {
    serve();
    const user = userEvent.setup();
    wrap();
    await screen.findByText("Dostinex");
    await user.click(screen.getByRole("button", { name: t("admin.evals.shared.open") }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("img");
    await user.click(within(dialog).getByRole("button", { name: t("admin.evals.shared.dismiss") }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/dismiss"));
      expect(call).toBeTruthy();
    });
  });
});
